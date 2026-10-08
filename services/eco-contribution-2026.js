/**
 * services/eco-contribution-2026.js — Éco-participation mobilier, barème Ecomaison 2026.
 *
 * Source : fichier « Tanguy_Design_Eco_participation_2026_sans_poids.xlsx » (Virginie,
 * guide des tarifs HT applicables au 1er janvier 2026, MAJ 30 mars 2026, Ecomaison).
 * https://ecomaison.com/ressources/guide-des-tarifs-des-elements-dameublement-applicables-au-1er-janvier-2026/
 *
 * ⚠️ Modèle DIFFÉRENT de l'ancien services/eco-contribution-bareme.js (grille
 *    longueur×hauteur en TTC, obsolète pour 2026). Ici le barème officiel Ecomaison
 *    est À LA TRANCHE DE POIDS, en € HT. « Sans poids » = sans le poids FOURNISSEUR :
 *    on ESTIME le poids à partir des dimensions, de l'épaisseur, de la densité et d'un
 *    coefficient de quincaillerie (par type de meuble). Dès qu'un fournisseur donne un
 *    poids ou un code/tarif Ecomaison réel, il PRIME sur l'estimation (poidsKgManuel /
 *    tarifHtManuel) — on ne devine jamais contre une donnée officielle.
 *
 * La formule d'estimation du poids a été reconstituée depuis les formules du tableur
 * et vérifiée au centième sur les 3 exemples de Virginie (cf. test).
 */

// Paramètres par type de meuble (feuille « Paramètres »). Épaisseur et densité sont
// modifiables (overrides), le reste est fixe par type.
//   epaisseurMm · densite (kg/m³) · etageres (nb) · coeff (quincaillerie) · forme
const PARAMS = {
  'Meuble bas':         { epaisseurMm: 18, densite: 650, etageres: 1, coeff: 1.08, forme: 'caisson' },
  'Meuble haut':        { epaisseurMm: 18, densite: 650, etageres: 1, coeff: 1.08, forme: 'caisson' },
  'Colonne':            { epaisseurMm: 18, densite: 650, etageres: 4, coeff: 1.10, forme: 'caisson' },
  'Meuble sous-évier':  { epaisseurMm: 18, densite: 650, etageres: 0, coeff: 1.08, forme: 'caisson' },
  "Meuble d'angle":     { epaisseurMm: 18, densite: 650, etageres: 1, coeff: 1.10, forme: 'caisson' },
  'Joue / panneau':     { epaisseurMm: 18, densite: 650, etageres: 0, coeff: 1.00, forme: 'panneau' },
  'Façade / porte':     { epaisseurMm: 18, densite: 650, etageres: 0, coeff: 1.04, forme: 'panneau' },
  'Plan de travail':    { epaisseurMm: 38, densite: 650, etageres: 0, coeff: 1.00, forme: 'plan' },
};
const TYPES = Object.keys(PARAMS);

// Classes de matière = colonnes du barème. Le libellé doit correspondre EXACTEMENT.
const MATIERES = [
  'Bois massif >95% - sans gestion durable',
  'Bois massif >95% - gestion durable certifiée',
  'Panneaux particules ≥75% - sans gestion durable',
  'Panneaux particules ≥75% - gestion durable certifiée',
  'Bois/dérivés ≥50% - sans gestion durable',
  'Bois/dérivés ≥50% - gestion durable certifiée',
  'Biosourcés ≥50% - sans gestion durable',
  'Biosourcés ≥50% - gestion durable certifiée',
  'Majorité bois + perturbateur recyclage',
];
const MATIERE_DEFAUT = 'Panneaux particules ≥75% - sans gestion durable';

// Barème 2026, € HT. Chaque ligne : poids min (kg), libellé de tranche, puis les 9
// tarifs dans l'ordre de MATIERES. Recherche par tranche = plus grand min ≤ poids.
const BAREME = [
  { min: 0,    label: '< 0,100 kg',            t: [0.03, 0.01, 0.04, 0.02, 0.05, 0.02, 0.05, 0.02, 0.05] },
  { min: 0.1,  label: '≥ 0,100 et < 0,25 kg',  t: [0.04, 0.03, 0.05, 0.03, 0.06, 0.04, 0.06, 0.04, 0.06] },
  { min: 0.25, label: '≥ 0,25 et < 0,5 kg',    t: [0.07, 0.05, 0.09, 0.05, 0.09, 0.07, 0.09, 0.07, 0.09] },
  { min: 0.5,  label: '≥ 0,5 et < 1 kg',       t: [0.13, 0.09, 0.14, 0.10, 0.19, 0.14, 0.18, 0.13, 0.19] },
  { min: 1,    label: '≥ 1 et < 2 kg',         t: [0.27, 0.16, 0.33, 0.18, 0.42, 0.27, 0.38, 0.27, 0.42] },
  { min: 2,    label: '≥ 2 et < 5 kg',         t: [0.43, 0.27, 0.72, 0.31, 0.75, 0.47, 0.62, 0.44, 0.75] },
  { min: 5,    label: '≥ 5 et < 10 kg',        t: [0.90, 0.55, 1.11, 0.59, 1.46, 0.92, 1.33, 0.95, 1.46] },
  { min: 10,   label: '≥ 10 et < 20 kg',       t: [1.90, 1.20, 2.38, 1.25, 3.03, 1.90, 2.66, 1.90, 3.03] },
  { min: 20,   label: '≥ 20 et < 30 kg',       t: [3.16, 1.76, 3.71, 1.83, 5.04, 3.16, 4.45, 3.18, 5.04] },
  { min: 30,   label: '≥ 30 et < 40 kg',       t: [4.33, 2.52, 5.25, 2.62, 6.96, 4.33, 6.20, 4.45, 6.96] },
  { min: 40,   label: '≥ 40 et < 60 kg',       t: [5.78, 3.37, 7.25, 3.50, 9.53, 5.78, 8.11, 6.35, 9.53] },
  { min: 60,   label: '≥ 60 et < 100 kg',      t: [9.03, 5.61, 11.83, 5.83, 15.03, 9.03, 14.16, 10.16, 15.03] },
  { min: 100,  label: '≥ 100 et < 150 kg',     t: [16.25, 10.10, 19.88, 10.50, 25.63, 16.25, 22.84, 16.25, 25.63] },
  { min: 150,  label: '≥ 150 et < 200 kg',     t: [22.75, 14.14, 27.83, 14.70, 35.88, 22.75, 31.97, 22.75, 35.88] },
  { min: 200,  label: '≥ 200 et < 250 kg',     t: [29.26, 18.19, 35.78, 18.90, 46.14, 29.26, 41.10, 29.26, 46.14] },
  { min: 250,  label: '≥ 250 et < 300 kg',     t: [35.76, 22.23, 43.73, 23.10, 56.39, 35.76, 50.24, 35.76, 56.39] },
  { min: 300,  label: '> 300 kg',              t: [52.01, 32.33, 63.60, 33.60, 82.01, 52.01, 73.07, 52.01, 82.01] },
];

const TVA_DEFAUT = 20;
const arrondi = n => Math.round((n + Number.EPSILON) * 100) / 100;
const arrondi3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * Poids estimé (kg) d'une pièce, selon sa forme. Dimensions en mm.
 * Reproduit la formule du tableur :
 *   - caisson : surface = 2·H·P + 2·L·P + L·H + étagères·(L·P) ; poids = surface·e·densité·coeff
 *   - panneau (joue, façade) : poids = L·H·e·densité·coeff
 *   - plan de travail : poids = L·P·e·densité  (sans coeff)
 * Retourne null si une dimension indispensable manque (jamais deviné).
 */
function estimerPoidsKg({ type, largeurMm, hauteurMm, profondeurMm, epaisseurMm, densite } = {}) {
  const p = PARAMS[type];
  if (!p) return null;
  const e = (Number.isFinite(Number(epaisseurMm)) && Number(epaisseurMm) > 0 ? Number(epaisseurMm) : p.epaisseurMm) / 1000;
  const d = Number.isFinite(Number(densite)) && Number(densite) > 0 ? Number(densite) : p.densite;
  const L = Number(largeurMm) / 1000, H = Number(hauteurMm) / 1000, P = Number(profondeurMm) / 1000;

  if (p.forme === 'panneau') {
    if (!(L > 0) || !(H > 0)) return null;             // largeur + hauteur requises
    return arrondi3(L * H * e * d * p.coeff);
  }
  if (p.forme === 'plan') {
    if (!(L > 0) || !(P > 0)) return null;             // largeur + profondeur requises
    return arrondi3(L * P * e * d);                    // pas de coeff (quincaillerie = 1)
  }
  // caisson
  if (!(L > 0) || !(H > 0) || !(P > 0)) return null;   // les 3 dimensions requises
  const surface = (2 * H * P) + (2 * L * P) + (L * H) + (p.etageres * L * P);
  return arrondi3(surface * e * d * p.coeff);
}

/** Ligne du barème pour un poids (plus grand min ≤ poids). Null si poids < 0 / invalide. */
function trancheParPoids(poidsKg) {
  const w = Number(poidsKg);
  if (!Number.isFinite(w) || w < 0) return null;
  let found = null;
  for (const row of BAREME) { if (w >= row.min) found = row; else break; }
  return found;
}

/**
 * Éco-part HT d'une pièce.
 * @param piece { type, largeurMm, hauteurMm, profondeurMm, classeMatiere,
 *                epaisseurMm?, densite?, quantite?, poidsKgManuel?, tarifHtManuel? }
 * @returns { ecoHtUnitaire, totalHt, poidsKg, tranche, classeMatiere, source,
 *            quantite, manquants[], avertissements[] }
 *          ecoHtUnitaire null dès qu'une donnée indispensable manque : on dit ce
 *          qui manque, on ne comble jamais en silence.
 */
function ecoPiece(piece = {}) {
  const manquants = [];
  const avertissements = [];
  const qteBrut = Number(piece.quantite);
  const quantite = Number.isFinite(qteBrut) && qteBrut > 0 ? qteBrut : 1;
  const classe = piece.classeMatiere || MATIERE_DEFAUT;
  const colonne = MATIERES.indexOf(classe);

  const base = {
    type: piece.type || null, quantite, classeMatiere: classe,
    poidsKg: null, tranche: null, ecoHtUnitaire: null, totalHt: null,
    source: null, manquants, avertissements,
  };

  if (colonne === -1) { avertissements.push(`Classe matière « ${classe} » absente du barème`); return base; }

  // Tarif fourni par le fournisseur : prime sur toute estimation.
  if (piece.tarifHtManuel != null && Number.isFinite(Number(piece.tarifHtManuel))) {
    const u = Number(piece.tarifHtManuel);
    return { ...base, ecoHtUnitaire: arrondi(u), totalHt: arrondi(u * quantite), source: 'tarif-fournisseur' };
  }

  // Poids : fournisseur s'il est connu, sinon estimation dimensionnelle.
  let poidsKg, source;
  if (piece.poidsKgManuel != null && Number.isFinite(Number(piece.poidsKgManuel))) {
    poidsKg = Number(piece.poidsKgManuel); source = 'poids-fournisseur';
  } else {
    if (!PARAMS[piece.type]) { manquants.push('type'); }
    poidsKg = estimerPoidsKg(piece); source = 'estimation-dimensions';
    if (poidsKg == null && PARAMS[piece.type]) {
      // Type connu mais dimensions insuffisantes : dire lesquelles.
      const forme = PARAMS[piece.type].forme;
      if (!(Number(piece.largeurMm) > 0)) manquants.push('largeur');
      if (forme !== 'plan' && !(Number(piece.hauteurMm) > 0)) manquants.push('hauteur');
      if (forme !== 'panneau' && !(Number(piece.profondeurMm) > 0)) manquants.push('profondeur');
    }
  }
  if (poidsKg == null) return base;

  const row = trancheParPoids(poidsKg);
  if (!row) { avertissements.push(`Poids ${poidsKg} kg hors barème`); return { ...base, poidsKg, source }; }
  const u = row.t[colonne];
  return {
    ...base, poidsKg, tranche: row.label, source,
    ecoHtUnitaire: u, totalHt: arrondi(u * quantite),
  };
}

/**
 * Éco-participation d'un ensemble de pièces.
 * @returns { lignes, totalHt, totalTtc, tauxTvaPct, piecesCalculees,
 *            piecesIncalculables, complet, avertissements }
 *          totalTtc = le « dont XX € » client, à reporter dans la case du devis.
 */
function calculer(pieces, { tauxTvaPct = TVA_DEFAUT } = {}) {
  const taux = Number.isFinite(Number(tauxTvaPct)) ? Number(tauxTvaPct) : TVA_DEFAUT;
  const lignes = (pieces || []).map((p, i) => ({ index: i, designation: p.designation || '', ...ecoPiece(p) }));
  const calculees = lignes.filter(l => l.totalHt != null);
  const incalculables = lignes.filter(l => l.totalHt == null);
  const totalHt = arrondi(calculees.reduce((s, l) => s + l.totalHt, 0));
  return {
    lignes,
    totalHt,
    totalTtc: arrondi(totalHt * (1 + taux / 100)),
    tauxTvaPct: taux,
    piecesCalculees: calculees.length,
    piecesIncalculables: incalculables.length,
    complet: incalculables.length === 0 && lignes.length > 0,
    avertissements: lignes.flatMap(l => l.avertissements),
  };
}

module.exports = {
  PARAMS, TYPES, MATIERES, MATIERE_DEFAUT, BAREME, TVA_DEFAUT,
  estimerPoidsKg, trancheParPoids, ecoPiece, calculer,
};
