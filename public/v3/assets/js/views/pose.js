// Onglet Pose (2026-09-02, demande JMG) — planning horaire des poses.
//
// Ce que le Calendar ne faisait pas : les poses y sont des barres à la journée.
// Ici chaque jour de pose est un CRÉNEAU dans la journée (08:00–17:00 par défaut),
// qu'on déplace et qu'on étire à la souris, et deux chantiers sur le même
// créneau se partagent la largeur au lieu de se cacher l'un l'autre.
//
// Les heures viennent des champs Projets « Heure début pose » / « Heure fin pose »
// (migration scripts/setup-pose-heures.js). Non saisies → journée standard,
// et l'écran le dit plutôt que de la faire passer pour une décision.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { patchProjet } from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { isoWeek } from '../core/rdv.js';
import {
  joursDeLaSemaine, lundiDeLaSemaine, disposerEnColonnes, amplitudeHoraire,
  jourDeValeurDate, plagePose, deplacerPlage, redimensionnerPlage,
  heureDeMinutes, minutesDeHeure, POSE_DEFAUT,
} from '../core/calendar-model.js';

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MOIS_COURT = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function diffDays(a, b) { return Math.round((b - a) / 86400000); }

/** 'YYYY-MM-DD' décalé de n jours, toujours en date locale. '' si illisible. */
function decalerIso(iso, n) {
  const d = jourDeValeurDate(iso);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/**
 * Les poses de la semaine, éclatées en UN créneau par jour couvert.
 * Un chantier de 3 jours donne 3 blocs — c'est ce qu'on planifie réellement :
 * une équipe sur un chantier, un jour donné, de telle heure à telle heure.
 */
function creneauxDeLaSemaine(jours) {
  const j0 = jours[0], j6 = jours[6];
  const clientById = new Map((state.clients || []).map(c => [c.id, c]));
  const out = [];
  for (const p of state.projets || []) {
    const debut = jourDeValeurDate(p['Date pose prévue']);
    if (!debut) continue;
    const fin = jourDeValeurDate(p['Date pose fin']) || debut;
    if (fin < j0 || debut > j6) continue;
    const plage = plagePose(p);
    const client = clientById.get((p.Client || [])[0]);
    for (const j of jours) {
      if (j < debut || j > fin) continue;
      out.push({
        projetId: p.id,
        jour: toISODate(j),
        // Rang du jour dans la pose : « J2/3 » situe le bloc dans le chantier.
        rang: diffDays(debut, j) + 1,
        total: diffDays(debut, fin) + 1,
        debutPose: toISODate(debut),
        finPose: toISODate(fin),
        client: client ? (client.Nom || '').trim() : '',
        reference: String(p['Référence'] || '').trim(),
        statutChantier: p['Statut chantier'] || '',
        debut: plage.debut,
        fin: plage.fin,
        parDefaut: plage.parDefaut,
        incoherente: plage.incoherente,
      });
    }
  }
  return out;
}

export function renderPose(app) {
  const today = new Date();
  let ancre = lundiDeLaSemaine(today);

  function draw() {
    const jours = joursDeLaSemaine(ancre);
    const creneaux = creneauxDeLaSemaine(jours);
    const { debut: h0, fin: h1 } = amplitudeHoraire(creneaux, { debut: 7, fin: 19 });
    const nbHeures = h1 - h0;

    // Mise en colonnes jour par jour : deux chantiers au même créneau se partagent
    // la largeur ; deux chantiers de jours différents ne se gênent pas.
    const parJour = new Map(jours.map(j => [toISODate(j), []]));
    for (const c of creneaux) if (parJour.has(c.jour)) parJour.get(c.jour).push(c);
    const poses = [];
    for (const [j, liste] of parJour) for (const c of disposerEnColonnes(liste)) poses.push({ ...c, jour: j });

    const nbChantiers = new Set(creneaux.map(c => c.projetId)).size;
    const sansHeures = new Set(creneaux.filter(c => c.parDefaut && !c.incoherente).map(c => c.projetId)).size;
    const incoherents = new Set(creneaux.filter(c => c.incoherente).map(c => c.projetId)).size;
    const collisions = compterCollisions(poses);

    const a = jours[0], b = jours[6];

    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Pose</h1>
        <div class="cal-nav">
          <button class="btn btn-ghost btn-sm" id="pose-prev" aria-label="Semaine précédente">${icon('arrowLeft', 14)}</button>
          <strong class="cal-title">S${isoWeek(a)} · ${a.getDate()} ${MOIS_COURT[a.getMonth()]} – ${b.getDate()} ${MOIS_COURT[b.getMonth()]}</strong>
          <button class="btn btn-ghost btn-sm" id="pose-next" aria-label="Semaine suivante">${icon('arrowRight', 14)}</button>
          <button class="btn btn-ghost btn-sm" id="pose-today">Cette semaine</button>
          <button class="btn btn-primary btn-sm" id="pose-new">${icon('plus', 14)} Planifier une pose</button>
        </div>
      </div>

      <div class="cal-legend">
        <span class="muted" style="flex-basis:100%">
          ${nbChantiers ? `<strong>${nbChantiers}</strong> chantier${nbChantiers > 1 ? 's' : ''} cette semaine.` : 'Aucune pose planifiée cette semaine.'}
          <strong>Cliquer une case vide pour planifier une pose</strong> · toucher un bloc pour changer ses dates et ses heures ·
          tirer son bord bas pour l'allonger · « Voir le projet » ouvre la fiche. Sur ordinateur, glisser un bloc le déplace (jour et heure).
        </span>
      </div>

      ${collisions ? `<div class="cal-alerte">${icon('alert', 14)}
        <span><strong>${collisions}</strong> créneau${collisions > 1 ? 'x se chevauchent' : ' se chevauche'} avec un autre cette semaine.
        Les blocs concernés sont côte à côte, aucun n'est masqué.</span></div>` : ''}

      ${sansHeures ? `<div class="cal-alerte">${icon('alert', 14)}
        <span><strong>${sansHeures}</strong> chantier${sansHeures > 1 ? 's sont affichés' : ' est affiché'} sur la journée standard
        (${POSE_DEFAUT.debut}–${POSE_DEFAUT.fin}) faute d'heures saisies. Ouvrir le bloc pour préciser les heures réelles.</span></div>` : ''}

      ${incoherents ? `<div class="cal-alerte">${icon('alert', 14)}
        <span><strong>${incoherents}</strong> chantier${incoherents > 1 ? 's ont' : ' a'} une heure de fin antérieure ou égale à l'heure de début.
        Affiché${incoherents > 1 ? 's' : ''} sur la journée standard en attendant correction.</span></div>` : ''}

      <div class="calw calw-pose" style="--calw-heures:${nbHeures}">
        <div class="calw-head">
          <div class="calw-gutter"></div>
          ${jours.map((d, i) => `
            <div class="calw-dayhead ${toISODate(d) === toISODate(today) ? 'is-today' : ''}">
              <span class="calw-dayhead-j">${JOURS[i]}</span>
              <span class="calw-dayhead-n">${d.getDate()}</span>
            </div>`).join('')}
        </div>
        <div class="calw-body">
          <div class="calw-gutter calw-hours">
            ${Array.from({ length: nbHeures }, (_, i) => `<div class="calw-hour"><span>${String(h0 + i).padStart(2, '0')}:00</span></div>`).join('')}
          </div>
          ${jours.map(d => {
            const iso = toISODate(d);
            return `
            <div class="calw-col ${iso === toISODate(today) ? 'is-today' : ''}" data-iso="${iso}">
              ${Array.from({ length: nbHeures }, (_, i) => `<div class="calw-slot" data-iso="${iso}" data-h="${h0 + i}"></div>`).join('')}
              ${poses.filter(p => p.jour === iso).map(p => blocPose(p, h0, nbHeures)).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>

      <p class="muted muted-with-icon" style="margin-top:16px">${icon('construction', 14)}
        Les dates de pose viennent de la fiche projet. Retirer un chantier du planning = vider ses dates de pose.
      </p>
    `;

    hydrateIcons(app);
    brancher(jours, h0, nbHeures);
  }

  function blocPose(p, h0, nbHeures) {
    const top = ((p.debut - h0 * 60) / (nbHeures * 60)) * 100;
    const haut = ((p.fin - p.debut) / (nbHeures * 60)) * 100;
    const largeur = 100 / p.nbCols;
    const titre = [
      p.client || '(client inconnu)',
      p.reference || '(projet sans référence)',
      `${heureDeMinutes(p.debut)}–${heureDeMinutes(p.fin)}`,
      p.total > 1 ? `jour ${p.rang} sur ${p.total} (${p.debutPose} → ${p.finPose})` : 'pose d’un jour',
      p.incoherente ? 'heures incohérentes — journée standard affichée'
        : (p.parDefaut ? 'heures non saisies — journée standard affichée' : ''),
    ].filter(Boolean).join(' · ');
    return `
      <div class="pose-bloc ${p.parDefaut ? 'is-defaut' : ''}"
           style="top:${top.toFixed(3)}%; height:${haut.toFixed(3)}%; left:${(p.col * largeur).toFixed(3)}%; width:calc(${largeur.toFixed(3)}% - 3px);"
           draggable="true"
           data-projet="${p.projetId}" data-jour="${p.jour}"
           data-debut-pose="${p.debutPose}" data-fin-pose="${p.finPose}"
           data-h-debut="${p.debut}" data-h-fin="${p.fin}"
           title="${esc(titre)}">
        <button class="pose-bloc-corps" data-action="ouvrir" title="Modifier les dates et les heures">
          <span class="pose-h">${heureDeMinutes(p.debut)}–${heureDeMinutes(p.fin)}${p.total > 1 ? ` · J${p.rang}/${p.total}` : ''}</span>
          <span class="pose-client">${esc(p.client || '(client inconnu)')}</span>
          <span class="pose-ref">${esc(p.reference || '(sans référence)')}</span>
          ${p.parDefaut ? `<span class="pose-defaut">${p.incoherente ? 'heures incohérentes' : 'heures non saisies'}</span>` : ''}
        </button>
        <button class="pose-cta" data-action="projet" title="Ouvrir la fiche projet">Voir le projet ${icon('arrowRight', 10)}</button>
        <span class="pose-grip" data-action="etirer" title="Tirer pour allonger la journée"></span>
      </div>`;
  }

  // Nombre de créneaux qui en recouvrent au moins un autre (nbCols > 1).
  function compterCollisions(poses) {
    return poses.filter(p => p.nbCols > 1).length;
  }

  // ─────────────────────────── Interactions ───────────────────────────

  function brancher(jours, h0, nbHeures) {
    document.getElementById('pose-prev').onclick = () => { ancre = decale(-7); draw(); };
    document.getElementById('pose-next').onclick = () => { ancre = decale(+7); draw(); };
    document.getElementById('pose-today').onclick = () => { ancre = lundiDeLaSemaine(today); draw(); };

    app.querySelectorAll('[data-action="projet"]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        navigateTo('projet', { id: b.closest('.pose-bloc').dataset.projet });
      });
    });
    app.querySelectorAll('[data-action="ouvrir"]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const bloc = b.closest('.pose-bloc');
        if (bloc.classList.contains('dragging') || bloc.dataset.etirement === '1') return;
        ouvrirModale(bloc.dataset.projet);
      });
    });

    brancherDeplacement(h0, nbHeures);
    brancherEtirement(h0, nbHeures);

    // Clic sur une case vide → planifier une pose (comme un agenda). Le bouton
    // d'en-tête ouvre la même fenêtre, préremplie sur le lundi de la semaine.
    document.getElementById('pose-new').onclick = () => ouvrirModaleCreation(toISODate(jours[0]), 8);
    app.querySelectorAll('.calw-slot').forEach(slot => {
      slot.addEventListener('click', () => ouvrirModaleCreation(slot.dataset.iso, Number(slot.dataset.h)));
    });
  }

  function decale(jours) {
    const d = new Date(ancre);
    d.setDate(d.getDate() + jours);
    return lundiDeLaSemaine(d);
  }

  // Déplacement : on saisit LE bloc d'un jour donné et on le lâche sur un créneau.
  // Le chantier entier suit le décalage de jours ; l'heure devient celle du créneau visé.
  function brancherDeplacement(h0, nbHeures) {
    let pris = null;
    app.querySelectorAll('.pose-bloc').forEach(el => {
      el.addEventListener('dragstart', e => {
        pris = { ...el.dataset };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        pris = null;
        app.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      });
    });

    app.querySelectorAll('.calw-slot').forEach(slot => {
      slot.addEventListener('dragover', e => { if (!pris) return; e.preventDefault(); slot.classList.add('drag-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', async e => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        if (!pris) return;
        const c = { ...pris };                    // capture AVANT await (dragend vide `pris`)
        const jourVise = slot.dataset.iso;
        const heureVisee = Number(slot.dataset.h) * 60;

        const delta = diffDays(jourDeValeurDate(c.jour), jourDeValeurDate(jourVise));
        const plage = deplacerPlage({ debut: Number(c.hDebut), fin: Number(c.hFin) }, heureVisee);
        const memeJour = delta === 0;
        const memeHeure = plage.debut === Number(c.hDebut);
        if (memeJour && memeHeure) return;        // rien n'a bougé

        const nDebut = decalerIso(c.debutPose, delta);
        const nFin = decalerIso(c.finPose, delta);
        const duree = diffDays(jourDeValeurDate(c.debutPose), jourDeValeurDate(c.finPose)) + 1;
        const quoi = [
          memeJour ? null : `du ${nDebut}${duree > 1 ? ` au ${nFin}` : ''}`,
          memeHeure ? null : `de ${heureDeMinutes(plage.debut)} à ${heureDeMinutes(plage.fin)}`,
        ].filter(Boolean).join(', ');
        const ok = await confirmModal(`Déplacer cette pose ${quoi} ?`, { okLabel: 'Déplacer' });
        if (!ok) return;

        await enregistrer(c.projet, {
          'Date pose prévue': nDebut,
          'Date pose fin': nFin,
          'Heure début pose': heureDeMinutes(plage.debut),
          'Heure fin pose': heureDeMinutes(plage.fin),
        }, `Pose déplacée ${quoi}`);
      });
    });
  }

  // Étirement par le bord bas : allonge (ou raccourcit) la journée de pose.
  // Pointer events plutôt que drag HTML5 — on a besoin de la position continue.
  function brancherEtirement(h0, nbHeures) {
    app.querySelectorAll('.pose-grip').forEach(grip => {
      grip.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        const bloc = grip.closest('.pose-bloc');
        const colonne = bloc.closest('.calw-col');
        const rect = colonne.getBoundingClientRect();
        const debut = Number(bloc.dataset.hDebut);
        bloc.dataset.etirement = '1';
        bloc.draggable = false;
        grip.setPointerCapture(e.pointerId);

        // Position Y → minute, arrondie au quart d'heure.
        const minuteDe = (clientY) => {
          const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
          return Math.round((h0 * 60 + ratio * nbHeures * 60) / 15) * 15;
        };
        let plage = { debut, fin: Number(bloc.dataset.hFin) };

        const bouge = ev => {
          plage = redimensionnerPlage({ debut }, minuteDe(ev.clientY));
          bloc.style.height = `${(((plage.fin - plage.debut) / (nbHeures * 60)) * 100).toFixed(3)}%`;
          const lbl = bloc.querySelector('.pose-h');
          if (lbl) lbl.textContent = `${heureDeMinutes(plage.debut)}–${heureDeMinutes(plage.fin)}`;
        };
        const fini = async ev => {
          grip.removeEventListener('pointermove', bouge);
          grip.removeEventListener('pointerup', fini);
          grip.removeEventListener('pointercancel', fini);
          bloc.draggable = true;
          // Le clic d'ouverture arrive juste après le pointerup : on garde le
          // drapeau le temps de ce tour de boucle pour ne pas ouvrir la fenêtre.
          setTimeout(() => { delete bloc.dataset.etirement; }, 0);
          if (plage.fin === Number(bloc.dataset.hFin)) { draw(); return; }
          const ok = await confirmModal(
            `Pose de ${heureDeMinutes(plage.debut)} à ${heureDeMinutes(plage.fin)} ? (appliqué à tous les jours de ce chantier)`,
            { okLabel: 'Enregistrer' });
          if (!ok) { draw(); return; }
          await enregistrer(bloc.dataset.projet, {
            'Heure début pose': heureDeMinutes(plage.debut),
            'Heure fin pose': heureDeMinutes(plage.fin),
          }, `Pose de ${heureDeMinutes(plage.debut)} à ${heureDeMinutes(plage.fin)}`);
        };
        grip.addEventListener('pointermove', bouge);
        grip.addEventListener('pointerup', fini);
        grip.addEventListener('pointercancel', fini);
      });
    });
  }

  // Écrit sur le projet et met à jour le state local pour un redessin immédiat.
  async function enregistrer(projetId, fields, messageOk) {
    try {
      await patchProjet(projetId, fields);
      const p = (state.projets || []).find(x => x.id === projetId);
      if (p) Object.assign(p, fields);
      draw();
      toast(messageOk, 'success');
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
      draw();
    }
  }

  // Fenêtre d'édition : dates + heures, saisie au clavier (indispensable au doigt,
  // le glisser-déposer étant inopérant sur mobile).
  function ouvrirModale(projetId) {
    const p = (state.projets || []).find(x => x.id === projetId);
    if (!p) { navigateTo('projet', { id: projetId }); return; }
    const plage = plagePose(p);
    const client = (state.clients || []).find(c => c.id === (p.Client || [])[0]);
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Pose — ${esc(p['Référence'] || '?')}</h2>
        <p class="muted" style="margin-top:0">${esc(client?.Nom || 'Client inconnu')}.
          ${plage.parDefaut
            ? `<strong>Heures non saisies</strong> : le planning affiche la journée standard ${POSE_DEFAUT.debut}–${POSE_DEFAUT.fin}${plage.incoherente ? ' (les heures enregistrées sont incohérentes)' : ''}.`
            : 'Les heures s\'appliquent à chaque jour du chantier.'}</p>
        <label>Premier jour <input type="date" data-debut value="${esc((p['Date pose prévue'] || '').slice(0, 10))}"></label>
        <label>Dernier jour <span class="muted">(vide = pose d'un jour)</span>
          <input type="date" data-fin value="${esc((p['Date pose fin'] || '').slice(0, 10))}"></label>
        <label>Heure de début <input type="time" data-h-debut value="${esc(p['Heure début pose'] || POSE_DEFAUT.debut)}"></label>
        <label>Heure de fin <input type="time" data-h-fin value="${esc(p['Heure fin pose'] || POSE_DEFAUT.fin)}"></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>
          <button type="button" class="btn btn-ghost" data-retirer style="color:var(--accent)">${icon('trash', 14)} Retirer du planning</button>
          <button type="button" class="btn btn-ghost" data-ouvrir>Voir le projet</button>
          <button type="button" class="btn btn-primary" data-enregistrer>Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-annuler]').onclick = close;
    modal.querySelector('[data-ouvrir]').onclick = () => { close(); navigateTo('projet', { id: projetId }); };

    modal.querySelector('[data-retirer]').onclick = async () => {
      const ok = await confirmModal(
        `Retirer « ${p['Référence'] || 'ce chantier'} » du planning de pose ? (vide les dates, réversible)`,
        { okLabel: 'Retirer', danger: true });
      if (!ok) return;
      close();
      await enregistrer(projetId,
        { 'Date pose prévue': null, 'Date pose fin': null },
        'Chantier retiré du planning');
    };

    modal.querySelector('[data-enregistrer]').onclick = async () => {
      const debut = modal.querySelector('[data-debut]').value || null;
      const fin = modal.querySelector('[data-fin]').value || null;
      const hD = modal.querySelector('[data-h-debut]').value || '';
      const hF = modal.querySelector('[data-h-fin]').value || '';
      if (fin && debut && fin < debut) { toast('Le dernier jour est avant le premier.', 'error', 5000); return; }
      const mD = minutesDeHeure(hD), mF = minutesDeHeure(hF);
      if (hD && hF && (mD === null || mF === null)) { toast('Heures illisibles (format attendu HH:MM).', 'error', 5000); return; }
      if (mD !== null && mF !== null && mF <= mD) { toast('L\'heure de fin doit être après l\'heure de début.', 'error', 5000); return; }
      close();
      await enregistrer(projetId, {
        'Date pose prévue': debut,
        'Date pose fin': fin,
        'Heure début pose': hD || null,
        'Heure fin pose': hF || null,
      }, 'Pose mise à jour');
    };
  }

  // Fenêtre de CRÉATION : on choisit le chantier à planifier (une pose = un
  // projet daté), le jour et les heures. Préremplie par la case cliquée.
  function ouvrirModaleCreation(isoPrefill, heurePrefill) {
    const projets = (state.projets || []).slice()
      .sort((a, b) => String(a['Référence'] || '').localeCompare(String(b['Référence'] || '')));
    if (!projets.length) { toast('Aucun chantier à planifier pour le moment.', 'error', 4000); return; }
    const clientById = new Map((state.clients || []).map(c => [c.id, c]));
    const label = (p) => {
      const cl = clientById.get((p.Client || [])[0]);
      return `${p['Référence'] || 'sans réf.'}${cl && cl.Nom ? ' — ' + cl.Nom : ''}`;
    };
    const aPlanifier = projets.filter(p => !p['Date pose prévue']);
    const planifiees = projets.filter(p => p['Date pose prévue']);
    const h = Math.max(7, Math.min(18, Number(heurePrefill) || 8));
    const hDebut = `${String(h).padStart(2, '0')}:00`;
    const hFin = `${String(h < 17 ? 17 : Math.min(19, h + 1)).padStart(2, '0')}:00`;

    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Planifier une pose</h2>
        <p class="muted" style="margin-top:0">Choisis le chantier, le jour et les heures. La pose apparaît aussitôt dans le planning.</p>
        <label>Chantier
          <select data-projet>
            ${aPlanifier.length ? `<optgroup label="À planifier">${aPlanifier.map(p => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('')}</optgroup>` : ''}
            ${planifiees.length ? `<optgroup label="Déjà planifiées (replanifier)">${planifiees.map(p => `<option value="${esc(p.id)}">${esc(label(p))} — le ${esc((p['Date pose prévue'] || '').slice(0, 10))}</option>`).join('')}</optgroup>` : ''}
          </select></label>
        <label>Premier jour <input type="date" data-debut value="${esc(isoPrefill || '')}"></label>
        <label>Dernier jour <span class="muted">(vide = pose d'un jour)</span>
          <input type="date" data-fin value=""></label>
        <label>Heure de début <input type="time" data-h-debut value="${hDebut}"></label>
        <label>Heure de fin <input type="time" data-h-fin value="${hFin}"></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>
          <button type="button" class="btn btn-primary" data-planifier>Planifier</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-annuler]').onclick = close;
    modal.querySelector('[data-planifier]').onclick = async () => {
      const projetId = modal.querySelector('[data-projet]').value;
      if (!projetId) { toast('Choisis un chantier.', 'error', 4000); return; }
      const debut = modal.querySelector('[data-debut]').value || null;
      if (!debut) { toast('Choisis le premier jour.', 'error', 4000); return; }
      const fin = modal.querySelector('[data-fin]').value || null;
      const hD = modal.querySelector('[data-h-debut]').value || '';
      const hF = modal.querySelector('[data-h-fin]').value || '';
      if (fin && fin < debut) { toast('Le dernier jour est avant le premier.', 'error', 5000); return; }
      const mD = minutesDeHeure(hD), mF = minutesDeHeure(hF);
      if (mD !== null && mF !== null && mF <= mD) { toast('L\'heure de fin doit être après l\'heure de début.', 'error', 5000); return; }
      close();
      await enregistrer(projetId, {
        'Date pose prévue': debut,
        'Date pose fin': fin,
        'Heure début pose': hD || null,
        'Heure fin pose': hF || null,
      }, 'Pose planifiée');
    };
  }

  draw();
}
