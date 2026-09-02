// Calendar v3 — vue Mois et vue Semaine, drag-and-drop natif, sans lib externe.
//
// Agenda v2 (2026-06) : couleurs par type de RDV, drag des RDV, réception
// prévisionnelle en n° de semaine, création de RDV libre, gestion de la pose.
//
// Agenda v3 (2026-09-02, demande JMG) :
//   1. le NOM DU PROJET figure sur chaque entrée d'agenda (2e ligne de la carte) ;
//   2. une VUE SEMAINE en planning horaire s'ajoute à la vue mois.
// La logique pure (résolution du projet, mise en colonnes des chevauchements,
// amplitude horaire) vit dans core/calendar-model.js et est testée côté Node.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { patchProjet, fetchRendezVous, patchRendezVous, fetchCommandes, fetchSav } from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { openModalRdv, rdvTypeSlug, isAllDay, isoWeek } from '../core/rdv.js';
import {
  indexProjetsParId, indexProjetsParClient, resoudreProjet,
  joursDeLaSemaine, lundiDeLaSemaine, minutesDeIso, heureCourte, jourDeValeurDate,
  disposerEnColonnes, amplitudeHoraire,
} from '../core/calendar-model.js';

const MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

// Durée affichée d'un rendez-vous en vue semaine. La base ne stocke pas de durée
// (champ « Date et heure » seul) : 1 h est la convention d'affichage, pas une donnée.
const DUREE_RDV_MIN = 60;

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

// ─────────────────────────── Construction des events ───────────────────────────

// Construit la liste des événements recouvrant [debut, fin].
// Chaque event porte :
//   label      texte de la 1re ligne (qui / quoi)
//   projet     { nom, origine } — 2e ligne, cf. calendar-model.resoudreProjet
//   colorClass classe CSS statique
function buildEvents(debut, fin) {
  const events = [];
  const projets = state.projets || [];
  const idx = { parId: indexProjetsParId(projets), parClient: indexProjetsParClient(projets) };

  // Uniformisation 2026-07-28 : chaque entrée d'agenda commence par le CLIENT.
  // « Pose SDB » ou « Présentation devis » seuls ne disent rien sans le nom.
  const clientById = new Map((state.clients || []).map(c => [c.id, c]));
  const clientNom = (link) => {
    const v = (link || [])[0];
    if (!v) return '';
    // Le lien peut être un id (rec…) résolu via state.clients, ou déjà un nom brut.
    return clientById.get(v)?.Nom || (typeof v === 'string' && !v.startsWith('rec') ? v : '');
  };
  const prefixe = (nom, reste) => (nom ? `${nom} · ${reste}` : reste);

  // Projets : période pose (Date pose prévue → Date pose fin). Sans date de fin,
  // la pose est un marqueur d'UN jour — plus de span +5j par défaut qui remplissait
  // le calendrier de barres vides (jours de continuation « · ») sur les jours suivants.
  for (const p of projets) {
    const dStart = parseISODate(p['Date pose prévue']);
    if (!dStart) continue;
    const dEnd = parseISODate(p['Date pose fin']) || dStart;
    if (dEnd < debut || dStart > fin) continue;
    // La pose EST le projet : son nom va en 2e ligne comme partout ailleurs,
    // et la 1re ligne dit qui + quoi (« Dupont · Pose ») sans le répéter.
    events.push({
      type: 'pose',
      id: p.id,
      label: prefixe(clientNom(p.Client), 'Pose'),
      projet: { nom: String(p['Référence'] || '').trim() || null, origine: 'lien' },
      start: dStart,
      end: dEnd,
      allDay: true,
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
    const d = jourDeValeurDate(iso);
    if (!d || d < debut || d > fin) continue;
    const type = f.Type || '';
    const isReception = type === 'Réception';
    const cNom = clientNom(f.Client);
    const objet = f.Objet || type || 'RDV';
    // Sans client, on retombe sur l'ancien libellé « Type · Objet » (aucune perte d'info).
    const sansClient = `${type ? type + ' · ' : ''}${f.Objet || 'RDV'}`;
    events.push({
      type: 'rdv',
      id: r.id,
      label: isReception
        ? prefixe(cNom, `Récept. S${isoWeek(d)}`)
        : (cNom ? `${cNom} · ${objet}` : sansClient),
      // Un RDV porte un lien Projet (16 des 22 records au 02/09). Sans lien on
      // NE déduit PAS via le client : le RDV peut viser un autre chantier.
      projet: resoudreProjet({ projetLink: f.Projet }, idx),
      sousTitre: `${type ? type + ' · ' : ''}${f.Objet || 'RDV'}`,
      start: d,
      end: d,
      iso,                          // ISO complet conservé pour préserver l'heure au drag
      allDay: isAllDay(iso),
      colorClass: isReception ? 'color-reception' : rdvTypeSlug(type),
      draggable: true,
    });
  }

  // P-F (2026-06-24) — réception des marchandises : livraisons commandes fournisseurs
  // (« Date livraison prévue ») affichées comme marqueurs (non déplaçables). Couche additive.
  for (const c of state.commandesAll || []) {
    const d = jourDeValeurDate(c['Date livraison prévue']);
    if (!d || d < debut || d > fin) continue;
    const ref = c['Référence courte'] || c['Numéro'] || 'Commande';
    events.push({
      type: 'reception-cmd',
      id: c.id,
      label: `Récept. ${ref}`,
      // Lien Projet renseigné sur 100 % des commandes (relevé 02/09).
      projet: resoudreProjet({ projetLink: c.Projet }, idx),
      sousTitre: `Réception marchandises · ${ref}${c['Statut'] ? ' (' + c['Statut'] + ')' : ''}`,
      start: d,
      end: d,
      allDay: true,
      colorClass: 'color-reception',
      draggable: false,
    });
  }

  // P-F — réceptions SAV (pièces commandées, « Date réception » de la table SAV).
  // ⚠️ La table SAV n'a AUCUN lien Projet dans Airtable (vérifié au schéma le 02/09) :
  // le projet est déduit du client, et seulement quand le client n'en a qu'un.
  // La carte affiche alors le nom en style « déduit » — jamais comme un fait acquis.
  for (const s of state.savAll || []) {
    const d = jourDeValeurDate(s['Date réception']);
    if (!d || d < debut || d > fin) continue;
    const ref = s['Référence'] || 'SAV';
    events.push({
      type: 'reception-sav',
      id: s.id,
      label: `SAV ${ref}`,
      projet: resoudreProjet({ clientLink: s.Client }, idx),
      sousTitre: `Réception SAV · ${ref}`,
      start: d,
      end: d,
      allDay: true,
      colorClass: 'rtype-sav',
      draggable: false,
    });
  }

  return events;
}

// Tooltip complet d'une carte : qui/quoi, projet et sa provenance, dates.
function titreComplet(ev) {
  const bouts = [ev.sousTitre || ev.label];
  const p = ev.projet || {};
  if (p.nom && p.origine === 'lien') bouts.push(`Projet : ${p.nom}`);
  else if (p.nom && p.origine === 'client') bouts.push(`Projet : ${p.nom} (déduit du client — le SAV n'a pas de lien projet dans la base)`);
  else if (p.origine === 'ambigu') bouts.push('Projet indéterminé : ce client a plusieurs projets');
  else if (ev.type === 'rdv') bouts.push('Aucun projet rattaché — cliquer pour en choisir un');
  else if (p.origine === 'aucun') bouts.push('Aucun projet rattaché');
  if (ev.type !== 'rdv') bouts.push(`${toISODate(ev.start)} → ${toISODate(ev.end)}`);
  else if (!ev.allDay) bouts.push(heureCourte(ev.iso));
  return bouts.join(' · ');
}

// 2e ligne de la carte : le nom du projet. Le silence est proscrit — quand le nom
// manque, la carte le DIT au lieu de laisser croire qu'il n'y a rien à savoir.
function ligneProjet(ev) {
  const p = ev.projet || {};
  if (p.nom && p.origine === 'lien') return `<span class="cal-ev-projet">${esc(p.nom)}</span>`;
  if (p.nom && p.origine === 'client') return `<span class="cal-ev-projet is-deduit">${esc(p.nom)} ?</span>`;
  if (p.origine === 'ambigu') return `<span class="cal-ev-projet is-vide">projet indéterminé</span>`;
  if (ev.type === 'rdv') return `<span class="cal-ev-projet is-vide">sans projet</span>`;
  return `<span class="cal-ev-projet is-vide">—</span>`;
}

// Compte les entrées d'agenda dont le projet n'est pas établi (bandeau d'alerte).
function compterSansProjet(events) {
  return events.reduce((acc, ev) => {
    const o = (ev.projet || {}).origine;
    if (o === 'lien') return acc;
    if (o === 'client') { acc.deduits++; return acc; }
    if (ev.type === 'rdv') acc.rdvSansProjet++;
    return acc;
  }, { rdvSansProjet: 0, deduits: 0 });
}

// ─────────────────────────────────── Vue ───────────────────────────────────

export function renderCalendar(app) {
  const today = new Date();
  // Vue courante : mémorisée d'une visite à l'autre dans la session.
  let vue = sessionStorage.getItem('cal-vue') === 'semaine' ? 'semaine' : 'mois';
  let curYear = today.getFullYear();
  let curMonth = today.getMonth();
  let ancreSemaine = lundiDeLaSemaine(today);

  function reloadRdv() {
    fetchRendezVous().then(rs => { state.rendezVous = rs; draw(); }).catch(() => {});
  }

  function setVue(v) {
    vue = v;
    try { sessionStorage.setItem('cal-vue', v); } catch { /* navigation privée */ }
    draw();
  }

  // Bornes de la période affichée selon la vue.
  function bornes() {
    if (vue === 'semaine') {
      const js = joursDeLaSemaine(ancreSemaine);
      return { debut: js[0], fin: js[6] };
    }
    return { debut: new Date(curYear, curMonth, 1), fin: new Date(curYear, curMonth + 1, 0) };
  }

  function titrePeriode() {
    if (vue === 'mois') return `${MOIS_NOMS[curMonth]} ${curYear}`;
    const js = joursDeLaSemaine(ancreSemaine);
    const a = js[0], b = js[6];
    const meme = a.getMonth() === b.getMonth();
    const fmtA = meme ? a.getDate() : `${a.getDate()} ${MOIS_NOMS[a.getMonth()].slice(0, 4).toLowerCase()}`;
    const fmtB = `${b.getDate()} ${MOIS_NOMS[b.getMonth()].slice(0, 4).toLowerCase()}`;
    return `S${isoWeek(a)} · ${fmtA} – ${fmtB} ${b.getFullYear()}`;
  }

  function draw() {
    const { debut, fin } = bornes();
    const events = buildEvents(debut, fin);
    const manques = compterSansProjet(events);

    app.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Calendar</h1>
        <div class="cal-nav">
          <div class="cal-switch" role="group" aria-label="Choix de la vue">
            <button class="cal-switch-btn ${vue === 'mois' ? 'is-on' : ''}" id="cal-vue-mois" aria-pressed="${vue === 'mois'}">Mois</button>
            <button class="cal-switch-btn ${vue === 'semaine' ? 'is-on' : ''}" id="cal-vue-semaine" aria-pressed="${vue === 'semaine'}">Semaine</button>
          </div>
          <button class="btn btn-ghost btn-sm" id="cal-prev" aria-label="Période précédente">${icon('arrowLeft', 14)}</button>
          <strong class="cal-title">${esc(titrePeriode())}</strong>
          <button class="btn btn-ghost btn-sm" id="cal-next" aria-label="Période suivante">${icon('arrowRight', 14)}</button>
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
        <span class="muted" style="flex-basis:100%;margin-top:6px">
          Chaque carte porte le nom du projet en 2<sup>e</sup> ligne. Un nom suivi de « ? » est
          <em>déduit du client</em> faute de lien direct. Clic pour éditer · glisser-déposer pour déplacer (ordinateur).
        </span>
      </div>

      ${manques.rdvSansProjet ? `
      <div class="cal-alerte">
        ${icon('alert', 14)}
        <span><strong>${manques.rdvSansProjet}</strong> rendez-vous de cette période n'${manques.rdvSansProjet > 1 ? 'ont' : 'a'} aucun projet rattaché.
        Ouvrir le rendez-vous pour en choisir un — le champ « Projet » est en haut de la fenêtre.</span>
      </div>` : ''}

      <div id="cal-zone">${vue === 'mois' ? htmlMois(events) : htmlSemaine(events)}</div>

      <p class="muted muted-with-icon" style="margin-top:16px">${icon('construction', 14)}
        Poses, rendez-vous, réceptions marchandises (livraisons commandes) et réceptions SAV affichés.
      </p>
    `;

    hydrateIcons(app);
    brancherNavigation();
    brancherEvents();
  }

  // ───────────────────────────── Vue MOIS ─────────────────────────────

  function htmlMois(events) {
    const debutMois = new Date(curYear, curMonth, 1);
    const finMois = new Date(curYear, curMonth + 1, 0);
    let firstDay = debutMois.getDay() - 1; if (firstDay < 0) firstDay = 6;
    const nbJours = finMois.getDate();
    const nbCases = Math.ceil((firstDay + nbJours) / 7) * 7;

    // Map événements par jour ISO (un event multi-jours apparaît sur chaque jour couvert).
    const parJour = new Map();
    for (const ev of events) {
      const d = new Date(ev.start);
      while (d <= ev.end) {
        const iso = toISODate(d);
        if (!parJour.has(iso)) parJour.set(iso, []);
        parJour.get(iso).push({ ...ev, isStart: d.getTime() === ev.start.getTime(), isEnd: d.getTime() === ev.end.getTime() });
        d.setDate(d.getDate() + 1);
      }
    }

    return `
      <div class="cal-grid">
        <div class="cal-header">${JOURS.map(j => `<div class="cal-header-day">${j}</div>`).join('')}</div>
        <div class="cal-body">
          ${Array.from({ length: nbCases }, (_, i) => {
            const dayNum = i - firstDay + 1;
            const isInMonth = dayNum >= 1 && dayNum <= nbJours;
            const dayDate = isInMonth ? new Date(curYear, curMonth, dayNum) : null;
            const iso = dayDate ? toISODate(dayDate) : '';
            const isToday = dayDate && iso === toISODate(today);
            const evs = parJour.get(iso) || [];
            return `
            <div class="cal-cell ${isInMonth ? '' : 'cal-cell-empty'} ${isToday ? 'is-today' : ''}" data-iso="${iso}">
              ${isInMonth ? `<div class="cal-day-num">${dayNum}</div>` : ''}
              ${evs.slice(0, 3).map(ev => carteMois(ev)).join('')}
              ${evs.length > 3 ? `<div class="cal-more muted">+ ${evs.length - 3}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // Carte du mois : 2 lignes — (1) qui/quoi, (2) nom du projet.
  // Les jours de continuation d'une pose restent une barre nue (pas de répétition).
  function carteMois(ev) {
    return `
      <button class="cal-event ${ev.colorClass} ${ev.isStart ? 'is-start' : ''} ${ev.isEnd ? 'is-end' : ''} ${ev.isStart ? 'has-projet' : ''}"
              draggable="${ev.draggable}"
              data-id="${ev.id}" data-type="${ev.type}"
              data-start="${toISODate(ev.start)}" data-end="${toISODate(ev.end)}"
              title="${esc(titreComplet(ev))}">
        ${ev.isStart ? `<span class="cal-ev-titre">${esc(ev.label)}</span>${ligneProjet(ev)}` : '<span class="cal-ev-titre">·</span>'}
      </button>`;
  }

  // ──────────────────────────── Vue SEMAINE ────────────────────────────

  function htmlSemaine(events) {
    const jours = joursDeLaSemaine(ancreSemaine);
    const isoJours = jours.map(toISODate);

    // Deux bandes : le haut pour ce qui n'a pas d'heure, le bas pour l'horaire.
    const bandeHaut = events.filter(ev => ev.allDay || ev.type !== 'rdv');
    const horaires = events.filter(ev => ev.type === 'rdv' && !ev.allDay);

    // Créneaux (minutes) pour la mise en colonnes et l'amplitude de la grille.
    const creneaux = horaires.map(ev => {
      const m = minutesDeIso(ev.iso);
      return { ...ev, debut: m ?? 0, fin: (m ?? 0) + DUREE_RDV_MIN, jour: toISODate(ev.start) };
    });
    const { debut: h0, fin: h1 } = amplitudeHoraire(creneaux);
    const nbHeures = h1 - h0;

    // Mise en colonnes JOUR PAR JOUR : deux RDV le même jour à la même heure se
    // partagent la largeur ; deux RDV de jours différents ne se gênent pas.
    const parJour = new Map(isoJours.map(iso => [iso, []]));
    for (const c of creneaux) if (parJour.has(c.jour)) parJour.get(c.jour).push(c);
    const poses = [];
    for (const [iso, liste] of parJour) {
      for (const c of disposerEnColonnes(liste)) poses.push({ ...c, jour: iso });
    }

    // Bande « journée » : chaque event occupe les colonnes des jours qu'il couvre.
    const lignesHaut = repartirEnLignes(bandeHaut, jours);

    return `
      <div class="calw" style="--calw-heures:${nbHeures}">
        <div class="calw-head">
          <div class="calw-gutter"></div>
          ${jours.map((d, i) => `
            <div class="calw-dayhead ${toISODate(d) === toISODate(today) ? 'is-today' : ''}">
              <span class="calw-dayhead-j">${JOURS[i]}</span>
              <span class="calw-dayhead-n">${d.getDate()}</span>
            </div>`).join('')}
        </div>

        <!-- Bande « journée » : UNE seule grille, partagée avec l'en-tête et la grille
             horaire (gouttière + 7 colonnes). Une grille imbriquée désalignait les
             cases de dépôt — le glisser-déposer visait alors le mauvais jour. -->
        <div class="calw-allday" style="--calw-lignes:${Math.max(lignesHaut.length, 1)}">
          <div class="calw-gutter">journée</div>
          ${jours.map((d, i) => `<div class="calw-allday-drop" style="grid-column:${i + 2}" data-iso="${toISODate(d)}"></div>`).join('')}
          ${lignesHaut.map((ligne, li) => ligne.map(ev => {
            const from = Math.max(0, diffDays(jours[0], ev.start));
            const to = Math.min(6, diffDays(jours[0], ev.end));
            // +2 : la colonne 1 est la gouttière des heures.
            return `
              <button class="calw-band ${ev.colorClass} has-projet"
                      style="grid-column:${from + 2} / ${to + 3}; grid-row:${li + 1}"
                      draggable="${ev.draggable}"
                      data-id="${ev.id}" data-type="${ev.type}"
                      data-start="${toISODate(ev.start)}" data-end="${toISODate(ev.end)}"
                      title="${esc(titreComplet(ev))}">
                <span class="cal-ev-titre">${esc(ev.label)}</span>${ligneProjet(ev)}
              </button>`;
          }).join('')).join('')}
        </div>

        <div class="calw-body">
          <div class="calw-gutter calw-hours">
            ${Array.from({ length: nbHeures }, (_, i) => `<div class="calw-hour"><span>${String(h0 + i).padStart(2, '0')}:00</span></div>`).join('')}
          </div>
          ${jours.map(d => {
            const iso = toISODate(d);
            const dedans = poses.filter(p => p.jour === iso);
            return `
            <div class="calw-col ${iso === toISODate(today) ? 'is-today' : ''}" data-iso="${iso}">
              ${Array.from({ length: nbHeures }, (_, i) => `<div class="calw-slot" data-iso="${iso}" data-h="${h0 + i}"></div>`).join('')}
              ${dedans.map(ev => {
                const top = ((ev.debut - h0 * 60) / (nbHeures * 60)) * 100;
                const haut = (DUREE_RDV_MIN / (nbHeures * 60)) * 100;
                const largeur = 100 / ev.nbCols;
                return `
                  <button class="calw-ev ${ev.colorClass} has-projet"
                          style="top:${top.toFixed(3)}%; height:${haut.toFixed(3)}%; left:${(ev.col * largeur).toFixed(3)}%; width:calc(${largeur.toFixed(3)}% - 3px);"
                          draggable="${ev.draggable}"
                          data-id="${ev.id}" data-type="${ev.type}"
                          data-start="${toISODate(ev.start)}" data-end="${toISODate(ev.end)}"
                          title="${esc(titreComplet(ev))}">
                    <span class="calw-ev-h">${esc(heureCourte(ev.iso))}</span>
                    <span class="cal-ev-titre">${esc(ev.label)}</span>${ligneProjet(ev)}
                  </button>`;
              }).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // Empile les bandes « journée » sur le moins de lignes possible sans les superposer.
  function repartirEnLignes(evts, jours) {
    const j0 = jours[0], j6 = jours[6];
    const items = evts
      .filter(ev => ev.end >= j0 && ev.start <= j6)
      .map(ev => ({ ...ev, from: Math.max(0, diffDays(j0, ev.start)), to: Math.min(6, diffDays(j0, ev.end)) }))
      .sort((a, b) => (a.from - b.from) || (b.to - a.to));
    const lignes = [];
    for (const it of items) {
      let l = lignes.find(ligne => ligne.every(x => it.from > x.to || it.to < x.from));
      if (!l) { l = []; lignes.push(l); }
      l.push(it);
    }
    return lignes;
  }

  // ──────────────────────────── Interactions ────────────────────────────

  function brancherNavigation() {
    document.getElementById('cal-vue-mois').onclick = () => setVue('mois');
    document.getElementById('cal-vue-semaine').onclick = () => setVue('semaine');
    document.getElementById('cal-prev').onclick = () => decaler(-1);
    document.getElementById('cal-next').onclick = () => decaler(+1);
    document.getElementById('cal-today').onclick = () => {
      curYear = today.getFullYear(); curMonth = today.getMonth();
      ancreSemaine = lundiDeLaSemaine(today);
      draw();
    };
    document.getElementById('cal-new-rdv').onclick = () => openModalRdv({ onSaved: reloadRdv });
  }

  function decaler(sens) {
    if (vue === 'semaine') {
      const d = new Date(ancreSemaine);
      d.setDate(d.getDate() + 7 * sens);
      ancreSemaine = lundiDeLaSemaine(d);
    } else {
      curMonth += sens;
      if (curMonth < 0) { curMonth = 11; curYear--; }
      if (curMonth > 11) { curMonth = 0; curYear++; }
    }
    draw();
  }

  function brancherEvents() {
    // Clic : éditer un RDV, ou gérer une pose.
    app.querySelectorAll('.cal-event, .calw-ev, .calw-band').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('dragging')) return;
        const id = el.dataset.id;
        if (el.dataset.type === 'pose') return openModalPose(id);
        if (el.dataset.type === 'rdv') {
          const rdv = (state.rendezVous || []).find(r => r.id === id);
          if (rdv) openModalRdv({ rdv, onSaved: reloadRdv });
          return;
        }
        // Réceptions (commande / SAV) : le CTA mène à la rubrique correspondante.
        if (el.dataset.type === 'reception-cmd') return navigateTo('commande', { id });
        if (el.dataset.type === 'reception-sav') return navigateTo('sav');
      });
    });

    // Drag & drop. En vue mois on dépose sur un jour ; en vue semaine sur un
    // créneau horaire (le RDV prend l'heure du créneau) ou sur la bande « journée ».
    let dragData = null;
    app.querySelectorAll('[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', e => {
        dragData = { id: el.dataset.id, type: el.dataset.type, start: el.dataset.start, end: el.dataset.end };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        dragData = null;
        app.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      });
    });

    const cibles = app.querySelectorAll('.cal-cell:not(.cal-cell-empty), .calw-slot, .calw-allday-drop');
    cibles.forEach(cell => {
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
        const captured = { ...dragData };
        const newStartIso = cell.dataset.iso;
        // Heure du créneau visé (vue semaine) ; absente ailleurs → l'heure est conservée.
        const heure = cell.dataset.h !== undefined ? Number(cell.dataset.h) : null;
        if (!newStartIso) return;
        if (newStartIso === captured.start && heure === null) return; // aucun changement

        if (captured.type === 'pose') await dropPose(captured, newStartIso);
        else if (captured.type === 'rdv') await dropRdv(captured, newStartIso, heure);
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

  // Déplacement d'un RDV. `heure` non nulle (vue semaine) → le RDV prend cette heure ;
  // sinon on préserve l'heure du jour (journée entière → minuit).
  async function dropRdv(captured, newStartIso, heure = null) {
    const rdv = (state.rendezVous || []).find(r => r.id === captured.id);
    if (!rdv) return;
    const f = rdv.fields || {};
    const oldIso = f['Date et heure'];
    const allDay = isAllDay(oldIso);
    const old = new Date(oldIso);
    const [y, m, d] = newStartIso.split('-').map(Number);
    const newDate = heure !== null
      ? new Date(y, m - 1, d, heure, 0, 0)
      : (allDay ? new Date(y, m - 1, d, 0, 0, 0) : new Date(y, m - 1, d, old.getHours(), old.getMinutes(), 0));
    const quand = heure !== null
      ? `${newStartIso} à ${String(heure).padStart(2, '0')}:00`
      : newStartIso;
    const ok = await confirmModal(`Déplacer le rendez-vous au ${quand} ?`, { okLabel: 'Déplacer' });
    if (!ok) return;
    try {
      await patchRendezVous(captured.id, { 'Date et heure': newDate.toISOString() });
      f['Date et heure'] = newDate.toISOString();
      draw();
      toast(`Rendez-vous déplacé au ${quand}`, 'success');
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
        <label>Date de pose (début)
          <input type="date" data-pose-debut value="${esc((p['Date pose prévue'] || '').slice(0, 10))}">
        </label>
        <label>Date de pose (fin) <span class="muted">(optionnel)</span>
          <input type="date" data-pose-fin value="${esc((p['Date pose fin'] || '').slice(0, 10))}">
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-pose-cancel>Annuler</button>
          <button type="button" class="btn btn-ghost" data-pose-clear style="color:var(--accent)">${icon('trash', 14)} Retirer</button>
          <button type="button" class="btn btn-ghost" data-pose-open>Ouvrir</button>
          <button type="button" class="btn btn-primary" data-pose-save>Enregistrer</button>
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
    // Fallback mobile au drag (inopérant au doigt) : éditer les dates de pose à la main.
    modal.querySelector('[data-pose-save]').onclick = async () => {
      const debut = modal.querySelector('[data-pose-debut]').value || null;
      const fin = modal.querySelector('[data-pose-fin]').value || null;
      try {
        await patchProjet(projetId, { 'Date pose prévue': debut, 'Date pose fin': fin });
        p['Date pose prévue'] = debut; p['Date pose fin'] = fin;
        close(); draw();
        toast('Dates de pose mises à jour', 'success');
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    };
  }

  draw();
  // Charge les rendez-vous puis redessine (les poses s'affichent immédiatement).
  (async () => {
    try { state.rendezVous = await fetchRendezVous(); draw(); } catch (e) { /* poses seules si échec */ }
  })();
  // P-F — charge commandes (livraisons) + SAV (réceptions) pour la couche réception de l'agenda.
  (async () => {
    try { state.commandesAll = await fetchCommandes(); draw(); } catch (e) { /* sans réceptions commandes si échec */ }
  })();
  (async () => {
    try { state.savAll = await fetchSav(); draw(); } catch (e) { /* sans réceptions SAV si échec */ }
  })();
}
