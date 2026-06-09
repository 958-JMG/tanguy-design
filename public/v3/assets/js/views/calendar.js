// Calendar v3 (Sprint 3) — calendrier mensuel avec drag-and-drop.
// Agenda v2 (2026-06) : couleurs par type de RDV, drag des RDV (pas que les poses),
// réception prévisionnelle affichée en n° de semaine, création de RDV libre, gestion de la pose.
// Pas de lib externe — grille HTML 7×6 + HTML5 drag-and-drop natif.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { patchProjet, fetchRendezVous, patchRendezVous } from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { openModalRdv, rdvTypeSlug, isAllDay, isoWeek } from '../core/rdv.js';

const MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function diffDays(d1, d2) {
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// Construit la liste des événements pour le mois affiché.
// Chaque event porte colorClass (classe CSS statique) + label (texte affiché au jour de début).
function buildEvents(year, month) {
  const debutMois = new Date(year, month, 1);
  const finMois   = new Date(year, month + 1, 0);
  const events = [];

  // Projets : période pose (Date pose prévue → Date pose fin, défaut +5j si fin manquante)
  for (const p of state.projets || []) {
    const dStart = parseISODate(p['Date pose prévue']);
    if (!dStart) continue;
    const dEnd = parseISODate(p['Date pose fin']) || new Date(dStart.getTime() + 5 * 86400000);
    if (dEnd < debutMois || dStart > finMois) continue;
    events.push({
      type: 'pose',
      id: p.id,
      label: p.Référence || '?',
      titre: p.Référence || '?',
      start: dStart,
      end: dEnd,
      colorClass: 'color-accent',
      draggable: true,
    });
  }

  // Rendez-vous : événements ponctuels (à leur date) — chargés dans state.rendezVous.
  // « Date et heure » est un dateTime ISO. La réception prévisionnelle (Type=Réception)
  // s'affiche par n° de semaine plutôt que par jour précis.
  for (const r of state.rendezVous || []) {
    const f = r.fields || {};
    if (f.Statut === 'Annulé') continue;
    const iso = String(f['Date et heure'] || '');
    const d = parseISODate(iso.slice(0, 10));
    if (!d || d < debutMois || d > finMois) continue;
    const type = f.Type || '';
    const isReception = type === 'Réception';
    const titre = `${type ? type + ' · ' : ''}${f.Objet || 'RDV'}`;
    events.push({
      type: 'rdv',
      id: r.id,
      titre,
      label: isReception ? `Récept. S${isoWeek(d)}` : titre,
      start: d,
      end: d,
      iso,                          // ISO complet conservé pour préserver l'heure au drag
      allDay: isAllDay(iso),
      colorClass: isReception ? 'color-reception' : rdvTypeSlug(type),
      draggable: true,
    });
  }

  return events;
}

export function renderCalendar(app) {
  const today = new Date();
  let curYear = today.getFullYear();
  let curMonth = today.getMonth();

  function reloadRdv() {
    fetchRendezVous().then(rs => { state.rendezVous = rs; draw(); }).catch(() => {});
  }

  function draw() {
    const events = buildEvents(curYear, curMonth);
    const debutMois = new Date(curYear, curMonth, 1);
    const finMois   = new Date(curYear, curMonth + 1, 0);
    let firstDay = debutMois.getDay() - 1; if (firstDay < 0) firstDay = 6;
    const nbJours = finMois.getDate();
    const nbCases = Math.ceil((firstDay + nbJours) / 7) * 7;

    // Map événements par jour ISO
    const eventsParJour = new Map();
    for (const ev of events) {
      let d = new Date(ev.start);
      while (d <= ev.end) {
        const iso = toISODate(d);
        if (!eventsParJour.has(iso)) eventsParJour.set(iso, []);
        eventsParJour.get(iso).push({
          ...ev,
          isStart: d.getTime() === ev.start.getTime(),
          isEnd: d.getTime() === ev.end.getTime(),
        });
        d.setDate(d.getDate() + 1);
      }
    }

    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Calendar</h1>
        <div class="cal-nav">
          <button class="btn btn-ghost btn-sm" id="cal-prev">${icon('arrowLeft', 14)}</button>
          <strong class="cal-title">${MOIS_NOMS[curMonth]} ${curYear}</strong>
          <button class="btn btn-ghost btn-sm" id="cal-next">${icon('arrowRight', 14)}</button>
          <button class="btn btn-ghost btn-sm" id="cal-today">Aujourd'hui</button>
          <button class="btn btn-primary btn-sm" id="cal-new-rdv">${icon('plus', 14)} Nouveau RDV</button>
        </div>
      </div>

      <div class="cal-legend">
        <span class="legend-dot color-accent" style="background:var(--accent)"></span> Pose chantier
        <span class="legend-dot rtype-decouverte" style="background:#2f6f9f;margin-left:10px"></span> Découverte
        <span class="legend-dot rtype-metre" style="background:#127a6b;margin-left:10px"></span> Métré
        <span class="legend-dot rtype-presentation-devis" style="background:var(--gold);margin-left:10px"></span> Présentation
        <span class="legend-dot rtype-suivi-chantier" style="background:#6b4f9e;margin-left:10px"></span> Suivi
        <span class="legend-dot rtype-pose" style="background:#c25b30;margin-left:10px"></span> Pose (RDV)
        <span class="legend-dot dot-reception" style="margin-left:10px"></span> Réception (Sem.)
        <span class="legend-dot rtype-sav" style="background:#b23b3b;margin-left:10px"></span> SAV
        <span class="muted" style="flex-basis:100%;margin-top:6px">Glisse une pose ou un RDV pour le déplacer · clic sur un RDV pour l'éditer · clic sur une pose pour la gérer.</span>
      </div>

      <div class="cal-grid">
        <div class="cal-header">
          ${JOURS.map(j => `<div class="cal-header-day">${j}</div>`).join('')}
        </div>
        <div class="cal-body">
          ${Array.from({ length: nbCases }, (_, i) => {
            const dayNum = i - firstDay + 1;
            const isInMonth = dayNum >= 1 && dayNum <= nbJours;
            const dayDate = isInMonth ? new Date(curYear, curMonth, dayNum) : null;
            const iso = dayDate ? toISODate(dayDate) : '';
            const isToday = dayDate && toISODate(dayDate) === toISODate(today);
            const evs = eventsParJour.get(iso) || [];
            return `
            <div class="cal-cell ${isInMonth ? '' : 'cal-cell-empty'} ${isToday ? 'is-today' : ''}" data-iso="${iso}">
              ${isInMonth ? `<div class="cal-day-num">${dayNum}</div>` : ''}
              ${evs.slice(0, 3).map(ev => `
                <button class="cal-event ${ev.colorClass} ${ev.isStart ? 'is-start' : ''} ${ev.isEnd ? 'is-end' : ''}"
                        draggable="${ev.draggable}"
                        data-id="${ev.id}"
                        data-type="${ev.type}"
                        data-start="${toISODate(ev.start)}"
                        data-end="${toISODate(ev.end)}"
                        title="${esc(ev.titre)}${ev.type === 'rdv' ? '' : ` (${toISODate(ev.start)} → ${toISODate(ev.end)})`}">
                  ${ev.isStart ? esc(ev.label) : '·'}
                </button>
              `).join('')}
              ${evs.length > 3 ? `<div class="cal-more muted">+ ${evs.length - 3}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>

      <p class="muted muted-with-icon" style="margin-top:16px">${icon('construction', 14)}
        Poses chantier et rendez-vous affichés. Réunions Plaud et commandes fournisseurs à venir.
      </p>
    `;

    hydrateIcons(app);

    // Navigation
    document.getElementById('cal-prev').onclick = () => { curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } draw(); };
    document.getElementById('cal-next').onclick = () => { curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } draw(); };
    document.getElementById('cal-today').onclick = () => { curYear = today.getFullYear(); curMonth = today.getMonth(); draw(); };
    document.getElementById('cal-new-rdv').onclick = () => openModalRdv({ onSaved: reloadRdv });

    // Click event → éditer un RDV ou gérer une pose
    app.querySelectorAll('.cal-event').forEach(el => {
      el.addEventListener('click', e => {
        if (el.classList.contains('dragging')) return;
        const id = el.dataset.id;
        if (el.dataset.type === 'pose') {
          openModalPose(id);
        } else if (el.dataset.type === 'rdv') {
          const rdv = (state.rendezVous || []).find(r => r.id === id);
          if (rdv) openModalRdv({ rdv, onSaved: reloadRdv });
        }
      });
    });

    // Drag & drop (poses ET rdv)
    let dragData = null;
    app.querySelectorAll('.cal-event[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', e => {
        dragData = {
          id: el.dataset.id,
          type: el.dataset.type,
          start: el.dataset.start,
          end: el.dataset.end,
        };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        dragData = null;
        app.querySelectorAll('.cal-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
      });
    });

    app.querySelectorAll('.cal-cell:not(.cal-cell-empty)').forEach(cell => {
      cell.addEventListener('dragover', e => {
        if (!dragData) return;
        e.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        if (!dragData) return;
        // Capture locale AVANT await — dragend remet dragData=null entre-temps.
        const captured = { id: dragData.id, type: dragData.type, start: dragData.start, end: dragData.end };
        const newStartIso = cell.dataset.iso;
        if (newStartIso === captured.start) return; // aucun changement

        if (captured.type === 'pose') {
          await dropPose(captured, newStartIso);
        } else if (captured.type === 'rdv') {
          await dropRdv(captured, newStartIso);
        }
      });
    });
  }

  // Déplacement d'une période de pose (conserve la durée).
  async function dropPose(captured, newStartIso) {
    const newStart = parseISODate(newStartIso);
    const oldStart = parseISODate(captured.start);
    const oldEnd = parseISODate(captured.end);
    const duration = diffDays(oldStart, oldEnd);
    const newEnd = new Date(newStart.getTime() + duration * 86400000);
    const ok = await confirmModal(`Déplacer la pose au ${newStartIso} (${duration + 1} j) ?`, { okLabel: 'Déplacer' });
    if (!ok) return;
    try {
      await patchProjet(captured.id, { 'Date pose prévue': newStartIso, 'Date pose fin': toISODate(newEnd) });
      const p = (state.projets || []).find(x => x.id === captured.id);
      if (p) { p['Date pose prévue'] = newStartIso; p['Date pose fin'] = toISODate(newEnd); }
      draw();
      toast(`Pose déplacée au ${newStartIso}`, 'success');
    } catch (err) { toast('Erreur déplacement : ' + err.message, 'error', 5000); }
  }

  // Déplacement d'un RDV (préserve l'heure du jour ; journée entière → minuit).
  async function dropRdv(captured, newStartIso) {
    const rdv = (state.rendezVous || []).find(r => r.id === captured.id);
    if (!rdv) return;
    const f = rdv.fields || {};
    const oldIso = f['Date et heure'];
    const allDay = isAllDay(oldIso);
    const old = new Date(oldIso);
    const [y, m, d] = newStartIso.split('-').map(Number);
    const newDate = allDay
      ? new Date(y, m - 1, d, 0, 0, 0)
      : new Date(y, m - 1, d, old.getHours(), old.getMinutes(), 0);
    const ok = await confirmModal(`Déplacer le rendez-vous au ${newStartIso} ?`, { okLabel: 'Déplacer' });
    if (!ok) return;
    try {
      await patchRendezVous(captured.id, { 'Date et heure': newDate.toISOString() });
      f['Date et heure'] = newDate.toISOString();
      draw();
      toast(`Rendez-vous déplacé au ${newStartIso}`, 'success');
    } catch (err) { toast('Erreur déplacement : ' + err.message, 'error', 5000); }
  }

  // Gestion d'une pose depuis le calendrier : ouvrir le projet ou la retirer du calendrier.
  // Une « pose » provient des champs Date pose prévue / Date pose fin du projet ; la retirer
  // = vider ces dates (réversible en les re-saisissant sur la fiche projet).
  function openModalPose(projetId) {
    const p = (state.projets || []).find(x => x.id === projetId);
    if (!p) { navigateTo('projet', { id: projetId }); return; }
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Pose — ${esc(p.Référence || '?')}</h2>
        <p class="muted" style="margin-top:0">Cette barre vient des dates de pose du projet
          (${esc(p['Date pose prévue'] || '?')}${p['Date pose fin'] ? ` → ${esc(p['Date pose fin'])}` : ''}).
          Ce n'est pas un rendez-vous : pour la retirer du calendrier, on vide ses dates de pose.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-pose-cancel>Annuler</button>
          <button type="button" class="btn btn-ghost" data-pose-clear style="color:var(--accent)">${icon('trash', 14)} Retirer du calendrier</button>
          <button type="button" class="btn btn-primary" data-pose-open>Ouvrir le projet</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-pose-cancel]').onclick = close;
    modal.querySelector('[data-pose-open]').onclick = () => { close(); navigateTo('projet', { id: projetId }); };
    modal.querySelector('[data-pose-clear]').onclick = async () => {
      const ok = await confirmModal(`Retirer la pose de ${p.Référence || 'ce projet'} du calendrier ? (vide les dates de pose, réversible)`, { okLabel: 'Retirer', danger: true });
      if (!ok) return;
      try {
        await patchProjet(projetId, { 'Date pose prévue': null, 'Date pose fin': null });
        p['Date pose prévue'] = null; p['Date pose fin'] = null;
        close(); draw();
        toast('Pose retirée du calendrier', 'success');
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    };
  }

  draw();
  // Charge les rendez-vous puis redessine (les poses s'affichent immédiatement).
  (async () => {
    try { state.rendezVous = await fetchRendezVous(); draw(); } catch (e) { /* poses seules si échec */ }
  })();
}
