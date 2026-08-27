'use strict';
// ────────────────────────────────────────────────────────────────────────────
// Pennylane — création de DEVIS BROUILLON depuis un devis Tanguy.
//
// Principe : le cockpit CRÉE un brouillon dans Pennylane (jamais finalisé,
// jamais envoyé au client automatiquement). Virginie termine ensuite dans
// Pennylane (envoi) OU télécharge le PDF pour l'envoyer depuis sa boîte mail.
//   → Règle dure 9·58 : AUCUN email ne part automatiquement à un client.
//
// Écriture Pennylane limitée à : créer un client, créer un devis brouillon.
//   → JAMAIS de delete / archive / finalize / send depuis ce module.
//
// Le mapping (devis → lignes Pennylane) est PUR et testable sans réseau.
// Adapté du client Pennylane de cockpit-pilotage (throttle + retry 429).
// ────────────────────────────────────────────────────────────────────────────

const BASE = 'https://app.pennylane.com/api/external/v2';

const { payloadIndividuPennylane } = require('./nom-client-helper');

function apiKey() {
  const k = process.env.PENNYLANE_API_KEY;
  if (!k) throw new Error('PENNYLANE_API_KEY absente (secret non configuré)');
  return k;
}
function headers(extra = {}) {
  return { Authorization: 'Bearer ' + apiKey(), Accept: 'application/json', ...extra };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastReq = 0;
async function throttle() { const w = Math.max(0, 280 - (Date.now() - lastReq)); if (w) await sleep(w); lastReq = Date.now(); }

async function apiGet(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    const r = await fetch(BASE + path, { headers: headers() });
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`Pennylane GET ${path.split('?')[0]} → HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`Pennylane GET ${path.split('?')[0]} → 429 (limite de débit)`);
}

async function apiPost(path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    const r = await fetch(BASE + path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || (Array.isArray(j.errors) && j.errors.join('; ')) || `Pennylane POST ${path} → HTTP ${r.status}`);
    return j;
  }
  throw new Error(`Pennylane POST ${path} → 429 (limite de débit)`);
}

// ── Helpers purs (montants / TVA) ──────────────────────────────────────────
const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Normalise un nom pour le matching client (accents, casse, espaces, ponctuation).
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Convertit un pourcentage de TVA en enum Pennylane. null/absent → défaut 20 %
// (FR_200) ; un 0 EXPLICITE → exempt.
function vatEnum(pct) {
  if (pct == null || pct === '') return 'FR_200';
  const p = num(pct);
  const table = { 20: 'FR_200', 10: 'FR_100', 5.5: 'FR_055', 2.1: 'FR_021', 0: 'exempt' };
  if (table[p]) return table[p];
  // tolère 0.2 / 0.1 (fraction) ou valeurs approchées
  if (p > 0 && p < 1) return vatEnum(round2(p * 100));
  if (Math.abs(p - 20) < 0.01) return 'FR_200';
  if (Math.abs(p - 10) < 0.01) return 'FR_100';
  if (Math.abs(p - 5.5) < 0.01) return 'FR_055';
  return 'FR_200';
}
const enumPct = { FR_200: 20, FR_100: 10, FR_055: 5.5, FR_021: 2.1, exempt: 0 };

// ── Mapping PUR : devis Tanguy (fields Airtable) → lignes Pennylane ─────────
// Construit le devis client PAR TAUX DE TVA, à partir des bases OFFICIELLES du
// devis (« TVA taux 1/2 base + pourcentage »). Décision fondée sur les données
// réelles (2026-07-31) : les champs « par nature » (Total HT après remise, Pose
// HT, Livraison HT…) sont des artefacts de parsing INCOHÉRENTS (ex. « après
// remise » > articles ; pose tantôt 20 % tantôt 10 %). Les bases TVA, elles,
// réconcilient exactement : base1+base2 = Total HT final ; +montants = Total TTC.
// L'éco-participation est DÉJÀ incluse dans les bases (pas de ligne séparée).
// Le brouillon reste éditable par Virginie dans Pennylane si elle veut détailler.
//
// f = devis.fields (cf. table Devis). Retourne { lines, reconciliation, warnings }.
// Libellé produit des lignes de facture. Demande JMG (27/08/2026) : « le produit
// doit être à peu près toujours le même, c'est produit cuisine ». Ce qui varie
// d'un devis à l'autre passe dans la DESCRIPTION, pas dans le libellé.
// Surchargeable sans redéploiement via PENNYLANE_LIBELLE_PRODUIT.
const LIBELLE_PRODUIT = () => process.env.PENNYLANE_LIBELLE_PRODUIT || 'Produit cuisine';

/**
 * @param {object} f            - fields du devis
 * @param {object} [opts]
 * @param {string} [opts.description] - descriptif du devis (cf. description-devis-helper),
 *        repris tel quel sur chaque ligne. Absent → aucune description envoyée
 *        ET un avertissement remonté : on ne laisse pas une facture partir
 *        muette sans le dire.
 */
function buildInvoiceLines(f = {}, opts = {}) {
  const warnings = [];
  const lines = [];
  const description = String(opts.description || '').trim();
  const push = (label, ht, vatPct) => {
    const amount = round2(num(ht));
    if (amount === 0) return;
    lines.push({
      label: String(label).slice(0, 200),
      quantity: 1,
      unit: 'piece',
      raw_currency_unit_price: amount.toFixed(2),
      vat_rate: vatEnum(vatPct),
      ...(description ? { description: description.slice(0, 1000) } : {}),
    });
  };
  // Le libellé ne porte plus la nature ni le taux : la TVA est déjà portée par
  // vat_rate et s'affiche dans Pennylane. Seule la pose (taux réduit) garde une
  // mention, sans quoi deux lignes seraient strictement indiscernables.
  const labelFor = pct => pct >= 20 ? LIBELLE_PRODUIT()
    : `${LIBELLE_PRODUIT()} — pose et prestations`;

  // 1) Une ligne par taux de TVA renseigné (source fiable et réconciliable).
  for (const r of [
    { base: 'TVA taux 1 base', pct: 'TVA taux 1 pourcentage' },
    { base: 'TVA taux 2 base', pct: 'TVA taux 2 pourcentage' },
  ]) {
    if (f[r.base] == null || num(f[r.base]) === 0) continue;
    const pct = f[r.pct] != null ? num(f[r.pct]) : 20;
    push(labelFor(pct), f[r.base], pct);
  }

  // 2) Repli : aucune base TVA → Total HT final (ou après remise / articles) @ TVA taux 1 (ou 20 %).
  if (lines.length === 0) {
    const htf = f['Total HT final'] ?? f['Total HT après remise'] ?? f['Total HT articles'];
    if (htf != null && num(htf) !== 0) {
      warnings.push('Bases TVA absentes : repli sur le Total HT final @ TVA taux 1');
      push(labelFor(f['TVA taux 1 pourcentage'] != null ? num(f['TVA taux 1 pourcentage']) : 20),
        htf, f['TVA taux 1 pourcentage'] != null ? num(f['TVA taux 1 pourcentage']) : 20);
    }
  }

  // 3) Réconciliation TTC calculé vs Total TTC du devis (garde-fou anti silent-fail).
  const computedTtc = round2(lines.reduce((s, l) => s + num(l.raw_currency_unit_price) * (1 + enumPct[l.vat_rate] / 100), 0));
  const expectedTtc = f['Total TTC'] != null ? round2(num(f['Total TTC'])) : null;
  const diff = expectedTtc != null ? round2(computedTtc - expectedTtc) : null;
  const ok = expectedTtc == null ? null : Math.abs(diff) <= 1; // tolérance 1 € (arrondis TVA)
  if (expectedTtc != null && !ok) {
    warnings.push(`TTC recalculé ${computedTtc} € ≠ Total TTC devis ${expectedTtc} € (écart ${diff} €)`);
  }
  if (expectedTtc == null) warnings.push('Total TTC absent du devis : réconciliation impossible');
  if (lines.length === 0) warnings.push('Aucun montant exploitable sur le devis (rien à pousser)');
  if (!description && lines.length) warnings.push('Aucun descriptif de devis : les lignes partent sans description');

  return { lines, reconciliation: { computedTtc, expectedTtc, diff, ok }, warnings };
}

// Libellé de nature selon le taux (partagé) — préfixé du libellé d'échéance.
function natureLabel(pct) {
  return pct >= 20 ? LIBELLE_PRODUIT() : `${LIBELLE_PRODUIT()} — pose et prestations`;
}

// ── Mapping PUR : une ÉCHÉANCE (acompte/livraison/solde) → lignes de facture ──
// Le montant d'échéance est TTC. On le répartit AU PRORATA des bases TVA du devis
// (même taux, même proportion) → la facture d'échéance porte la bonne TVA, et la
// SOMME des échéances = le devis au centime (chaque fraction × TotalTTC).
// devisFields = fields du devis · echMontantTtc = 'Montant prévu' · echLibelle = 'Libellé'.
function buildEcheanceInvoiceLines(devisFields = {}, echMontantTtc, echLibelle = 'Échéance', opts = {}) {
  const warnings = [];
  const lines = [];
  const montant = round2(num(echMontantTtc));
  const totalTtc = num(devisFields['Total TTC']);
  const prefix = String(echLibelle || 'Échéance').trim();
  const description = String(opts.description || '').trim();
  // Le préfixe d'échéance RESTE dans le libellé : une facture d'acompte doit se
  // reconnaître au premier coup d'œil, même si la description ne s'affiche pas.
  const push = (label, ht, pct) => {
    const amount = round2(num(ht));
    if (amount === 0) return;
    lines.push({ label: `${prefix} — ${label}`.slice(0, 200), quantity: 1, unit: 'piece',
      raw_currency_unit_price: amount.toFixed(2), vat_rate: vatEnum(pct),
      ...(description ? { description: description.slice(0, 1000) } : {}) });
  };

  if (montant === 0) { warnings.push('Échéance sans montant'); return { lines, reconciliation: { computedTtc: 0, expectedTtc: 0, diff: 0, ok: true }, warnings }; }

  const bases = [
    { base: num(devisFields['TVA taux 1 base']), pct: devisFields['TVA taux 1 pourcentage'] != null ? num(devisFields['TVA taux 1 pourcentage']) : 20 },
    { base: num(devisFields['TVA taux 2 base']), pct: devisFields['TVA taux 2 pourcentage'] != null ? num(devisFields['TVA taux 2 pourcentage']) : 10 },
  ].filter(b => b.base > 0);

  if (bases.length && totalTtc > 0) {
    const fraction = montant / totalTtc;                 // part de l'échéance dans le devis
    for (const b of bases) push(natureLabel(b.pct), round2(fraction * b.base), b.pct);
  } else {
    // Repli : pas de bases TVA exploitables → 1 ligne, HT = TTC / (1 + tva1) @ tva1 (défaut 20 %).
    const pct = devisFields['TVA taux 1 pourcentage'] != null ? num(devisFields['TVA taux 1 pourcentage']) : 20;
    warnings.push('Bases TVA du devis absentes : échéance en 1 ligne @ TVA taux 1');
    push(natureLabel(pct), round2(montant / (1 + pct / 100)), pct);
  }

  // Réconciliation : la facture d'échéance doit totaliser le montant TTC de l'échéance.
  const computedTtc = round2(lines.reduce((s, l) => s + num(l.raw_currency_unit_price) * (1 + enumPct[l.vat_rate] / 100), 0));
  const diff = round2(computedTtc - montant);
  const ok = Math.abs(diff) <= 1;
  if (!ok) warnings.push(`Facture recalculée ${computedTtc} € ≠ montant échéance ${montant} € (écart ${diff} €)`);
  if (!description && lines.length) warnings.push('Aucun descriptif de devis : les lignes partent sans description');
  return { lines, reconciliation: { computedTtc, expectedTtc: montant, diff, ok }, warnings };
}

// ── Réseau : clients ────────────────────────────────────────────────────────
async function listAllCustomers() {
  const out = []; let cursor = null, guard = 0;
  while (true) {
    const j = await apiGet('/customers' + (cursor ? `?cursor=${cursor}` : ''));
    out.push(...(Array.isArray(j.items) ? j.items : []));
    cursor = j.next_cursor || null;
    if (!(j.has_more === true && cursor) || ++guard > 200) break;
  }
  return out;
}

// Cherche un client Pennylane existant par nom normalisé. Retourne
// { exact, candidates[] } — jamais de création ici (décision côté appelant).
async function findCustomerByName(name) {
  const target = normalizeName(name);
  if (!target) return { exact: null, candidates: [] };
  const all = await listAllCustomers();
  const scored = all.map(c => {
    const cn = normalizeName(c.name || c.company_name || c.reference);
    return { id: String(c.id), name: c.name || c.company_name || c.reference || ('Client ' + c.id), norm: cn };
  });
  const exact = scored.find(c => c.norm === target) || null;
  const candidates = scored.filter(c => c.norm !== target && (c.norm.includes(target) || target.includes(c.norm))).slice(0, 5);
  return { exact, candidates };
}

// Crée un client PARTICULIER (défaut agence cuisine) ou SOCIÉTÉ selon `isCompany`.
async function createCustomer({ name, isCompany = false, first_name, last_name, contact = '', address, postal_code, city, country_alpha2 = 'FR', email }) {
  const billing = (address || postal_code || city) ? { billing_address: { address: address || '', postal_code: postal_code || '', city: city || '', country_alpha2 } } : {};
  let j, id;
  if (isCompany) {
    j = await apiPost('/company_customers', { name, ...billing, ...(email ? { emails: [email] } : {}) });
  } else {
    // Découpage « prénom / nom » — cf. services/nom-client-helper.js.
    // L'ancien code prenait le PREMIER mot comme prénom : « DUPUY » (patronyme
    // seul, forme majoritaire dans la base) atterrissait dans le champ prénom,
    // avec « - » en nom. Signalé par Virginie le 27/08/2026.
    let fn = first_name, ln = last_name;
    if (!fn && !ln) {
      const p = payloadIndividuPennylane(name, contact);
      fn = p.first_name; ln = p.last_name;
    }
    j = await apiPost('/individual_customers', { first_name: fn || '', last_name: ln || String(name || '').trim() || 'Client', ...billing, ...(email ? { emails: [email] } : {}) });
  }
  id = j && (j.id || (j.customer && j.customer.id) || (j.individual_customer && j.individual_customer.id) || (j.company_customer && j.company_customer.id));
  return { id: String(id || ''), raw: j };
}

// ── Réseau : devis brouillon ────────────────────────────────────────────────
// Crée un DEVIS BROUILLON. `lines` = sortie de buildInvoiceLines().lines.
// `external_reference` (optionnel) = n° de devis Tanguy, reporté sur le devis Pennylane.
async function createDraftQuote({ customer_id, date, deadline, lines, external_reference }) {
  if (!customer_id) throw new Error('customer_id requis');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('aucune ligne à pousser');
  // NB : Pennylane /quotes n'accepte pas de `label` au niveau devis (les libellés
  // vivent sur invoice_lines). On reporte la réf. du devis Tanguy via external_reference.
  const body = { customer_id, date, deadline, invoice_lines: lines };
  if (external_reference) body.external_reference = String(external_reference).slice(0, 190);
  const j = await apiPost('/quotes', body);
  const q = j.quote || j;
  // Un brouillon non finalisé a quote_number = 0 (numéroté par Pennylane à l'envoi) → on ne le remonte pas.
  const rawNum = q.quote_number ?? q.number;
  return {
    id: String(q.id || ''),
    number: (rawNum && String(rawNum) !== '0') ? String(rawNum) : null,
    status: q.status || 'draft',
    public_file_url: q.public_file_url || null,
    raw: j,
  };
}

// Crée une FACTURE BROUILLON (draft:true) — sert aux factures d'échéance (acompte,
// livraison, solde). Jamais finalisée ni envoyée : Virginie relit et envoie dans Pennylane.
// `lines` = sortie de buildEcheanceInvoiceLines().lines.
async function createDraftInvoice({ customer_id, date, deadline, lines, external_reference }) {
  if (!customer_id) throw new Error('customer_id requis');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('aucune ligne à facturer');
  const body = { customer_id, date, deadline, draft: true, invoice_lines: lines };
  if (external_reference) body.external_reference = String(external_reference).slice(0, 190);
  const j = await apiPost('/customer_invoices', body);
  const inv = j.invoice || j.customer_invoice || j;
  const rawNum = inv.invoice_number ?? inv.number;
  return {
    id: String(inv.id || ''),
    number: (rawNum && String(rawNum) !== '0') ? String(rawNum) : null,
    status: inv.status || 'draft',
    public_file_url: inv.public_file_url || null,
    raw: j,
  };
}

// Récupère le PDF d'un devis (retour Buffer) — pour le bouton « télécharger ».
// Pennylane v2 : pas d'endpoint /pdf ; l'objet devis porte un `public_file_url`
// (lien PDF public signé, sans auth). On le lit et on télécharge le fichier.
async function fetchQuotePdf(quoteId) {
  const j = await apiGet(`/quotes/${quoteId}`);
  const q = j.quote || j;
  const url = q && q.public_file_url;
  if (!url) throw new Error('PDF Pennylane indisponible (public_file_url absent)');
  const rr = await fetch(url);
  if (!rr.ok) throw new Error(`PDF Pennylane indisponible (HTTP ${rr.status})`);
  return Buffer.from(await rr.arrayBuffer());
}

// PDF d'une facture (retour Buffer) — même principe que fetchQuotePdf (public_file_url).
async function fetchInvoicePdf(invoiceId) {
  const j = await apiGet(`/customer_invoices/${invoiceId}`);
  const inv = j.invoice || j.customer_invoice || j;
  const url = inv && inv.public_file_url;
  if (!url) throw new Error('PDF facture Pennylane indisponible (public_file_url absent)');
  const rr = await fetch(url);
  if (!rr.ok) throw new Error(`PDF facture Pennylane indisponible (HTTP ${rr.status})`);
  return Buffer.from(await rr.arrayBuffer());
}

module.exports = {
  // purs (testables sans réseau)
  buildInvoiceLines, buildEcheanceInvoiceLines, normalizeName, vatEnum,
  // réseau
  findCustomerByName, createCustomer, createDraftQuote, createDraftInvoice,
  fetchQuotePdf, fetchInvoicePdf, listAllCustomers,
  BASE,
};
