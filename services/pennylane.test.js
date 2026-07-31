'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildInvoiceLines, normalizeName, vatEnum } = require('./pennylane');

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
  assert.strictEqual(warnings.length, 0);
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
  assert.match(lines[1].label, /10 %/);
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
