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

// ───────────────────── Créneaux de pose (onglet Pose) ─────────────────────

// Journée de pose par défaut, quand les heures ne sont pas saisies sur le projet.
// Ce n'est pas une donnée : c'est ce qu'affiche l'écran tant que personne n'a
// précisé, et l'écran le signale.
export const POSE_DEFAUT = { debut: '08:00', fin: '17:00' };

/** 'HH:MM' → minutes depuis minuit. null si le format n'est pas exactement celui-là. */
export function minutesDeHeure(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

/** minutes depuis minuit → 'HH:MM'. Borné à [0, 23:59]. */
export function heureDeMinutes(min) {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(min) || 0)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/**
 * Plage horaire quotidienne d'une pose.
 *
 * Renvoie { debut, fin, parDefaut } en minutes, `parDefaut` disant si l'une des
 * deux heures manquait — l'écran doit le montrer plutôt que de faire passer
 * 08:00–17:00 pour une décision de Virginie.
 *
 * Une fin antérieure ou égale au début est refusée : on retombe sur la journée
 * standard et on le signale, plutôt que d'afficher un bloc de hauteur nulle
 * ou négative qui disparaîtrait de l'écran.
 */
export function plagePose(projet) {
  const d = minutesDeHeure(projet && projet['Heure début pose']);
  const f = minutesDeHeure(projet && projet['Heure fin pose']);
  if (d === null || f === null || f <= d) {
    return {
      debut: minutesDeHeure(POSE_DEFAUT.debut),
      fin: minutesDeHeure(POSE_DEFAUT.fin),
      parDefaut: true,
      // Vrai seulement si des heures ONT été saisies mais ne tiennent pas debout.
      incoherente: d !== null && f !== null && f <= d,
    };
  }
  return { debut: d, fin: f, parDefaut: false, incoherente: false };
}

/**
 * Nouvelle plage après un glisser-déposer vertical : on déplace le créneau à
 * `nouveauDebut` en conservant sa DURÉE, sans jamais déborder de la journée.
 * Un créneau plus long que la journée est tronqué, pas replié.
 */
export function deplacerPlage({ debut, fin }, nouveauDebut) {
  const duree = Math.max(15, fin - debut);
  let d = Math.max(0, Math.round(nouveauDebut));
  if (d + duree > 24 * 60) d = Math.max(0, 24 * 60 - duree);
  return { debut: d, fin: Math.min(24 * 60, d + duree) };
}

/**
 * Nouvelle fin après un redimensionnement par le bas.
 * Garde au moins 15 minutes de créneau et ne sort pas de la journée.
 */
export function redimensionnerPlage({ debut }, nouvelleFin) {
  return { debut, fin: Math.min(24 * 60, Math.max(debut + 15, Math.round(nouvelleFin))) };
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
