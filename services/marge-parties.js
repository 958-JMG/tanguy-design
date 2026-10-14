'use strict';
// ────────────────────────────────────────────────────────────────────────────
// services/marge-parties.js — Marge de CHAQUE PARTIE d'un projet
//
// Demande JMG du 14/10/2026 : « connaître la marge complète de chaque partie
// (meuble / électroménager etc.) ». La fiche projet ne donnait qu'une marge
// globale. Ici, par partie (Mobilier, Électroménager, Plan de travail &
// crédence, Luminaire, Accessoires, Divers & à classer, Pose & livraison) :
//
//   - CA HT : le « Total HT final » des devis SIGNÉS (même base que la marge
//     globale de la fiche), réparti au prorata des lignes — remise du devis
//     appliquée, éco comprise. La pose et la livraison du devis forment leur
//     propre partie. Un devis sans lignes reste « non ventilé » : on le DIT.
//   - Coût prévu : « Prix achat HT » des lignes (+ leur éco, reversée au
//     fournisseur), connu pour les Devis express. Une partie dont certaines
//     lignes n'ont pas de prix d'achat est marquée « partiel ».
//   - Coût réel : « Montant AR » des commandes (le réel confirmé, comme la marge
//     globale), réparti sur les parties par les lignes du BC ; à défaut, par la
//     référence courte du BC (MOBILIER, ELECTRO…).
//
// L'éco-participation est comptée des DEUX côtés (vendue au client, payée au
// fournisseur) : elle s'annule dans la marge, comme dans Pennylane où elle sort
// du chiffre d'affaires.
//
// Module PUR (aucun réseau) : la route normalise les records puis appelle ici.
// ────────────────────────────────────────────────────────────────────────────

const { classifierCategorie } = require('./fournisseur-grille');
const { cleLigne } = require('./commande-bc');
const { matchNumero, estAutoGenerePar } = require('./devis-generes-helper');

const PARTIES = ['Mobilier', 'Électroménager', 'Plan de travail & crédence', 'Luminaire', 'Accessoires', 'Divers & à classer', 'Pose & livraison'];
const NON_VENTILE = 'Non ventilé';
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Partie d'une ligne de devis, d'après sa catégorie (même classement que la signature). */
function partieDeLigne(f) {
  const cl = classifierCategorie(f && f['Catégorie']);
  if (cl.canon === 'Dépose') return 'Pose & livraison';
  if (cl.canon && PARTIES.includes(cl.canon)) return cl.canon;
  return 'Divers & à classer';
}

// Référence courte d'un BC → partie (BC sans lignes reconnaissables).
const PARTIE_PAR_REF = {
  MOBILIER: 'Mobilier', NOVA_CUC: 'Mobilier', MEUBLES: 'Mobilier',
  ELECTRO: 'Électroménager',
  PLAN_CRED: 'Plan de travail & crédence', PLAN_TRAV: 'Plan de travail & crédence',
  LUMIN: 'Luminaire', ACCESS: 'Accessoires', A_CLASSER: 'Divers & à classer',
};

/**
 * @param {object} p
 * @param {Array} p.devis     - devis du projet (records {id, fields})
 * @param {Array} p.lignes    - lignes des devis SIGNÉS (records {id, fields}, fields.Devis = [devisId])
 * @param {Array} p.commandes - BC du projet (records)
 * @returns {{ parties: Array, total: object, alertes: string[] }}
 */
function margeParParties({ devis = [], lignes = [], commandes = [] }) {
  const alertes = [];
  const acc = {};
  const part = nom => (acc[nom] ||= { partie: nom, ca: 0, coutPrevu: 0, prevuConnu: 0, prevuInconnu: 0, coutReel: 0 });
  const signes = devis.filter(d => d.fields?.Statut === 'Signé');
  const lignesParDevis = new Map(signes.map(d => [d.id, []]));
  for (const l of lignes) {
    const did = (l.fields?.Devis || [])[0];
    if (lignesParDevis.has(did)) lignesParDevis.get(did).push(l);
  }

  // 1. CA par partie, au prorata des lignes, sur le Total HT final de chaque devis signé.
  for (const d of signes) {
    const f = d.fields || {};
    const cible = num(f['Total HT final']) || num(f['Total HT après remise']) || num(f['Total HT articles']);
    if (!(cible > 0)) {
      // Jamais de silence : un devis signé sans total ne compte pas dans le CA, on le dit.
      alertes.push(`Devis ${f['Numéro devis'] || d.id} signé sans total HT : hors de la marge par partie.`);
      continue;
    }
    const articles = num(f['Total HT articles']);
    const apresRemise = num(f['Total HT après remise']);
    const ratio = articles > 0 && apresRemise > 0 ? apresRemise / articles : 1;
    const poids = new Map();
    for (const l of lignesParDevis.get(d.id) || []) {
      const lf = l.fields || {};
      const w = num(lf['Montant HT']) * ratio + num(lf['Eco-participation']);
      if (w > 0) poids.set(partieDeLigne(lf), (poids.get(partieDeLigne(lf)) || 0) + w);
    }
    const poseLiv = num(f['Pose HT']) + num(f['Livraison HT']);
    if (poseLiv > 0) poids.set('Pose & livraison', (poids.get('Pose & livraison') || 0) + poseLiv);
    const somme = [...poids.values()].reduce((a, b) => a + b, 0);
    if (!(somme > 0)) {
      part(NON_VENTILE).ca += cible;
      alertes.push(`Devis ${f['Numéro devis'] || d.id} sans lignes chiffrées : ${round2(cible)} € HT non ventilés par partie.`);
      continue;
    }
    for (const [nom, w] of poids) part(nom).ca += cible * w / somme;
  }

  // 2. Coût prévu : prix d'achat des lignes (+ leur éco, reversée au fournisseur).
  for (const ls of lignesParDevis.values()) {
    for (const l of ls) {
      const lf = l.fields || {};
      if (!(num(lf['Montant HT']) > 0 || num(lf['Eco-participation']) > 0)) continue;
      const p = part(partieDeLigne(lf));
      if (num(lf['Prix achat HT']) > 0) { p.coutPrevu += num(lf['Prix achat HT']) + num(lf['Eco-participation']); p.prevuConnu += 1; }
      else p.prevuInconnu += 1;
    }
  }

  // 3. Coût réel : AR des BC, répartis par leurs lignes (sinon par la référence courte).
  for (const c of commandes) {
    const cf = c.fields || {};
    const ar = num(cf['Montant AR']);
    if (!(ar > 0)) continue;
    const d = signes.find(x => estAutoGenerePar(cf.Notes, x.fields?.['Numéro devis']) || matchNumero(cf['Numéro'], x.fields?.['Numéro devis']));
    const repartition = new Map();
    if (d) {
      const parCle = new Map((lignesParDevis.get(d.id) || []).map(l => [cleLigne(l.fields?.Position, l.fields?.['Code produit']), l]));
      let entrees = [];
      try { entrees = JSON.parse(cf['Lignes BC'] || '[]'); } catch { entrees = []; }
      for (const e of Array.isArray(entrees) ? entrees : []) {
        const l = parCle.get(cleLigne(e && e.pos, e && e.code));
        if (!l) continue;
        const lf = l.fields || {};
        const w = num(lf['Prix achat HT']) || num(lf['Montant HT']) || 1;
        repartition.set(partieDeLigne(lf), (repartition.get(partieDeLigne(lf)) || 0) + w);
      }
    }
    if (!repartition.size) {
      const ref = String(cf['Référence courte'] || '').toUpperCase().trim();
      repartition.set(PARTIE_PAR_REF[ref] || 'Divers & à classer', 1);
    }
    const somme = [...repartition.values()].reduce((a, b) => a + b, 0);
    for (const [nom, w] of repartition) part(nom).coutReel += ar * w / somme;
  }

  // 4. Marge : réelle dès qu'un AR existe pour la partie, sinon prévue (si connue).
  const ordre = [...PARTIES, NON_VENTILE];
  const parties = Object.values(acc)
    .map(p => {
      const ca = round2(p.ca), coutPrevu = round2(p.coutPrevu), coutReel = round2(p.coutReel);
      let marge = null, base = null;
      if (coutReel > 0) { marge = round2(ca - coutReel); base = 'réelle'; }
      else if (p.prevuConnu > 0) { marge = round2(ca - coutPrevu); base = 'prévue'; }
      return {
        partie: p.partie, ca, coutPrevu, coutReel, marge, base,
        prevuPartiel: p.prevuConnu > 0 && p.prevuInconnu > 0,
        margePct: marge != null && ca > 0 ? round2((marge / ca) * 100) : null,
      };
    })
    .filter(p => p.ca > 0 || p.coutReel > 0 || p.coutPrevu > 0)
    .sort((a, b) => ordre.indexOf(a.partie) - ordre.indexOf(b.partie));

  const total = {
    ca: round2(parties.reduce((t, p) => t + p.ca, 0)),
    coutPrevu: round2(parties.reduce((t, p) => t + p.coutPrevu, 0)),
    coutReel: round2(parties.reduce((t, p) => t + p.coutReel, 0)),
  };
  return { parties, total, alertes };
}

module.exports = { margeParParties, partieDeLigne, PARTIES };
