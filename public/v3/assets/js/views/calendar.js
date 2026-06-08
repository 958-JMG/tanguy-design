// Calendar v3 (Sprint 3) — calendrier mensuel avec drag-and-drop sur les périodes de pose.
// Pas de lib externe — grille HTML 7×6 + HTML5 drag-and-drop natif.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { patchProjet, fetchRendezVous } from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { openModalRdv } from '../core/rdv.js';

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

// Construit la liste des événements pour le mois affiché
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
      titre: p.Référence || '?',
      start: dStart,
      end: dEnd,
      color: 'accent',
      draggable: true,
    });
  }

  // Rendez-vous : événements ponctuels (à leur date) — chargés dans state.rendezVous.
  // « Date et heure » est un dateTime ISO → on prend la partie date (parseISODate ne gère que YYYY-MM-DD).
  for (const r of state.rendezVous || []) {
    const f = r.fields || {};
    if (f.Statut === 'Annulé') continue;
    const d = parseISODate(String(f['Date et heure'] || '').slice(0, 10));
    if (!d || d < debutMois || d > finMois) continue;
    events.push({
      type: 'rdv',
      id: r.id,
      titre: `${f.Type ? f.Type + ' · ' : ''}${f.Objet || 'RDV'}`,
      start: d,
      end: d,
      color: 'rdv',
      draggable: false,
    });
  }

  return events;
}

export function renderCalendar(app) {
  // État local : mois affiché (par défaut : mois courant)
  const today = new Date();
  let curYear = today.getFullYear();
  let curMonth = today.getMonth();

  function draw() {
    const events = buildEvents(curYear, curMonth);
    const debutMois = new Date(curYear, curMonth, 1);
    const finMois   = new Date(curYear, curMonth + 1, 0);
    // Décalage lundi = 0 (au lieu de dimanche)
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
        </div>
      </div>

      <div class="cal-legend">
        <span class="legend-dot color-accent"></span> Pose chantier
        <span class="legend-dot" style="background:var(--gold,#b8860b);margin-left:12px"></span> Rendez-vous
        <span class="muted" style="margin-left:16px">Glisse la pose pour la déplacer · clic sur un RDV pour l'éditer.</span>
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
                <button class="cal-event color-${ev.color} ${ev.isStart ? 'is-start' : ''} ${ev.isEnd ? 'is-end' : ''}"
                        draggable="${ev.draggable}"
                        data-id="${ev.id}"
                        data-type="${ev.type}"
                        data-start="${toISODate(ev.start)}"
                        data-end="${toISODate(ev.end)}"
                        ${ev.type === 'rdv' ? 'style="background:var(--gold,#b8860b);color:#fff;border:none"' : ''}
                        title="${esc(ev.titre)}${ev.type === 'rdv' ? '' : ` (${toISODate(ev.start)} → ${toISODate(ev.end)})`}">
                  ${ev.isStart ? esc(ev.titre) : '·'}
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

    // Bindings navigation
    document.getElementById('cal-prev').onclick = () => { curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } draw(); };
    document.getElementById('cal-next').onclick = () => { curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } draw(); };
    document.getElementById('cal-today').onclick = () => { curYear = today.getFullYear(); curMonth = today.getMonth(); draw(); };

    // Click event → navigate (pose) ou éditer le rendez-vous
    app.querySelectorAll('.cal-event').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.classList.contains('dragging')) return;
        const id = el.dataset.id;
        if (el.dataset.type === 'pose') navigateTo('projet', { id });
        else if (el.dataset.type === 'rdv') {
          const rdv = (state.rendezVous || []).find(r => r.id === id);
          if (rdv) openModalRdv({ rdv, onSaved: () => fetchRendezVous().then(rs => { state.rendezVous = rs; draw(); }).catch(() => {}) });
        }
      });
    });

    // Drag & drop
    let dragData = null;
    app.querySelectorAll('.cal-event[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', e => {
        dragData = {
          id: el.dataset.id,
          type: el.dataset.type,
          start: el.dataset.start,
          end: el.dataset.end,
          startNum: parseISODate(el.dataset.start).getTime(),
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
        // Capture locale AVANT await — sinon `dragend` qui reset dragData=null peut se déclencher
        // entre le confirm() et la fin du await, et `dragData.id` plante en cascade.
        const captured = { id: dragData.id, start: dragData.start, end: dragData.end };
        const newStartIso = cell.dataset.iso;
        if (newStartIso === captured.start) return; // aucun changement
        const newStart = parseISODate(newStartIso);
        const oldStart = parseISODate(captured.start);
        const oldEnd = parseISODate(captured.end);
        const duration = diffDays(oldStart, oldEnd);
        const newEnd = new Date(newStart.getTime() + duration * 86400000);

        const ok = await confirmModal(`Déplacer la pose au ${newStartIso} (${duration + 1} j) ?`, { okLabel: 'Déplacer' });
        if (!ok) return;
        try {
          await patchProjet(captured.id, {
            'Date pose prévue': newStartIso,
            'Date pose fin': toISODate(newEnd),
          });
          // Mettre à jour state local
          const p = (state.projets || []).find(x => x.id === captured.id);
          if (p) {
            p['Date pose prévue'] = newStartIso;
            p['Date pose fin'] = toISODate(newEnd);
          }
          draw();
          toast(`Pose déplacée au ${newStartIso}`, 'success');
        } catch (err) {
          toast('Erreur déplacement : ' + err.message, 'error', 5000);
        }
      });
    });
  }

  draw();
  // Charge les rendez-vous puis redessine (les poses s'affichent immédiatement).
  (async () => {
    try { state.rendezVous = await fetchRendezVous(); draw(); } catch (e) { /* poses seules si échec */ }
  })();
}
