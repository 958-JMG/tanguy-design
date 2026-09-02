/**
 * services/conges-helper.js — compteurs de congés payés (2026-09-02, demande JMG)
 *
 * Ce que ça remplace. Le champ Airtable « Solde congés » était un compteur qui
 * NE FAISAIT QUE DESCENDRE : décrémenté à la validation d'une absence, saisi à
 * la main à la création du salarié, crédité nulle part. D'où les soldes relevés
 * le 02/09/2026 : Sébastien −25, Thomas −6. Ici le compteur est RECALCULÉ à
 * chaque affichage — acquis moins pris — donc il ne peut plus dériver.
 *
 * Règles retenues (choix JMG du 02/09) :
 *   • Période de référence : 1er juin → 31 mai (règle légale par défaut).
 *   • Décompte en JOURS OUVRABLES : 2,5 jours acquis par mois, plafond 30/an,
 *     et le samedi compte. Une semaine de congés consomme donc 6 jours.
 *   • Jours fériés tombant un jour ouvrable : non décomptés.
 *
 * Deux prudences volontaires :
 *   1. Les jours pris sont comptés en jours DISTINCTS, pas en somme des durées
 *      de chaque absence. Deux absences qui se recouvrent existent réellement
 *      dans la base (doublons de saisie du 02/09) ; les additionner donnait
 *      50 jours à un salarié qui n'en a pas pris 50.
 *   2. Les RTT ne sont PAS calculés : le régime horaire de Tanguy n'est pas
 *      connu (JMG, 02/09 : « je ne sais pas »). Les RTT posés sont comptés et
 *      affichés, mais aucun droit annuel n'est inventé — `droitsRTT` reste null
 *      tant que la règle n'est pas donnée.
 *
 * Ce que la fonction ne prétend PAS faire, et qui doit être validé en paie :
 *   • l'acquisition est comptée par mois calendaire de présence, pas en périodes
 *     de travail effectif (4 semaines / 24 jours ouvrables) ;
 *   • l'effet des arrêts maladie sur l'acquisition n'est pas modélisé ;
 *   • une éventuelle convention collective plus favorable n'est pas prise en compte.
 * Ces trois limites sont remontées à l'appelant (`limites`) pour être affichées.
 */

const ACQUISITION_PAR_MOIS = 2.5;   // jours ouvrables
const PLAFOND_ANNUEL = 30;          // jours ouvrables
const TYPES_CP = ['Congés payés'];
const TYPES_RTT = ['RTT'];

// ───────────────────────────── Dates utilitaires ─────────────────────────────

/** 'YYYY-MM-DD' → {y, m, d}. null si la forme n'est pas exactement celle-là. */
function decouper(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** 'YYYY-MM-DD' → Date UTC (aucun fuseau en jeu : ce sont des dates civiles). */
function versDate(iso) {
  const p = decouper(iso);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  // Rejette le 31 février et consorts, que Date normaliserait en silence.
  if (dt.getUTCMonth() !== p.m - 1 || dt.getUTCDate() !== p.d) return null;
  return dt;
}

function versIso(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ─────────────────────────────── Jours fériés ────────────────────────────────

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, jour));
}

function ajouterJours(dt, n) {
  const x = new Date(dt.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Jours fériés français (métropole) d'une année, en 'YYYY-MM-DD'.
 * Alsace-Moselle (Vendredi saint, 26 décembre) non inclus : Tanguy est à Vannes.
 */
function joursFeries(annee) {
  const p = paques(annee);
  return new Set([
    `${annee}-01-01`, `${annee}-05-01`, `${annee}-05-08`, `${annee}-07-14`,
    `${annee}-08-15`, `${annee}-11-01`, `${annee}-11-11`, `${annee}-12-25`,
    versIso(ajouterJours(p, 1)),   // lundi de Pâques
    versIso(ajouterJours(p, 39)),  // Ascension
    versIso(ajouterJours(p, 50)),  // lundi de Pentecôte
  ]);
}

const _cacheFeries = new Map();
function feriesDeLAnnee(annee) {
  if (!_cacheFeries.has(annee)) _cacheFeries.set(annee, joursFeries(annee));
  return _cacheFeries.get(annee);
}

/** Jour ouvrable = lundi à samedi, hors jour férié. */
function estOuvrable(iso) {
  const dt = versDate(iso);
  if (!dt) return false;
  const jour = dt.getUTCDay();            // 0 = dimanche
  if (jour === 0) return false;
  return !feriesDeLAnnee(dt.getUTCFullYear()).has(iso);
}

/** Liste des jours ouvrables de [debut, fin] inclus. [] si bornes invalides ou inversées. */
function joursOuvrablesEntre(debut, fin) {
  const d0 = versDate(debut), d1 = versDate(fin);
  if (!d0 || !d1 || d1 < d0) return [];
  const out = [];
  for (let d = d0; d <= d1; d = ajouterJours(d, 1)) {
    const iso = versIso(d);
    if (estOuvrable(iso)) out.push(iso);
  }
  return out;
}

// ────────────────────────── Période de référence ──────────────────────────

/**
 * Période de référence contenant `iso` : 1er juin → 31 mai.
 * Le 02/09/2026 tombe donc dans « 01/06/2026 → 31/05/2027 ».
 */
function periodeDeReference(iso) {
  const p = decouper(iso);
  if (!p) throw new Error(`periodeDeReference: date invalide "${iso}" (attendu YYYY-MM-DD)`);
  const anneeDebut = p.m >= 6 ? p.y : p.y - 1;
  return {
    debut: `${anneeDebut}-06-01`,
    fin: `${anneeDebut + 1}-05-31`,
    libelle: `1ᵉʳ juin ${anneeDebut} – 31 mai ${anneeDebut + 1}`,
  };
}

// ─────────────────────────────── Acquisition ───────────────────────────────

/**
 * Mois CALENDAIRES complets travaillés entre `debut` et `aujourdhui`.
 *
 * Un mois est acquis à sa fin : au 02/09, juin, juillet et août sont acquis,
 * septembre non. Compter par date anniversaire donnerait un mois de moins sur
 * une période entière (le 12ᵉ mois tomberait au 1ᵉʳ juin suivant, hors période)
 * et une année pleine ne vaudrait que 27,5 jours au lieu des 30 légaux.
 *
 * Un mois entamé n'est pas compté : une entrée au 15 août fait démarrer
 * l'acquisition en septembre. C'est une simplification — la loi raisonne en
 * périodes de travail effectif (4 semaines / 24 jours ouvrables) — assumée et
 * remontée à l'appelant.
 */
function moisComplets(debut, aujourdhui) {
  const d0 = versDate(debut), now = versDate(aujourdhui);
  if (!d0 || !now || now < d0) return 0;
  let y = d0.getUTCFullYear();
  let m = d0.getUTCMonth();
  if (d0.getUTCDate() !== 1) { m++; if (m > 11) { m = 0; y++; } }
  let mois = 0;
  while (mois < 12) {
    const finDuMois = new Date(Date.UTC(y, m + 1, 0));   // jour 0 du mois suivant
    if (finDuMois > now) break;
    mois++;
    m++; if (m > 11) { m = 0; y++; }
  }
  return mois;
}

/**
 * Congés acquis sur la période.
 * @returns {{mois:number, jours:number, plafonne:boolean, entreeInconnue:boolean, debutAcquisition:string}}
 */
function congesAcquis({ dateEntree, periode, aujourdhui }) {
  // Sans date d'entrée (3 salariés sur 4 au 02/09), on suppose le salarié
  // présent depuis le début de la période — et on le DIT à l'appelant.
  const entree = versDate(dateEntree);
  const debutPeriode = versDate(periode.debut);
  const entreeInconnue = !entree;
  const depart = (entree && entree > debutPeriode) ? versIso(entree) : periode.debut;
  // On ne compte pas au-delà de la fin de période.
  const borne = versDate(aujourdhui) > versDate(periode.fin) ? periode.fin : aujourdhui;
  const mois = moisComplets(depart, borne);
  const brut = mois * ACQUISITION_PAR_MOIS;
  return {
    mois,
    jours: Math.min(PLAFOND_ANNUEL, brut),
    plafonne: brut > PLAFOND_ANNUEL,
    entreeInconnue,
    debutAcquisition: depart,
  };
}

// ────────────────────────────── Consommation ──────────────────────────────

/**
 * Jours DISTINCTS posés sur la période, pour les types demandés.
 *
 * Le dédoublonnage n'est pas une précaution théorique : la base porte, au
 * 02/09/2026, deux paires d'absences qui se recouvrent (saisies en double).
 * En sommant les durées, un salarié affichait 50 jours de congés pris.
 *
 * @returns {{jours:number, dates:string[], jusquAujourdhui:number, aVenir:number,
 *            detail:Array, chevauchements:Array}}
 */
function joursPosesDistincts({ absences = [], types, periode, aujourdhui }) {
  const retenues = (absences || []).filter(a =>
    a && a.statut === 'Validée' && types.includes(a.type));

  const dates = new Set();
  const detail = [];
  for (const a of retenues) {
    // Intersection avec la période : une absence à cheval ne compte que pour sa part.
    const debut = a.dateDebut > periode.debut ? a.dateDebut : periode.debut;
    const finAbs = a.dateFin || a.dateDebut;
    const fin = finAbs < periode.fin ? finAbs : periode.fin;
    const jours = joursOuvrablesEntre(debut, fin);
    for (const j of jours) dates.add(j);
    detail.push({ id: a.id, libelle: a.libelle || '', type: a.type,
      dateDebut: a.dateDebut, dateFin: finAbs, joursOuvrables: jours.length });
  }

  // Paires qui se recouvrent : on les remonte pour que Virginie puisse trancher.
  const chevauchements = [];
  for (let i = 0; i < retenues.length; i++) {
    for (let j = i + 1; j < retenues.length; j++) {
      const a = retenues[i], b = retenues[j];
      const fa = a.dateFin || a.dateDebut, fb = b.dateFin || b.dateDebut;
      if (a.dateDebut <= fb && b.dateDebut <= fa) {
        chevauchements.push({
          a: { id: a.id, libelle: a.libelle || '', debut: a.dateDebut, fin: fa },
          b: { id: b.id, libelle: b.libelle || '', debut: b.dateDebut, fin: fb },
          duDebut: a.dateDebut > b.dateDebut ? a.dateDebut : b.dateDebut,
          auFin: fa < fb ? fa : fb,
        });
      }
    }
  }

  const triees = [...dates].sort();
  return {
    jours: triees.length,
    dates: triees,
    // Un congé posé pour octobre n'est pas encore pris : deux chiffres valent
    // mieux qu'un seul qui mélange le passé et le futur.
    jusquAujourdhui: triees.filter(d => d <= aujourdhui).length,
    aVenir: triees.filter(d => d > aujourdhui).length,
    detail,
    chevauchements,
  };
}

// ──────────────────────────── Compteur complet ────────────────────────────

/**
 * Compteur de congés d'un salarié pour la période contenant `aujourdhui`.
 *
 * @param {object} opts
 * @param {{id, nom, dateEntree}} opts.salarie
 * @param {Array<{id, salarieId, type, dateDebut, dateFin, statut, libelle}>} opts.absences
 * @param {string} opts.aujourdhui 'YYYY-MM-DD'
 */
function compteurConges({ salarie, absences = [], aujourdhui }) {
  const periode = periodeDeReference(aujourdhui);
  // Période précédente : c'est ELLE qui ouvre les droits qu'on prend aujourd'hui.
  // En France on ne consomme pas les congés qu'on est en train d'acquérir : ceux
  // pris à l'été 2026 viennent de l'année 06/2025-05/2026. Compter « acquis
  // cette période moins pris cette période » mettait les 4 salariés de Tanguy en
  // négatif au 02/09 — un compteur faux, comme celui qu'on remplace.
  const precedente = periodeDeReference(`${Number(periode.debut.slice(0, 4)) - 1}-06-01`);
  const siennes = (absences || []).filter(a => a && a.salarieId === salarie.id);

  // Droits ouverts : ce que le salarié a acquis sur la période précédente, donc
  // ce qu'il peut prendre maintenant. Interrogée à sa clôture, une période
  // complète vaut 30 jours.
  const ouverts = congesAcquis({ dateEntree: salarie.dateEntree, periode: precedente, aujourdhui: precedente.fin });
  // En cours d'acquisition : sera disponible à partir du 1ᵉʳ juin prochain.
  const enCours = congesAcquis({ dateEntree: salarie.dateEntree, periode, aujourdhui });

  const cp = joursPosesDistincts({ absences: siennes, types: TYPES_CP, periode, aujourdhui });
  const rtt = joursPosesDistincts({ absences: siennes, types: TYPES_RTT, periode, aujourdhui });
  const solde = Math.round((ouverts.jours - cp.jours) * 10) / 10;

  const limites = [];
  if (ouverts.entreeInconnue) {
    limites.push("Date d'entrée inconnue : droits calculés comme une année pleine sur la période précédente. La renseigner sur la fiche du salarié corrige le compteur.");
  }
  if (cp.chevauchements.length) {
    limites.push(`${cp.chevauchements.length} absence(s) se recouvrent : les jours communs ne sont comptés qu'une fois. À vérifier, c'est souvent une saisie en double.`);
  }
  if (solde < 0) {
    limites.push(`Solde négatif : ${cp.jours} jours posés pour ${ouverts.jours} jours de droits ouverts.`);
  }
  if (rtt.jours) {
    limites.push(`${rtt.jours} jour(s) de RTT posés, mais les droits RTT ne sont pas paramétrés : aucun solde RTT n'est calculé.`);
  }

  return {
    salarieId: salarie.id,
    nom: salarie.nom,
    periode,
    periodePrecedente: precedente,
    // Ce qu'on peut prendre aujourd'hui, et ce qui reste après les congés posés.
    droitsOuverts: ouverts.jours,
    poses: cp.jours,
    pris: cp.jusquAujourdhui,
    aVenir: cp.aVenir,
    solde,
    // Négatif = plus de jours posés que de droits ouverts. Ce n'est pas
    // impossible (anticipation accordée) mais ça doit se voir.
    depassement: solde < 0,
    // Ce qui se constitue pour l'année prochaine.
    enAcquisition: enCours.jours,
    moisAcquis: enCours.mois,
    entreeInconnue: ouverts.entreeInconnue,
    rttPoses: rtt.jours,
    droitsRTT: null,          // volontairement non calculé — règle inconnue
    chevauchements: cp.chevauchements,
    detail: cp.detail,
    limites,
  };
}

/** Compteurs de toute l'équipe, dans l'ordre reçu. */
function compteursEquipe({ salaries = [], absences = [], aujourdhui }) {
  return salaries.map(s => compteurConges({ salarie: s, absences, aujourdhui }));
}

module.exports = {
  ACQUISITION_PAR_MOIS, PLAFOND_ANNUEL,
  paques, joursFeries, estOuvrable, joursOuvrablesEntre,
  periodeDeReference, moisComplets, congesAcquis,
  joursPosesDistincts, compteurConges, compteursEquipe,
};
