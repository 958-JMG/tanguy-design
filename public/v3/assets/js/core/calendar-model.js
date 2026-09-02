// Modèle de l'agenda — logique pure, sans DOM ni state global.
// Vit côté navigateur (ES module) mais est testé dans la suite Node
// (services/calendar-model.test.js, même transposition que client-match.js).
//
// Deux raisons d'exister :
//  1. le nom du projet doit apparaître sur CHAQUE entrée d'agenda (demande JMG 02/09),
//     or chaque source le porte différemment — ou pas du tout (SAV) ;
//  2. la vue semaine superpose des rendez-vous à la même heure : il faut les
//     répartir en colonnes plutôt que les empiler l'un sur l'autre.

// ─────────────────────────── Index des projets ───────────────────────────

// Map id projet → { id, nom }. Le « nom du projet » est le champ Référence
// (champ primaire d'Airtable) : chez Tanguy c'est du texte libre lisible
// (« Cuisine M », « Salle de bain »), pas un code.
export function indexProjetsParId(projets) {
  const m = new Map();
  for (const p of projets || []) {
    if (!p || !p.id) continue;
    m.set(p.id, { id: p.id, nom: String(p['Référence'] || '').trim() });
  }
  return m;
}

// Map id client → [projets]. Sert au repli des SAV, qui n'ont PAS de lien Projet
// dans Airtable (vérifié sur le schéma le 02/09) : seul le client les rattache.
export function indexProjetsParClient(projets) {
  const m = new Map();
  for (const p of projets || []) {
    if (!p || !p.id) continue;
    const cid = (p.Client || [])[0];
    if (!cid) continue;
    if (!m.has(cid)) m.set(cid, []);
    m.get(cid).push({ id: p.id, nom: String(p['Référence'] || '').trim() });
  }
  return m;
}

// ────────────────────── Résolution du nom de projet ──────────────────────

/**
 * Nom du projet d'une entrée d'agenda.
 *
 * Renvoie toujours un objet — jamais une chaîne nue — pour que l'appelant
 * sache D'OÙ vient le nom et puisse le signaler à l'écran :
 *   { nom: 'Cuisine M', origine: 'lien' }    → lien Projet renseigné
 *   { nom: 'Cuisine M', origine: 'client' }  → DÉDUIT (le client n'a qu'un projet)
 *   { nom: null, origine: 'aucun' }          → rien à afficher, et on le dit
 *   { nom: null, origine: 'ambigu' }         → plusieurs projets chez ce client
 *
 * Règle : on ne devine jamais entre plusieurs projets. Un nom faux serait pire
 * qu'un nom absent — il enverrait un poseur sur le mauvais chantier.
 */
export function resoudreProjet({ projetLink, clientLink }, { parId, parClient }) {
  const pid = (projetLink || [])[0];
  if (pid) {
    const p = parId && parId.get(pid);
    if (p && p.nom) return { nom: p.nom, origine: 'lien' };
    // Lien présent mais projet absent du jeu chargé (filtré, archivé…) :
    // on ne remonte pas d'un cran vers le client, ce serait inventer.
    return { nom: null, origine: 'aucun' };
  }
  const cid = (clientLink || [])[0];
  if (!cid) return { nom: null, origine: 'aucun' };
  const liste = (parClient && parClient.get(cid)) || [];
  if (liste.length === 1 && liste[0].nom) return { nom: liste[0].nom, origine: 'client' };
  if (liste.length > 1) return { nom: null, origine: 'ambigu' };
  return { nom: null, origine: 'aucun' };
}

// ─────────────────────────────── Semaines ────────────────────────────────

/** Lundi de la semaine contenant `d` (semaine ISO : lundi → dimanche). */
export function lundiDeLaSemaine(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const jour = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - jour);
  return x;
}

/** Les 7 dates (lundi → dimanche) de la semaine contenant `d`. */
export function joursDeLaSemaine(d) {
  const lundi = lundiDeLaSemaine(d);
  return Array.from({ length: 7 }, (_, i) => {
    const j = new Date(lundi);
    j.setDate(lundi.getDate() + i);
    return j;
  });
}

/**
 * Jour (minuit local) où tombe une valeur de date Airtable.
 *
 * Corrige un décalage bien réel : un rendez-vous « journée entière » est stocké
 * à minuit LOCAL, donc « 2026-09-04T22:00:00Z » en heure d'été. L'agenda lisait
 * les 10 premiers caractères de cette chaîne — soit le 4 septembre — pendant que
 * la liste des rendez-vous, elle, affichait le 5. Même record, deux jours.
 * Le même écart touchait tout rendez-vous avant 02:00 du matin.
 *
 * Deux formes acceptées :
 *   'YYYY-MM-DD'            → champ `date` Airtable, pris tel quel (aucun fuseau
 *                             en jeu ; le passer par Date() le décalerait à l'ouest
 *                             de Greenwich).
 *   ISO complet (avec 'T')  → instant, ramené au jour local.
 */
export function jourDeValeurDate(v) {
  const s = String(v || '');
  if (!s) return null;
  if (!s.includes('T')) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/** Minutes depuis minuit d'un ISO dateTime, en heure locale. null si absent/invalide. */
export function minutesDeIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/** '2026-09-02T14:30:00.000Z' → '14:30' (heure locale). '' si absent. */
export function heureCourte(iso) {
  const m = minutesDeIso(iso);
  if (m === null) return '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ──────────────────── Superposition : mise en colonnes ────────────────────

/**
 * Répartit en colonnes des créneaux qui se chevauchent (vue semaine / pose).
 *
 * Chaque entrée reçoit `col` (index de colonne) et `nbCols` (largeur du groupe),
 * de quoi calculer left = col/nbCols et width = 1/nbCols.
 *
 * Deux créneaux qui se touchent bout à bout (fin de l'un = début de l'autre) ne
 * se chevauchent PAS : 9h-10h et 10h-11h restent pleine largeur.
 *
 * @param {Array<{debut:number, fin:number}>} creneaux minutes depuis minuit
 * @returns {Array} les mêmes objets, enrichis de { col, nbCols }, triés par début
 */
export function disposerEnColonnes(creneaux) {
  const items = (creneaux || [])
    .filter(c => c && Number.isFinite(c.debut) && Number.isFinite(c.fin))
    .map(c => ({ ...c }))
    .sort((a, b) => (a.debut - b.debut) || (b.fin - a.fin));

  let groupe = [];        // créneaux du groupe de chevauchement courant
  let finsColonnes = [];  // fin du dernier créneau posé dans chaque colonne
  let finGroupe = -Infinity;

  const clore = () => {
    const n = finsColonnes.length || 1;
    for (const it of groupe) it.nbCols = n;
    groupe = [];
    finsColonnes = [];
    finGroupe = -Infinity;
  };

  for (const it of items) {
    // Plus aucun recouvrement avec le groupe en cours → on le ferme.
    if (it.debut >= finGroupe) clore();
    let col = finsColonnes.findIndex(fin => fin <= it.debut);
    if (col === -1) { col = finsColonnes.length; finsColonnes.push(it.fin); }
    else finsColonnes[col] = it.fin;
    it.col = col;
    groupe.push(it);
    if (it.fin > finGroupe) finGroupe = it.fin;
  }
  clore();
  return items;
}

/**
 * Bornes horaires à afficher dans une vue planning.
 *
 * Part d'une amplitude de bureau (8h-19h) et l'élargit pour qu'aucun créneau ne
 * tombe hors grille — un rendez-vous à 7h ne doit pas disparaître de l'écran
 * parce que la grille commence à 8h.
 *
 * @returns {{debut:number, fin:number}} en HEURES pleines
 */
export function amplitudeHoraire(creneaux, { debut = 8, fin = 19 } = {}) {
  let h0 = debut, h1 = fin;
  for (const c of creneaux || []) {
    if (!c || !Number.isFinite(c.debut) || !Number.isFinite(c.fin)) continue;
    h0 = Math.min(h0, Math.floor(c.debut / 60));
    h1 = Math.max(h1, Math.ceil(c.fin / 60));
  }
  return { debut: Math.max(0, h0), fin: Math.min(24, Math.max(h1, h0 + 1)) };
}
