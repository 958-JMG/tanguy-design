/**
 * services/tresorerie-helper.js — Plan de trésorerie hebdomadaire (Sprint v5 Virginie)
 *
 * Logique pure, testable sans Airtable (ADR-004) :
 *  - encaissements prévus = factures clients non soldées (par date d'échéance)
 *    + échéances devis non encaissées SANS facture liée (évite le double comptage)
 *  - décaissements prévus = factures fournisseurs non payées (par date d'échéance)
 *  - regroupement par semaine (lundi), solde hebdo + solde cumulé.
 *
 * Les routes /api/tresorerie/* normalisent les records Airtable en items
 * { date: 'YYYY-MM-DD'|null, montant: Number, label: String } avant d'appeler ici.
 */

/** Ajoute N jours à une date YYYY-MM-DD. Retourne null si input invalide. */
function addDays(dateStr, n) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant dateStr (YYYY-MM-DD). Null si invalide. */
function mondayOf(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0=dim, 1=lun…
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(dateStr, delta);
}

/**
 * IDs des échéances devis déjà couvertes par une facture client.
 * @param {Array<{echeanceIds: string[]}>} facturesClients
 * @returns {Set<string>}
 */
function echeancesFacturees(facturesClients) {
  const set = new Set();
  for (const f of facturesClients || []) {
    for (const id of f.echeanceIds || []) set.add(id);
  }
  return set;
}

/**
 * Construit le plan de trésorerie hebdomadaire.
 * @param {object} opts
 * @param {Array<{date: string|null, montant: number, label: string}>} opts.entrees
 * @param {Array<{date: string|null, montant: number, label: string}>} opts.sorties
 * @param {string} opts.today YYYY-MM-DD
 * @param {number} [opts.nbSemaines=12]
 * @returns {{semaines: Array, enRetard: object, sansDate: object, plusTard: object, totaux: object}}
 */
function buildPlanTresorerie({ entrees = [], sorties = [], today, nbSemaines = 12 }) {
  const lundiCourant = mondayOf(today);
  if (!lundiCourant) throw new Error('buildPlanTresorerie: today invalide');

  const semaines = [];
  for (let i = 0; i < nbSemaines; i++) {
    const lundi = addDays(lundiCourant, i * 7);
    semaines.push({ semaine: lundi, entrees: [], sorties: [], encaissements: 0, decaissements: 0, solde: 0, soldeCumule: 0 });
  }
  const horizonFin = addDays(lundiCourant, nbSemaines * 7); // exclu
  const enRetard = { entrees: [], sorties: [], encaissements: 0, decaissements: 0 };
  const sansDate = { entrees: [], sorties: [], encaissements: 0, decaissements: 0 };
  const plusTard = { entrees: [], sorties: [], encaissements: 0, decaissements: 0 };

  const dispatch = (item, sens) => {
    const montant = Number(item.montant) || 0;
    if (montant <= 0) return;
    const listKey = sens === 'in' ? 'entrees' : 'sorties';
    const totalKey = sens === 'in' ? 'encaissements' : 'decaissements';
    let bucket;
    if (!item.date) bucket = sansDate;
    else if (item.date < lundiCourant && item.date < today) bucket = enRetard;
    else if (item.date >= horizonFin) bucket = plusTard;
    else {
      const lundi = mondayOf(item.date);
      bucket = semaines.find(s => s.semaine === lundi) || enRetard;
    }
    bucket[listKey].push(item);
    bucket[totalKey] += montant;
  };

  for (const e of entrees) dispatch(e, 'in');
  for (const s of sorties) dispatch(s, 'out');

  let cumul = 0;
  for (const s of semaines) {
    s.solde = s.encaissements - s.decaissements;
    cumul += s.solde;
    s.soldeCumule = cumul;
  }

  const totaux = {
    encaissements: semaines.reduce((a, s) => a + s.encaissements, 0) + enRetard.encaissements,
    decaissements: semaines.reduce((a, s) => a + s.decaissements, 0) + enRetard.decaissements,
  };
  totaux.solde = totaux.encaissements - totaux.decaissements;

  return { semaines, enRetard, sansDate, plusTard, totaux };
}

/**
 * Sérialise des lignes en CSV compatible Excel FR (séparateur ;, BOM UTF-8).
 * @param {Array<object>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @returns {string}
 */
function toCsv(rows, columns) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    // Montants : virgule décimale FR
    const out = typeof v === 'number' ? s.replace('.', ',') : s;
    return /[;"\n\r]/.test(out) ? '"' + out.replace(/"/g, '""') + '"' : out;
  };
  const header = columns.map(c => escape(c.label)).join(';');
  const lines = (rows || []).map(r => columns.map(c => escape(r[c.key])).join(';'));
  return '﻿' + [header, ...lines].join('\r\n');
}

module.exports = { addDays, mondayOf, echeancesFacturees, buildPlanTresorerie, toCsv };
