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
import {
  patchProjet, fetchPoseEquipes, patchPoseEquipes,
  fetchPoseEvenements, createPoseEvenement, patchPoseEvenement, deletePoseEvenement,
} from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { isoWeek } from '../core/rdv.js';
import {
  joursDeLaSemaine, lundiDeLaSemaine, disposerEnColonnes, amplitudeHoraire,
  jourDeValeurDate, plagePose, plageHoraire, deplacerPlage, redimensionnerPlage,
  heureDeMinutes, minutesDeHeure, POSE_DEFAUT,
  indexEquipes, classeEquipe,
} from '../core/calendar-model.js';

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MOIS_COURT = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
// Normalisation pour la recherche : sans accents, minuscule. Rend « Méré » et
// « mere » équivalents (utile aussi vu la dyslexie côté saisie).
function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
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
        kind: 'projet',
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
        equipe: String(p['Équipe pose'] || '').trim(),
        note: String(p['Note pose'] || '').trim(),
        debut: plage.debut,
        fin: plage.fin,
        parDefaut: plage.parDefaut,
        incoherente: plage.incoherente,
      });
    }
  }

  // Événements libres (livraison, réception, congé…) — même découpage en un
  // bloc par jour couvert, mais rattachés à aucun projet.
  for (const ev of state.poseEvenements || []) {
    const debut = jourDeValeurDate(ev.dateDebut);
    if (!debut) continue;
    let fin = jourDeValeurDate(ev.dateFin) || debut;
    if (fin < debut) fin = debut;            // garde-fou : jamais de bloc qui disparaît
    if (fin < j0 || debut > j6) continue;
    const plage = plageHoraire(ev.heureDebut, ev.heureFin);
    for (const j of jours) {
      if (j < debut || j > fin) continue;
      out.push({
        kind: 'evenement',
        evenementId: ev.id,
        jour: toISODate(j),
        rang: diffDays(debut, j) + 1,
        total: diffDays(debut, fin) + 1,
        debutPose: toISODate(debut),
        finPose: toISODate(fin),
        titre: String(ev.titre || '').trim(),
        equipe: String(ev.equipe || '').trim(),
        note: String(ev.note || '').trim(),
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

  // Équipes de pose : liste ordonnée (nom + id) → couleur par position.
  // Chargée une fois, avant le premier dessin (le planning s'affiche même si
  // l'appel échoue : blocs neutres plutôt qu'écran vide).
  let equipes = [];
  let idxEquipes = new Map();

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

    // Identité d'un créneau, quel que soit son type (chantier ou événement libre).
    const cleId = c => c.projetId || c.evenementId;
    const nbChantiers = new Set(creneaux.filter(c => c.kind === 'projet').map(c => c.projetId)).size;
    const nbEvenements = new Set(creneaux.filter(c => c.kind === 'evenement').map(c => c.evenementId)).size;
    const sansHeures = new Set(creneaux.filter(c => c.parDefaut && !c.incoherente).map(cleId)).size;
    const incoherents = new Set(creneaux.filter(c => c.incoherente).map(cleId)).size;
    const collisions = compterCollisions(poses);

    const resumeParts = [];
    if (nbChantiers) resumeParts.push(`<strong>${nbChantiers}</strong> chantier${nbChantiers > 1 ? 's' : ''}`);
    if (nbEvenements) resumeParts.push(`<strong>${nbEvenements}</strong> événement${nbEvenements > 1 ? 's' : ''} libre${nbEvenements > 1 ? 's' : ''}`);
    const resumeTxt = resumeParts.length ? `${resumeParts.join(' · ')} cette semaine.` : 'Aucune pose planifiée cette semaine.';

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
        <span class="pose-equipes-legend">${legendeEquipes()}</span>
        <span class="muted" style="flex-basis:100%">
          ${resumeTxt}
          Le planning des poses de la semaine, une équipe = une couleur.
          <strong>Cliquer une case vide pour planifier une pose</strong> (un chantier ou une saisie libre : livraison, congé…) ·
          toucher un bloc pour le modifier · tirer son bord bas pour l'allonger ·
          « Voir le projet » ouvre la fiche. Sur ordinateur, glisser un bloc le déplace (jour et heure).
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

  // Pastilles de couleur des équipes + « Sans équipe » + bouton admin de nommage.
  // Le silence est proscrit : si aucune équipe n'est configurée, on le dit et on
  // propose (aux admins) de les nommer.
  function legendeEquipes() {
    const puces = equipes.map((e, i) =>
      `<span class="legend-dot equipe-${i % 6}"></span> ${esc(e.name)}`).join('<span class="pose-eq-sep"></span>');
    const sans = `<span class="legend-dot equipe-none"></span> Sans équipe`;
    const boutonNommer = state.isAdmin
      ? `<button type="button" class="btn btn-ghost btn-sm" id="pose-eq-nommer">${icon('pencil', 13)} Nommer les équipes</button>`
      : '';
    if (!equipes.length) {
      return `<span class="muted">Aucune équipe configurée. ${state.isAdmin ? '' : 'Un admin peut les nommer.'}</span> ${sans} ${boutonNommer}`;
    }
    return `${puces}<span class="pose-eq-sep"></span>${sans} ${boutonNommer}`;
  }

  function blocPose(p, h0, nbHeures) {
    const top = ((p.debut - h0 * 60) / (nbHeures * 60)) * 100;
    const haut = ((p.fin - p.debut) / (nbHeures * 60)) * 100;
    const largeur = 100 / p.nbCols;
    const clEquipe = classeEquipe(p.equipe, idxEquipes);
    // Équipe renseignée mais absente de la liste chargée (option supprimée) : on
    // ne devine pas de couleur, mais on garde le nom en clair dans le bloc.
    const equipeConnue = clEquipe !== 'equipe-none';
    const estEvenement = p.kind === 'evenement';
    // Libellé principal : client+réf pour un chantier, titre libre pour un événement.
    const principal = estEvenement ? (p.titre || '(sans titre)') : (p.client || '(client inconnu)');
    const secondaire = estEvenement ? '' : (p.reference || '(sans référence)');

    const titre = [
      estEvenement ? `Événement libre : ${p.titre || '(sans titre)'}` : (p.client || '(client inconnu)'),
      estEvenement ? '' : (p.reference || '(projet sans référence)'),
      p.equipe ? `Équipe : ${p.equipe}` : 'Sans équipe',
      `${heureDeMinutes(p.debut)}–${heureDeMinutes(p.fin)}`,
      p.total > 1 ? `jour ${p.rang} sur ${p.total} (${p.debutPose} → ${p.finPose})`
        : (estEvenement ? 'événement d’un jour' : 'pose d’un jour'),
      p.note ? `Note : ${p.note}` : '',
      p.incoherente ? 'heures incohérentes — journée standard affichée'
        : (p.parDefaut ? 'heures non saisies — journée standard affichée' : ''),
    ].filter(Boolean).join(' · ');

    // Attribut d'identité + action d'ouverture selon le type.
    const idAttr = estEvenement
      ? `data-kind="evenement" data-evenement="${esc(p.evenementId)}"`
      : `data-kind="projet" data-projet="${esc(p.projetId)}"`;
    const ouvrirTitre = estEvenement
      ? 'Modifier le titre, les dates, les heures, l’équipe et la note'
      : "Modifier l'équipe, les dates, les heures et la note";
    // Seuls les chantiers ont une fiche projet à ouvrir.
    const cta = estEvenement
      ? ''
      : `<button class="pose-cta" data-action="projet" title="Ouvrir la fiche projet">Voir le projet ${icon('arrowRight', 10)}</button>`;

    return `
      <div class="pose-bloc ${clEquipe} ${p.parDefaut ? 'is-defaut' : ''} ${estEvenement ? 'is-evenement' : ''}"
           style="top:${top.toFixed(3)}%; height:${haut.toFixed(3)}%; left:${(p.col * largeur).toFixed(3)}%; width:calc(${largeur.toFixed(3)}% - 3px);"
           draggable="true"
           ${idAttr} data-jour="${p.jour}"
           data-debut-pose="${p.debutPose}" data-fin-pose="${p.finPose}"
           data-h-debut="${p.debut}" data-h-fin="${p.fin}"
           title="${esc(titre)}">
        <button class="pose-bloc-corps" data-action="ouvrir" title="${esc(ouvrirTitre)}">
          <span class="pose-h">${estEvenement ? icon('calendar', 10) + ' ' : ''}${heureDeMinutes(p.debut)}–${heureDeMinutes(p.fin)}${p.total > 1 ? ` · J${p.rang}/${p.total}` : ''}</span>
          <span class="pose-client">${esc(principal)}</span>
          ${secondaire ? `<span class="pose-ref">${esc(secondaire)}</span>` : ''}
          ${p.equipe ? `<span class="pose-equipe">${equipeConnue ? '' : '⚠ '}${esc(p.equipe)}</span>` : ''}
          ${p.note ? `<span class="pose-note">${esc(p.note)}</span>` : ''}
          ${p.parDefaut ? `<span class="pose-defaut">${p.incoherente ? 'heures incohérentes' : 'heures non saisies'}</span>` : ''}
        </button>
        ${cta}
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
    const btnNommer = document.getElementById('pose-eq-nommer');
    if (btnNommer) btnNommer.onclick = ouvrirModaleEquipes;

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
        if (bloc.dataset.kind === 'evenement') ouvrirModaleEvenement(bloc.dataset.evenement);
        else ouvrirModale(bloc.dataset.projet);
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
        const estEvenement = c.kind === 'evenement';
        const ok = await confirmModal(
          `Déplacer ${estEvenement ? 'cet événement' : 'cette pose'} ${quoi} ?`, { okLabel: 'Déplacer' });
        if (!ok) return;

        if (estEvenement) {
          await enregistrerEvenement(c.evenement, {
            dateDebut: nDebut,
            // On préserve « vide = un jour » : pas de date de fin pour un mono-jour.
            dateFin: duree > 1 ? nFin : null,
            heureDebut: heureDeMinutes(plage.debut),
            heureFin: heureDeMinutes(plage.fin),
          }, `Événement déplacé ${quoi}`);
        } else {
          await enregistrer(c.projet, {
            'Date pose prévue': nDebut,
            'Date pose fin': nFin,
            'Heure début pose': heureDeMinutes(plage.debut),
            'Heure fin pose': heureDeMinutes(plage.fin),
          }, `Pose déplacée ${quoi}`);
        }
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
          const estEvenement = bloc.dataset.kind === 'evenement';
          const ok = await confirmModal(
            `${estEvenement ? 'Événement' : 'Pose'} de ${heureDeMinutes(plage.debut)} à ${heureDeMinutes(plage.fin)} ? (appliqué à tous les jours)`,
            { okLabel: 'Enregistrer' });
          if (!ok) { draw(); return; }
          const msg = `${estEvenement ? 'Événement' : 'Pose'} de ${heureDeMinutes(plage.debut)} à ${heureDeMinutes(plage.fin)}`;
          if (estEvenement) {
            await enregistrerEvenement(bloc.dataset.evenement, {
              heureDebut: heureDeMinutes(plage.debut),
              heureFin: heureDeMinutes(plage.fin),
            }, msg);
          } else {
            await enregistrer(bloc.dataset.projet, {
              'Heure début pose': heureDeMinutes(plage.debut),
              'Heure fin pose': heureDeMinutes(plage.fin),
            }, msg);
          }
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

  // Écrit sur un événement libre et remplace sa copie locale (le serveur renvoie
  // l'événement normalisé, source de vérité du redessin).
  async function enregistrerEvenement(evenementId, fields, messageOk) {
    try {
      const ev = await patchPoseEvenement(evenementId, fields);
      const i = (state.poseEvenements || []).findIndex(x => x.id === evenementId);
      if (i >= 0 && ev) state.poseEvenements[i] = ev;
      draw();
      toast(messageOk, 'success');
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
      draw();
    }
  }

  // Crée un événement libre et l'ajoute au state local pour un redessin immédiat.
  async function creerEvenement(fields) {
    try {
      const ev = await createPoseEvenement(fields);
      if (ev) state.poseEvenements = [...(state.poseEvenements || []), ev];
      draw();
      toast('Événement planifié', 'success');
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  }

  // Retire un événement libre du planning (suppression franche de la ligne).
  async function supprimerEvenement(evenementId) {
    try {
      await deletePoseEvenement(evenementId);
      state.poseEvenements = (state.poseEvenements || []).filter(e => e.id !== evenementId);
      draw();
      toast('Événement retiré du planning', 'success');
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
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
        <label>Équipe <span class="muted">(couleur dans le planning)</span>
          ${selectEquipeHtml(p['Équipe pose'] || '')}</label>
        <label>Premier jour <input type="date" data-debut value="${esc((p['Date pose prévue'] || '').slice(0, 10))}"></label>
        <label>Dernier jour <span class="muted">(vide = pose d'un jour)</span>
          <input type="date" data-fin value="${esc((p['Date pose fin'] || '').slice(0, 10))}"></label>
        <label>Heure de début <input type="time" data-h-debut value="${esc(p['Heure début pose'] || POSE_DEFAUT.debut)}"></label>
        <label>Heure de fin <input type="time" data-h-fin value="${esc(p['Heure fin pose'] || POSE_DEFAUT.fin)}"></label>
        <label>Note pour l'équipe <span class="muted">(accès, consignes, contact… — visible sur le bloc)</span>
          <textarea data-note rows="2" placeholder="Ex : code portail 1234, se garer côté cour, prévenir M. Martin à l'arrivée.">${esc(p['Note pose'] || '')}</textarea></label>
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
      const equipe = modal.querySelector('[data-equipe]').value || '';
      const note = modal.querySelector('[data-note]').value.trim();
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
        'Équipe pose': equipe || null,
        'Note pose': note || null,
      }, 'Pose mise à jour');
    };
  }

  // Fenêtre d'édition d'un événement libre : intitulé, dates, heures, équipe, note.
  // Même ergonomie que la fenêtre de pose, mais écrit dans la table « Événements
  // pose » et non sur un projet ; « Retirer » supprime franchement la ligne.
  function ouvrirModaleEvenement(evenementId) {
    const ev = (state.poseEvenements || []).find(e => e.id === evenementId);
    if (!ev) { toast('Événement introuvable.', 'error', 4000); return; }
    const plage = plageHoraire(ev.heureDebut, ev.heureFin);
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Événement libre</h2>
        <p class="muted" style="margin-top:0">Saisie libre du planning (hors chantier).
          ${plage.parDefaut
            ? `<strong>Heures non saisies</strong> : le planning affiche la journée standard ${POSE_DEFAUT.debut}–${POSE_DEFAUT.fin}${plage.incoherente ? ' (les heures enregistrées sont incohérentes)' : ''}.`
            : 'Les heures s\'appliquent à chaque jour.'}</p>
        <label>Intitulé
          <input type="text" data-titre maxlength="120" value="${esc(ev.titre || '')}" placeholder="Ex : Livraison cuisine Martin"></label>
        <label>Équipe <span class="muted">(couleur dans le planning)</span>
          ${selectEquipeHtml(ev.equipe || '')}</label>
        <label>Premier jour <input type="date" data-debut value="${esc((ev.dateDebut || '').slice(0, 10))}"></label>
        <label>Dernier jour <span class="muted">(vide = un seul jour)</span>
          <input type="date" data-fin value="${esc((ev.dateFin || '').slice(0, 10))}"></label>
        <label>Heure de début <input type="time" data-h-debut value="${esc(ev.heureDebut || POSE_DEFAUT.debut)}"></label>
        <label>Heure de fin <input type="time" data-h-fin value="${esc(ev.heureFin || POSE_DEFAUT.fin)}"></label>
        <label>Note <span class="muted">(consignes… — visible sur le bloc)</span>
          <textarea data-note rows="2" placeholder="Ex : réceptionner au dépôt, prévenir l'atelier.">${esc(ev.note || '')}</textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>
          <button type="button" class="btn btn-ghost" data-retirer style="color:var(--accent)">${icon('trash', 14)} Retirer du planning</button>
          <button type="button" class="btn btn-primary" data-enregistrer>Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-annuler]').onclick = close;

    modal.querySelector('[data-retirer]').onclick = async () => {
      const ok = await confirmModal(
        `Retirer « ${ev.titre || 'cet événement'} » du planning ? (suppression définitive)`,
        { okLabel: 'Retirer', danger: true });
      if (!ok) return;
      close();
      await supprimerEvenement(evenementId);
    };

    modal.querySelector('[data-enregistrer]').onclick = async () => {
      const titre = (modal.querySelector('[data-titre]').value || '').trim();
      if (!titre) { toast('L\'intitulé ne peut pas être vide.', 'error', 4000); return; }
      const debut = modal.querySelector('[data-debut]').value || null;
      if (!debut) { toast('Choisis le premier jour.', 'error', 4000); return; }
      const fin = modal.querySelector('[data-fin]').value || null;
      const hD = modal.querySelector('[data-h-debut]').value || '';
      const hF = modal.querySelector('[data-h-fin]').value || '';
      const equipe = modal.querySelector('[data-equipe]').value || '';
      const note = modal.querySelector('[data-note]').value.trim();
      if (fin && fin < debut) { toast('Le dernier jour est avant le premier.', 'error', 5000); return; }
      const mD = minutesDeHeure(hD), mF = minutesDeHeure(hF);
      if (hD && hF && (mD === null || mF === null)) { toast('Heures illisibles (format attendu HH:MM).', 'error', 5000); return; }
      if (mD !== null && mF !== null && mF <= mD) { toast('L\'heure de fin doit être après l\'heure de début.', 'error', 5000); return; }
      close();
      await enregistrerEvenement(evenementId, {
        titre,
        dateDebut: debut,
        dateFin: fin,
        heureDebut: hD || null,
        heureFin: hF || null,
        equipe: equipe || null,
        note: note || null,
      }, 'Événement mis à jour');
    };
  }

  // Fenêtre de CRÉATION : deux modes.
  //  · « Chantier existant » → une pose = un projet daté (comportement initial).
  //  · « Saisie libre »      → un événement libre (livraison, congé…), sans projet.
  // Préremplie par la case cliquée. Si aucun projet n'est chargé, on démarre
  // d'emblée en saisie libre plutôt que de bloquer l'écran.
  function ouvrirModaleCreation(isoPrefill, heurePrefill) {
    const projets = (state.projets || []).slice()
      .sort((a, b) => String(a['Référence'] || '').localeCompare(String(b['Référence'] || '')));
    const clientById = new Map((state.clients || []).map(c => [c.id, c]));
    const h = Math.max(7, Math.min(18, Number(heurePrefill) || 8));
    const hDebut = `${String(h).padStart(2, '0')}:00`;
    const hFin = `${String(h < 17 ? 17 : Math.min(19, h + 1)).padStart(2, '0')}:00`;

    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Planifier une pose</h2>
        <p class="muted" style="margin-top:0">Un chantier du pipeline, ou une saisie libre pour ce qui n'y figure pas (livraison, réception, congé…). Choisis le jour et les heures : ça apparaît aussitôt dans le planning.</p>
        <div class="pose-mode" role="tablist" aria-label="Type d'entrée">
          <button type="button" class="pose-mode-btn" data-mode-btn="chantier" role="tab">Chantier existant</button>
          <button type="button" class="pose-mode-btn" data-mode-btn="libre" role="tab">Saisie libre</button>
        </div>
        <div data-section-chantier>
          <label>Chantier
            <input type="search" data-recherche placeholder="Rechercher un chantier (client, référence)…" autocomplete="off" enterkeyhint="search">
          </label>
          <input type="hidden" data-projet value="">
          <div class="pose-choisi" data-choisi hidden></div>
          <div class="pose-recherche" data-resultats></div>
        </div>
        <div data-section-libre hidden>
          <label>Intitulé <span class="muted">(ce que tu veux : livraison, réception, congé…)</span>
            <input type="text" data-titre maxlength="120" placeholder="Ex : Livraison cuisine Martin" autocomplete="off">
          </label>
        </div>
        <label>Équipe <span class="muted">(couleur dans le planning)</span>
          ${selectEquipeHtml('')}</label>
        <label>Premier jour <input type="date" data-debut value="${esc(isoPrefill || '')}"></label>
        <label>Dernier jour <span class="muted">(vide = un seul jour)</span>
          <input type="date" data-fin value=""></label>
        <label>Heure de début <input type="time" data-h-debut value="${hDebut}"></label>
        <label>Heure de fin <input type="time" data-h-fin value="${hFin}"></label>
        <label>Note pour l'équipe <span class="muted">(accès, consignes, contact…)</span>
          <textarea data-note rows="2" placeholder="Ex : code portail 1234, se garer côté cour, prévenir M. Martin à l'arrivée."></textarea></label>
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

    // ── Bascule chantier / saisie libre ──
    const sectionChantier = modal.querySelector('[data-section-chantier]');
    const sectionLibre = modal.querySelector('[data-section-libre]');
    const titreInput = modal.querySelector('[data-titre]');
    // Sans projet chargé, « Chantier existant » n'aurait rien à proposer.
    let mode = projets.length ? 'chantier' : 'libre';
    function appliquerMode() {
      sectionChantier.hidden = mode !== 'chantier';
      sectionLibre.hidden = mode !== 'libre';
      modal.querySelectorAll('[data-mode-btn]').forEach(b =>
        b.classList.toggle('is-active', b.dataset.modeBtn === mode));
      setTimeout(() => { (mode === 'libre' ? titreInput : champ)?.focus(); }, 30);
    }
    modal.querySelectorAll('[data-mode-btn]').forEach(b =>
      b.addEventListener('click', () => { mode = b.dataset.modeBtn; appliquerMode(); }));

    // ── Mini moteur de recherche de chantier (remplace la liste déroulante) ──
    const champ = modal.querySelector('[data-recherche]');
    const zone = modal.querySelector('[data-resultats]');
    const hidden = modal.querySelector('[data-projet]');
    const choisiEl = modal.querySelector('[data-choisi]');
    // Index de recherche : « référence + client », normalisé une fois.
    const indexRecherche = projets.map(p => {
      const cl = clientById.get((p.Client || [])[0]);
      return { p, hay: norm(`${p['Référence'] || ''} ${cl?.Nom || ''}`), planifiee: !!p['Date pose prévue'] };
    });
    const MAX = 30; // on ne noie pas l'écran ; le compteur dit s'il y en a plus

    function filtrer(q) {
      const toks = norm(q).split(/\s+/).filter(Boolean);
      let liste = indexRecherche;
      if (toks.length) liste = liste.filter(x => toks.every(t => x.hay.includes(t)));
      // À planifier d'abord, déjà planifiées ensuite (chacune déjà triée par réf.).
      return [...liste.filter(x => !x.planifiee), ...liste.filter(x => x.planifiee)];
    }

    function rendreResultats() {
      const q = champ.value;
      const res = filtrer(q);
      const selId = hidden.value;
      if (!res.length) {
        zone.innerHTML = `<p class="muted pose-recherche-vide">Aucun chantier ne correspond à « ${esc(q.trim())} ».</p>`;
        return;
      }
      const rows = res.slice(0, MAX).map(({ p, planifiee }) => {
        const cl = clientById.get((p.Client || [])[0]);
        const badge = planifiee
          ? `<span class="pose-res-badge">déjà le ${esc((p['Date pose prévue'] || '').slice(0, 10))}</span>` : '';
        return `
          <button type="button" class="pose-res-row ${p.id === selId ? 'is-selected' : ''}" data-pick="${esc(p.id)}">
            <span class="pose-res-ref">${esc(p['Référence'] || 'sans référence')}</span>
            <span class="pose-res-client">${esc(cl?.Nom || 'client inconnu')}</span>
            ${badge}
          </button>`;
      }).join('');
      const reste = res.length > MAX
        ? `<p class="muted pose-recherche-plus">+ ${res.length - MAX} autre${res.length - MAX > 1 ? 's' : ''} — affine la recherche.</p>` : '';
      zone.innerHTML = rows + reste;
    }

    function choisir(id) {
      hidden.value = id;
      const x = indexRecherche.find(v => v.p.id === id);
      const cl = x && clientById.get((x.p.Client || [])[0]);
      // On NE réécrit PAS le champ de recherche (sinon le libellé casserait le
      // filtre) : on affiche une ligne « choisi » et on garde la liste surlignée.
      if (x) {
        choisiEl.hidden = false;
        choisiEl.innerHTML = `${icon('check', 13)} Chantier choisi : <strong>${esc(x.p['Référence'] || 'sans réf.')}</strong>${cl?.Nom ? ' — ' + esc(cl.Nom) : ''}`;
        hydrateIcons(choisiEl);
        if (x.planifiee) toast(`« ${x.p['Référence'] || 'ce chantier'} » a déjà une pose le ${(x.p['Date pose prévue'] || '').slice(0, 10)} — tu la replanifies.`, 'info', 4500);
      }
      rendreResultats();
      zone.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    }

    zone.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) choisir(b.dataset.pick);
    });
    champ.addEventListener('input', () => { hidden.value = ''; choisiEl.hidden = true; choisiEl.innerHTML = ''; rendreResultats(); });
    champ.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = zone.querySelector('[data-pick]');
      if (first) choisir(first.dataset.pick);
    });
    rendreResultats();
    appliquerMode();

    modal.querySelector('[data-planifier]').onclick = async () => {
      const debut = modal.querySelector('[data-debut]').value || null;
      if (!debut) { toast('Choisis le premier jour.', 'error', 4000); return; }
      const fin = modal.querySelector('[data-fin]').value || null;
      const hD = modal.querySelector('[data-h-debut]').value || '';
      const hF = modal.querySelector('[data-h-fin]').value || '';
      const equipe = modal.querySelector('[data-equipe]').value || '';
      const note = modal.querySelector('[data-note]').value.trim();
      if (fin && fin < debut) { toast('Le dernier jour est avant le premier.', 'error', 5000); return; }
      const mD = minutesDeHeure(hD), mF = minutesDeHeure(hF);
      if (mD !== null && mF !== null && mF <= mD) { toast('L\'heure de fin doit être après l\'heure de début.', 'error', 5000); return; }

      if (mode === 'libre') {
        const titre = (titreInput.value || '').trim();
        if (!titre) { toast('Donne un intitulé à ta saisie libre.', 'error', 4000); return; }
        close();
        await creerEvenement({
          titre,
          dateDebut: debut,
          dateFin: fin,
          heureDebut: hD || null,
          heureFin: hF || null,
          equipe: equipe || null,
          note: note || null,
        });
        return;
      }

      const projetId = hidden.value;
      if (!projetId) { toast('Cherche et choisis un chantier.', 'error', 4000); return; }
      close();
      await enregistrer(projetId, {
        'Date pose prévue': debut,
        'Date pose fin': fin,
        'Heure début pose': hD || null,
        'Heure fin pose': hF || null,
        'Équipe pose': equipe || null,
        'Note pose': note || null,
      }, 'Pose planifiée');
    };
  }

  // <select> des équipes pour les modales. Option vide = « Sans équipe ». Si la
  // pose porte une équipe absente de la liste (option supprimée côté Airtable),
  // on l'ajoute quand même en tête, sélectionnée, pour ne pas l'effacer par erreur.
  function selectEquipeHtml(current) {
    const cur = String(current || '').trim();
    const connue = !cur || equipes.some(e => e.name === cur);
    const opts = [`<option value="">Sans équipe</option>`];
    if (!connue) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (équipe supprimée)</option>`);
    for (const e of equipes) {
      opts.push(`<option value="${esc(e.name)}" ${e.name === cur ? 'selected' : ''}>${esc(e.name)}</option>`);
    }
    return `<select data-equipe>${opts.join('')}</select>`;
  }

  // Modale admin : renommer les équipes et en ajouter (max 8). Les couleurs
  // suivent l'ordre ; renommer conserve la couleur et l'affectation des chantiers.
  function ouvrirModaleEquipes() {
    if (!state.isAdmin) return;
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    const ligne = (e, i) => `
      <div class="pose-eq-row" data-eq-row>
        <span class="legend-dot equipe-${i % 6}"></span>
        <input type="text" data-eq-name value="${esc(e ? e.name : '')}" data-eq-id="${esc(e ? e.id : '')}" maxlength="40" placeholder="Nom de l'équipe">
        <button type="button" class="btn btn-ghost btn-sm" data-eq-del title="Retirer cette équipe">${icon('x', 14)}</button>
      </div>`;
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Nommer les équipes</h2>
        <p class="muted" style="margin-top:0">Chaque équipe a une couleur (dans l'ordre). Renommer une équipe garde sa couleur
          et les chantiers qui lui sont déjà affectés. Retirer une équipe ne supprime pas les chantiers, ils repassent « sans équipe ».</p>
        <div data-eq-list>${(equipes.length ? equipes : [null]).map((e, i) => ligne(e, i)).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-eq-add>${icon('plus', 14)} Ajouter une équipe</button>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>
          <button type="button" class="btn btn-primary" data-enregistrer>Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-annuler]').onclick = close;

    const liste = modal.querySelector('[data-eq-list]');
    const recolorier = () => liste.querySelectorAll('[data-eq-row] .legend-dot').forEach((d, i) => { d.className = `legend-dot equipe-${i % 6}`; });
    liste.addEventListener('click', e => {
      const del = e.target.closest('[data-eq-del]');
      if (!del) return;
      if (liste.querySelectorAll('[data-eq-row]').length <= 1) { toast('Il faut au moins une équipe.', 'error', 4000); return; }
      del.closest('[data-eq-row]').remove();
      recolorier();
    });
    modal.querySelector('[data-eq-add]').onclick = () => {
      if (liste.querySelectorAll('[data-eq-row]').length >= 8) { toast('Maximum 8 équipes.', 'error', 4000); return; }
      liste.insertAdjacentHTML('beforeend', ligne(null, liste.querySelectorAll('[data-eq-row]').length));
      hydrateIcons(liste.lastElementChild);
      recolorier();
      liste.lastElementChild.querySelector('[data-eq-name]').focus();
    };

    modal.querySelector('[data-enregistrer]').onclick = async () => {
      const choices = [];
      const vus = new Set();
      for (const row of liste.querySelectorAll('[data-eq-row]')) {
        const name = row.querySelector('[data-eq-name]').value.trim();
        const id = row.querySelector('[data-eq-name]').dataset.eqId || '';
        if (!name) continue;                                   // ligne vide ignorée
        const key = name.toLowerCase();
        if (vus.has(key)) { toast(`Deux équipes portent le même nom : « ${name} ».`, 'error', 5000); return; }
        vus.add(key);
        choices.push(id ? { id, name } : { name });
      }
      if (!choices.length) { toast('Donne un nom à au moins une équipe.', 'error', 4000); return; }
      try {
        equipes = await patchPoseEquipes(choices);
        idxEquipes = indexEquipes(equipes);
        close();
        draw();
        toast('Équipes mises à jour', 'success');
      } catch (err) { toast('Erreur : ' + err.message, 'error', 6000); }
    };
  }

  // Chargement des équipes + des événements libres AVANT le premier dessin
  // (planning coloré et complet d'emblée). Chaque source échoue indépendamment :
  // un couac sur l'une ne doit pas priver le planning de l'autre.
  (async () => {
    const [eq, ev] = await Promise.allSettled([fetchPoseEquipes(), fetchPoseEvenements()]);
    if (eq.status === 'fulfilled') { equipes = eq.value; idxEquipes = indexEquipes(equipes); }
    state.poseEvenements = ev.status === 'fulfilled' ? ev.value : [];
    draw();
  })();
}
