'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildInvoiceLines, buildEcheanceInvoiceLines, normalizeName, vatEnum } = require('./pennylane');

test('vatEnum — pourcentages courants + fractions + défaut', () => {
  assert.strictEqual(vatEnum(20), 'FR_200');
  assert.strictEqual(vatEnum(10), 'FR_100');
  assert.strictEqual(vatEnum(5.5), 'FR_055');
  assert.strictEqual(vatEnum(0), 'exempt');
  assert.strictEqual(vatEnum(0.2), 'FR_200');   // fraction
  assert.strictEqual(vatEnum(0.1), 'FR_100');
  assert.strictEqual(vatEnum(null), 'FR_200');  // défaut prudent
  assert.strictEqual(vatEnum('10'), 'FR_100');  // string
});

test('normalizeName — accents / casse / ponctuation', () => {
  assert.strictEqual(normalizeName('  Éléonore  DÜPUY '), 'eleonore dupuy');
  assert.strictEqual(normalizeName('SARL Cuisines & Co.'), 'sarl cuisines co');
  assert.strictEqual(normalizeName(null), '');
});

test('buildInvoiceLines — 2 taux de TVA (données réelles 410/1/2) → réconcilie', () => {
  const f = {
    'TVA taux 1 base': 26634.97, 'TVA taux 1 pourcentage': 20,
    'TVA taux 2 base': 3026.48, 'TVA taux 2 pourcentage': 10,
    'Total HT final': 29661.45, 'Total TTC': 35291.08,
  };
  const { lines, reconciliation, warnings } = buildInvoiceLines(f);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].raw_currency_unit_price, '26634.97');
  assert.strictEqual(lines[0].vat_rate, 'FR_200');
  assert.strictEqual(lines[1].vat_rate, 'FR_100');
  assert.strictEqual(reconciliation.ok, true);   // diff ≈ 0.01 € (arrondi)
  // Appel sans descriptif → un seul avertissement, celui qui le signale.
  assert.deepStrictEqual(warnings, ['Aucun descriptif de devis : les lignes partent sans description']);
});

test('buildInvoiceLines — 1 seul taux (données réelles 459/1/14) → 1 ligne', () => {
  const f = { 'TVA taux 1 base': 48017.16, 'TVA taux 1 pourcentage': 20, 'Total HT final': 48017.16, 'Total TTC': 57620.59 };
  const { lines, reconciliation } = buildInvoiceLines(f);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(reconciliation.ok, true);
});

test('buildInvoiceLines — gros du montant à 10 % (données réelles 563/1/12)', () => {
  const f = {
    'TVA taux 1 base': 6368.62, 'TVA taux 1 pourcentage': 20,
    'TVA taux 2 base': 26220.83, 'TVA taux 2 pourcentage': 10,
    'Total TTC': 36485.25,
  };
  const { lines, reconciliation } = buildInvoiceLines(f);
  assert.strictEqual(lines.length, 2);
  // Le taux n'est plus écrit dans le libellé (il est porté par vat_rate, que
  // Pennylane affiche) : on vérifie la donnée, pas sa mise en mots.
  assert.strictEqual(lines[1].vat_rate, 'FR_100');
  assert.strictEqual(lines[1].raw_currency_unit_price, '26220.83');
  assert.strictEqual(reconciliation.ok, true);
});

test('buildInvoiceLines — repli sur Total HT final si bases TVA absentes', () => {
  const f = { 'Total HT final': 10000, 'TVA taux 1 pourcentage': 20, 'Total TTC': 12000 };
  const { lines, reconciliation, warnings } = buildInvoiceLines(f);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].raw_currency_unit_price, '10000.00');
  assert.strictEqual(reconciliation.ok, true);
  assert.ok(warnings.some(w => /repli/i.test(w)));
});

test('buildInvoiceLines — TTC incohérent → warning, ok=false', () => {
  const f = { 'TVA taux 1 base': 18000, 'TVA taux 1 pourcentage': 20, 'Total TTC': 20000 };
  const { reconciliation, warnings } = buildInvoiceLines(f);
  assert.strictEqual(reconciliation.ok, false);
  assert.ok(warnings.some(w => /≠ Total TTC/.test(w)));
});

test('buildInvoiceLines — devis vide → aucune ligne + warning', () => {
  const { lines, warnings } = buildInvoiceLines({});
  assert.strictEqual(lines.length, 0);
  assert.ok(warnings.some(w => /rien à pousser/.test(w)));
});

// ── Factures d'échéance (acompte / livraison / solde) ──────────────────────
const DEVIS_2TAUX = {
  'TVA taux 1 base': 26634.97, 'TVA taux 1 pourcentage': 20,
  'TVA taux 2 base': 3026.48, 'TVA taux 2 pourcentage': 10,
  'Total TTC': 35291.08,
};

test('buildEcheanceInvoiceLines — acompte 30 % : prorata 2 taux + réconcilie', () => {
  const montant = 10587.32; // ≈ 30 % du TTC
  const { lines, reconciliation, warnings } = buildEcheanceInvoiceLines(DEVIS_2TAUX, montant, 'À la commande');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0].label, /^À la commande — /);
  assert.strictEqual(lines[0].vat_rate, 'FR_200');
  assert.strictEqual(lines[1].vat_rate, 'FR_100');
  assert.strictEqual(reconciliation.ok, true);
  assert.ok(Math.abs(reconciliation.diff) <= 1);
  assert.deepStrictEqual(warnings, ['Aucun descriptif de devis : les lignes partent sans description']);
});

test('buildEcheanceInvoiceLines — somme des 3 échéances = Total TTC du devis', () => {
  const ttc = DEVIS_2TAUX['Total TTC'];
  const echs = [ttc * 0.30, ttc * 0.65, ttc - ttc * 0.30 - ttc * 0.65]; // commande/livraison/solde
  let sum = 0;
  for (const m of echs) sum += buildEcheanceInvoiceLines(DEVIS_2TAUX, Math.round(m * 100) / 100, 'x').reconciliation.computedTtc;
  assert.ok(Math.abs(Math.round(sum * 100) / 100 - ttc) <= 0.1);
});

test('buildEcheanceInvoiceLines — devis 1 taux → 1 ligne', () => {
  const d = { 'TVA taux 1 base': 48017.16, 'TVA taux 1 pourcentage': 20, 'Total TTC': 57620.59 };
  const { lines, reconciliation } = buildEcheanceInvoiceLines(d, 17286.18, 'À la commande');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(reconciliation.ok, true);
});

test('buildEcheanceInvoiceLines — montant 0 → aucune ligne + warning', () => {
  const { lines, warnings } = buildEcheanceInvoiceLines(DEVIS_2TAUX, 0, 'À la commande');
  assert.strictEqual(lines.length, 0);
  assert.ok(warnings.some(w => /sans montant/.test(w)));
});

test('buildEcheanceInvoiceLines — repli si bases TVA absentes (HT depuis TTC)', () => {
  const d = { 'Total TTC': 12000, 'TVA taux 1 pourcentage': 20 };
  const { lines, reconciliation, warnings } = buildEcheanceInvoiceLines(d, 3600, 'Acompte');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].raw_currency_unit_price, '3000.00'); // 3600 / 1.2
  assert.strictEqual(reconciliation.ok, true);
  assert.ok(warnings.some(w => /repli|absentes/i.test(w)));
});

// ── Libellé produit constant + description du devis (demande JMG 27/08/2026) ──

test('buildInvoiceLines — le libellé produit est constant, pas un intitulé de TVA', () => {
  const f = {
    'TVA taux 1 base': 10000, 'TVA taux 1 pourcentage': 20,
    'TVA taux 2 base': 2000, 'TVA taux 2 pourcentage': 10,
    'Total TTC': 14200,
  };
  const { lines } = buildInvoiceLines(f, { description: 'Novamobili — Night' });
  assert.strictEqual(lines[0].label, 'Produit cuisine');
  assert.strictEqual(lines[1].label, 'Produit cuisine — pose et prestations');
  // L'ancien libellé ne doit plus apparaître nulle part.
  for (const l of lines) assert.doesNotMatch(l.label, /Fourniture cuisine sur-mesure/);
});

test('buildInvoiceLines — la description du devis est reprise sur chaque ligne', () => {
  const f = { 'TVA taux 1 base': 10000, 'TVA taux 1 pourcentage': 20, 'Total TTC': 12000 };
  const desc = 'Novamobili — Night\nColoris façade : Foglia mat';
  const { lines, warnings } = buildInvoiceLines(f, { description: desc });
  assert.strictEqual(lines[0].description, desc);
  assert.strictEqual(warnings.length, 0, 'aucun avertissement quand la description est fournie');
});

test('buildInvoiceLines — sans description : aucun champ vide envoyé, mais un avertissement', () => {
  const f = { 'TVA taux 1 base': 10000, 'TVA taux 1 pourcentage': 20, 'Total TTC': 12000 };
  const { lines, warnings } = buildInvoiceLines(f);
  assert.strictEqual('description' in lines[0], false, 'pas de description vide envoyée à Pennylane');
  assert.match(warnings.join(' '), /sans description/);
});

test('buildInvoiceLines — une description très longue est tronquée, pas rejetée', () => {
  const f = { 'TVA taux 1 base': 100, 'TVA taux 1 pourcentage': 20, 'Total TTC': 120 };
  const { lines } = buildInvoiceLines(f, { description: 'x'.repeat(5000) });
  assert.ok(lines[0].description.length <= 1000);
});

test('buildEcheanceInvoiceLines — le préfixe d\'échéance reste dans le libellé', () => {
  const { lines } = buildEcheanceInvoiceLines(DEVIS_2TAUX, 10000, 'Acompte 30 %', { description: 'Novamobili — Night' });
  // Même si la description ne s'affichait pas, une facture d'acompte doit se
  // reconnaître à son libellé.
  assert.match(lines[0].label, /^Acompte 30 % — Produit cuisine/);
  assert.strictEqual(lines[0].description, 'Novamobili — Night');
});

test('PENNYLANE_LIBELLE_PRODUIT surcharge le libellé sans redéploiement', () => {
  const avant = process.env.PENNYLANE_LIBELLE_PRODUIT;
  process.env.PENNYLANE_LIBELLE_PRODUIT = 'Cuisine équipée';
  try {
    const f = { 'TVA taux 1 base': 100, 'TVA taux 1 pourcentage': 20, 'Total TTC': 120 };
    assert.strictEqual(buildInvoiceLines(f).lines[0].label, 'Cuisine équipée');
  } finally {
    if (avant === undefined) delete process.env.PENNYLANE_LIBELLE_PRODUIT;
    else process.env.PENNYLANE_LIBELLE_PRODUIT = avant;
  }
});
