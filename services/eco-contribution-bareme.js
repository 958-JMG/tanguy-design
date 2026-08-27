/**
 * services/eco-contribution-bareme.js — Barème éco-contribution
 * « Tablettes et panneaux revêtus (avec décor) », matériau majoritaire bois et
 * biosourcés, tablettes et panneaux prédécoupés.
 *
 * Demande JMG 2026-08 (Devis express) : calculer l'éco-contribution
 * automatiquement à la lecture du devis fournisseur, avec correction manuelle
 * possible ensuite.
 *
 * ⚠️ CE BARÈME EST À LA DIMENSION, PAS AU POIDS. Les seuls axes sont :
 *      1. la LONGUEUR (tranche)          2. la HAUTEUR (< ou ≥ 250 mm)
 *      3. le MATÉRIAU majoritaire        4. la GESTION DURABLE certifiée ou non
 *    Le poids n'intervient nulle part — il n'est pas nécessaire au calcul.
 *
 * ⚠️ LES TARIFS DE LA GRILLE SONT EN € TTC (mention « TARIFS TTC » de la source).
 *    Le Devis express raisonne en HT : toute addition à un montant HT doit passer
 *    par ttcVersHt(). Additionner directement ces valeurs à du HT est un bug
 *    silencieux — d'où le nommage explicite en `TTC` partout dans ce fichier.
 *
 * Source : grille tarifaire fournie par JMG le 27/08/2026 (tarifs à la dimension
 * par unité, en € TTC). À revalider à chaque millésime du barème.
 */

// Matériaux majoritaires (colonnes de la grille).
const MATERIAUX = {
  BOIS_MASSIF: 'Bois massif ≥ 75%',
  PANNEAUX_PARTICULES: 'Panneaux de particules ≥ 75%',
  BIOSOURCES: 'Bois et dérivés certifiés, matériaux biosourcés ≥ 50%',
};

// Tranches de longueur, en mm. La grille énonce « 0 à 600 », « 610 à 1200 »,
// « > 1200 » : elle ne dit RIEN de l'intervalle 601-609 mm. Choix retenu —
// prudent — tout ce qui dépasse 600 bascule dans la tranche supérieure.
// (cf. `TRANCHE_INDETERMINEE` : signalé à l'appelant plutôt que passé sous silence.)
const TRANCHES = [
  { max: 600, label: '0 à 600 mm' },
  { max: 1200, label: '610 à 1200 mm' },
  { max: Infinity, label: '> 1200 mm' },
];

const SEUIL_HAUTEUR_MM = 250;

/**
 * Grille, en € TTC par unité.
 * Lecture : [materiau][tranche][hauteur][gestionDurable]
 *   hauteur         : 'h<250' | 'h>=250'
 *   gestionDurable  : 'sans'  | 'certifiee'
 */
const GRILLE_TTC = {
  [MATERIAUX.BOIS_MASSIF]: {
    '0 à 600 mm':     { 'h<250': { sans: 0.19, certifiee: 0.06 }, 'h>=250': { sans: 0.41, certifiee: 0.11 } },
    '610 à 1200 mm':  { 'h<250': { sans: 0.35, certifiee: 0.11 }, 'h>=250': { sans: 0.70, certifiee: 0.29 } },
    '> 1200 mm':      { 'h<250': { sans: 0.40, certifiee: 0.29 }, 'h>=250': { sans: 0.96, certifiee: 0.29 } },
  },
  [MATERIAUX.PANNEAUX_PARTICULES]: {
    '0 à 600 mm':     { 'h<250': { sans: 0.19, certifiee: 0.06 }, 'h>=250': { sans: 0.41, certifiee: 0.11 } },
    '610 à 1200 mm':  { 'h<250': { sans: 0.35, certifiee: 0.11 }, 'h>=250': { sans: 0.70, certifiee: 0.29 } },
    '> 1200 mm':      { 'h<250': { sans: 0.64, certifiee: 0.29 }, 'h>=250': { sans: 0.96, certifiee: 0.40 } },
  },
  [MATERIAUX.BIOSOURCES]: {
    '0 à 600 mm':     { 'h<250': { sans: 0.22, certifiee: 0.08 }, 'h>=250': { sans: 0.47, certifiee: 0.17 } },
    '610 à 1200 mm':  { 'h<250': { sans: 0.41, certifiee: 0.17 }, 'h>=250': { sans: 0.82, certifiee: 0.41 } },
    '> 1200 mm':      { 'h<250': { sans: 0.76, certifiee: 0.41 }, 'h>=250': { sans: 1.08, certifiee: 0.48 } },
  },
};

// Défauts du cas courant Tanguy Design (JMG, 27/08/2026) : panneaux de
// particules en gestion durable certifiée.
const DEFAUTS = {
  materiau: MATERIAUX.PANNEAUX_PARTICULES,
  gestionDurableCertifiee: true,
};

/** Tranche de longueur d'une pièce. Retourne null si la longueur est inconnue. */
function trancheLongueur(longueurMm) {
  const l = Number(longueurMm);
  if (!Number.isFinite(l) || l <= 0) return null;
  return TRANCHES.find(t => l <= t.max).label;
}

/** La longueur tombe-t-elle dans le trou 601-609 mm laissé par la grille ? */
function trancheIndeterminee(longueurMm) {
  const l = Number(longueurMm);
  return Number.isFinite(l) && l > 600 && l < 610;
}

/** Clé de hauteur. Null si la hauteur est inconnue (h ≥ 250 double presque le tarif). */
function cleHauteur(hauteurMm) {
  const h = Number(hauteurMm);
  if (!Number.isFinite(h) || h <= 0) return null;
  return h < SEUIL_HAUTEUR_MM ? 'h<250' : 'h>=250';
}

/**
 * Tarif unitaire TTC d'une pièce.
 * @returns {{ tarifTtc:number|null, tranche:string|null, hauteur:string|null,
 *             materiau:string, gestionDurable:string, manquants:string[],
 *             avertissements:string[] }}
 *          `tarifTtc` est null dès qu'une donnée indispensable manque : on ne
 *          devine JAMAIS une dimension absente, on dit ce qui manque.
 */
function tarifUnitaireTtc({ longueurMm, hauteurMm, materiau, gestionDurableCertifiee } = {}) {
  const mat = materiau || DEFAUTS.materiau;
  const certifiee = gestionDurableCertifiee === undefined
    ? DEFAUTS.gestionDurableCertifiee
    : !!gestionDurableCertifiee;
  const cleGd = certifiee ? 'certifiee' : 'sans';

  const manquants = [];
  const avertissements = [];

  const tranche = trancheLongueur(longueurMm);
  if (!tranche) manquants.push('longueur');
  const hauteur = cleHauteur(hauteurMm);
  if (!hauteur) manquants.push('hauteur');

  const grilleMat = GRILLE_TTC[mat];
  if (!grilleMat) {
    return {
      tarifTtc: null, tranche, hauteur, materiau: mat, gestionDurable: cleGd,
      manquants, avertissements: [...avertissements, `Matériau « ${mat} » absent du barème`],
    };
  }
  if (trancheIndeterminee(longueurMm)) {
    avertissements.push(`Longueur ${longueurMm} mm : la grille ne couvre pas 601-609 mm — tranche « ${tranche} » retenue (tarif supérieur, choix prudent)`);
  }
  if (manquants.length) {
    return { tarifTtc: null, tranche, hauteur, materiau: mat, gestionDurable: cleGd, manquants, avertissements };
  }

  return {
    tarifTtc: grilleMat[tranche][hauteur][cleGd],
    tranche, hauteur, materiau: mat, gestionDurable: cleGd,
    manquants, avertissements,
  };
}

/** Conversion TTC → HT. Le taux est TOUJOURS explicite : aucun défaut caché. */
function ttcVersHt(montantTtc, tauxTvaPct) {
  // Number(null) === 0 : sans ce rejet explicite, un taux absent serait traité
  // comme 0 % et le TTC ressortirait tel quel en HT, sans une alerte.
  if (tauxTvaPct === null || tauxTvaPct === undefined || tauxTvaPct === '') return null;
  const ttc = Number(montantTtc);
  const taux = Number(tauxTvaPct);
  if (!Number.isFinite(ttc) || !Number.isFinite(taux) || taux < 0) return null;
  return Math.round((ttc / (1 + taux / 100)) * 100) / 100;
}

const arrondi = n => Math.round(n * 100) / 100;

/**
 * Éco-contribution d'un ensemble de pièces.
 * @param {Array} pieces - { designation, quantite, longueurMm, hauteurMm,
 *                           materiau, gestionDurableCertifiee, tarifTtcManuel }
 *        `tarifTtcManuel` prend le pas sur la grille : c'est la correction à la
 *        main demandée par JMG (dimension réelle connue après coup, cas non
 *        prévu par le barème…). Elle est tracée dans `source: 'manuel'`.
 * @param {number|null} tauxTvaPct - pour le total HT. null → totalHt null,
 *        jamais un taux supposé en douce.
 */
function calculerEcoContribution(pieces, { tauxTvaPct = null } = {}) {
  const lignes = (pieces || []).map((p, i) => {
    const qte = Number(p.quantite);
    const quantite = Number.isFinite(qte) && qte > 0 ? qte : 1;
    if (p.tarifTtcManuel != null && Number.isFinite(Number(p.tarifTtcManuel))) {
      const t = Number(p.tarifTtcManuel);
      return {
        index: i, designation: p.designation || '', quantite,
        tarifUnitaireTtc: t, totalTtc: arrondi(t * quantite),
        source: 'manuel', manquants: [], avertissements: [],
        tranche: trancheLongueur(p.longueurMm), hauteur: cleHauteur(p.hauteurMm),
        materiau: p.materiau || DEFAUTS.materiau,
        gestionDurable: (p.gestionDurableCertifiee === undefined ? DEFAUTS.gestionDurableCertifiee : !!p.gestionDurableCertifiee) ? 'certifiee' : 'sans',
      };
    }
    const r = tarifUnitaireTtc(p);
    return {
      index: i, designation: p.designation || '', quantite,
      tarifUnitaireTtc: r.tarifTtc,
      totalTtc: r.tarifTtc == null ? null : arrondi(r.tarifTtc * quantite),
      source: r.tarifTtc == null ? 'incalculable' : 'grille',
      manquants: r.manquants, avertissements: r.avertissements,
      tranche: r.tranche, hauteur: r.hauteur,
      materiau: r.materiau, gestionDurable: r.gestionDurable,
    };
  });

  const calculees = lignes.filter(l => l.totalTtc != null);
  const incalculables = lignes.filter(l => l.totalTtc == null);
  const totalTtc = arrondi(calculees.reduce((s, l) => s + l.totalTtc, 0));

  return {
    lignes,
    totalTtc,
    totalHt: tauxTvaPct == null ? null : ttcVersHt(totalTtc, tauxTvaPct),
    tauxTvaPct,
    piecesCalculees: calculees.length,
    // Jamais de silence : un total partiel doit se présenter comme partiel.
    piecesIncalculables: incalculables.length,
    complet: incalculables.length === 0 && lignes.length > 0,
    avertissements: lignes.flatMap(l => l.avertissements),
  };
}

module.exports = {
  MATERIAUX, TRANCHES, SEUIL_HAUTEUR_MM, GRILLE_TTC, DEFAUTS,
  trancheLongueur, trancheIndeterminee, cleHauteur,
  tarifUnitaireTtc, ttcVersHt, calculerEcoContribution,
};
