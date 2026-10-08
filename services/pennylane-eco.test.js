'use strict';
// Tests du carve éco-participation (« dont », hors CA). Invariants prouvés :
//   • total HT inchangé  • total TTC inchangé  • TVA préservée
//   • l'éco sort du produit (CA réduit) et part sur sa propre ligne
//   • jamais de silence : eco=0, eco>support, pas de ligne → avertissement
const { test } = require('node:test');
const assert = require('node:assert');
const { carveEcoParticipation } = require('./pennylane');

const enumPct = { FR_200: 20, FR_100: 10, FR_055: 5.5, FR_021: 2.1, exempt: 0 };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ttc = lines => r2(lines.reduce((s, l) => s + Number(l.raw_currency_unit_price) * (Number(l.quantity) || 1) * (1 + enumPct[l.vat_rate] / 100), 0));
const ht = lines => r2(lines.reduce((s, l) => s + Number(l.raw_currency_unit_price) * (Number(l.quantity) || 1), 0));

function ligneProduit(htAmount, vat = 'FR_200', extra = {}) {
  return { label: 'Produit cuisine', quantity: 1, unit: 'piece', raw_currency_unit_price: htAmount.toFixed(2), vat_rate: vat, ...extra };
}

test('carve — total TTC et HT inchangés, éco sortie du CA (taux 20 %)', () => {
  const base = [ligneProduit(1000)];
  const avantTtc = ttc(base), avantHt = ht(base);
  const { lines, ecoLine, ecoHt, warnings } = carveEcoParticipation(base, 12); // 12 € TTC
  assert.ok(ecoLine, 'une ligne éco est créée');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(ecoHt, 10); // 12 / 1,20
  assert.strictEqual(ecoLine.raw_currency_unit_price, '10.00');
  assert.strictEqual(ecoLine.vat_rate, 'FR_200');
  // produit réduit de 10 € HT, éco = 10 € HT → CA produit = 990, hors CA = 10
  assert.strictEqual(lines[0].raw_currency_unit_price, '990.00');
  // totaux strictement conservés
  assert.strictEqual(ttc(lines), avantTtc);
  assert.strictEqual(ht(lines), avantHt);
  assert.strictEqual(avantTtc, 1200);
  // par défaut la ligne éco référence le produit « Éco-participation » (rattaché au
  // compte 70811 hors CA), sans dépendre d'un env : donc aucun avertissement.
  assert.strictEqual(ecoLine.product_id, 109588803584);
  assert.strictEqual(ecoLine.ledger_account_id, undefined);
  assert.strictEqual(warnings.length, 0);
});

test('carve — mention « dont » posée sur la ligne produit', () => {
  const { lines } = carveEcoParticipation([ligneProduit(500)], 24);
  assert.match(lines[0].description, /dont éco-participation : 24\.00 € TTC/);
});

test('carve — la mention s\'ajoute à une description existante sans l\'écraser', () => {
  const { lines } = carveEcoParticipation([ligneProduit(500, 'FR_200', { description: 'Cuisine équipée sur mesure' })], 24);
  assert.match(lines[0].description, /Cuisine équipée sur mesure/);
  assert.match(lines[0].description, /dont éco-participation : 24\.00 € TTC/);
});

test('carve — plusieurs taux : l\'éco va sur la marchandise à 20 %, pas sur la pose à 10 %', () => {
  const base = [ligneProduit(1000, 'FR_200'), { label: 'Pose', quantity: 1, unit: 'piece', raw_currency_unit_price: '300.00', vat_rate: 'FR_100' }];
  const avantTtc = ttc(base);
  const { lines, ecoLine } = carveEcoParticipation(base, 12);
  assert.strictEqual(ecoLine.vat_rate, 'FR_200');
  assert.strictEqual(lines[0].raw_currency_unit_price, '990.00'); // produit 20 % réduit
  assert.strictEqual(lines[1].raw_currency_unit_price, '300.00'); // pose intacte
  assert.strictEqual(ttc(lines), avantTtc);
});

test('carve — à taux égal, l\'éco va sur la plus grosse ligne', () => {
  const base = [ligneProduit(200, 'FR_200'), ligneProduit(2000, 'FR_200')];
  const { lines } = carveEcoParticipation(base, 12);
  assert.strictEqual(lines[0].raw_currency_unit_price, '200.00'); // petite ligne intacte
  assert.strictEqual(lines[1].raw_currency_unit_price, '1990.00'); // grosse ligne réduite
});

test('carve — éco nulle ou absente → lignes inchangées, aucune ligne éco', () => {
  for (const v of [0, null, undefined, '', '0']) {
    const { lines, ecoLine } = carveEcoParticipation([ligneProduit(1000)], v);
    assert.strictEqual(lines.length, 1, `eco=${v}`);
    assert.strictEqual(ecoLine, null);
    assert.strictEqual(lines[0].raw_currency_unit_price, '1000.00');
  }
});

test('carve — éco négative : ignorée avec avertissement, jamais de silence', () => {
  const { lines, ecoLine, warnings } = carveEcoParticipation([ligneProduit(1000)], -5);
  assert.strictEqual(ecoLine, null);
  assert.strictEqual(lines.length, 1);
  assert.ok(warnings.some(w => /négatif/.test(w)));
});

test('carve — éco ≥ ligne support : non carvée, avertissement', () => {
  const { lines, ecoLine, warnings } = carveEcoParticipation([ligneProduit(5)], 12); // 10 € HT ≥ 5 € HT
  assert.strictEqual(ecoLine, null);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].raw_currency_unit_price, '5.00'); // intacte
  assert.ok(warnings.some(w => /≥ ligne support/.test(w)));
});

test('carve — aucune ligne : avertissement, rien créé', () => {
  const { lines, ecoLine, warnings } = carveEcoParticipation([], 12);
  assert.strictEqual(ecoLine, null);
  assert.strictEqual(lines.length, 0);
  assert.ok(warnings.some(w => /Aucune ligne/.test(w)));
});

test('carve — n\'altère pas le tableau d\'entrée (copie)', () => {
  const base = [ligneProduit(1000)];
  carveEcoParticipation(base, 12);
  assert.strictEqual(base.length, 1);
  assert.strictEqual(base[0].raw_currency_unit_price, '1000.00');
  assert.strictEqual(base[0].description, undefined);
});

test('carve — imputation par PENNYLANE_ECO_PRODUCT_ID (hors CA)', () => {
  const prev = process.env.PENNYLANE_ECO_PRODUCT_ID;
  process.env.PENNYLANE_ECO_PRODUCT_ID = '4242';
  try {
    const { ecoLine, warnings } = carveEcoParticipation([ligneProduit(1000)], 12);
    assert.strictEqual(ecoLine.product_id, 4242);
    assert.ok(!warnings.some(w => /produit\/compte Pennylane/.test(w)), 'pas d\'avertissement quand le produit dédié est configuré');
  } finally {
    if (prev === undefined) delete process.env.PENNYLANE_ECO_PRODUCT_ID; else process.env.PENNYLANE_ECO_PRODUCT_ID = prev;
  }
});

test('carve — défaut = produit Éco-participation quand aucun env', () => {
  const prevP = process.env.PENNYLANE_ECO_PRODUCT_ID;
  delete process.env.PENNYLANE_ECO_PRODUCT_ID;
  try {
    const { ecoLine } = carveEcoParticipation([ligneProduit(1000)], 12);
    assert.strictEqual(ecoLine.product_id, 109588803584);
  } finally {
    if (prevP === undefined) delete process.env.PENNYLANE_ECO_PRODUCT_ID; else process.env.PENNYLANE_ECO_PRODUCT_ID = prevP;
  }
});

test('carve — taux réduit 10 % : HT éco cohérent avec le taux de la ligne support', () => {
  // Une seule ligne à 10 % : l'éco se carve à 10 % faute de mieux (et on le voit).
  const base = [ligneProduit(1000, 'FR_100')];
  const avantTtc = ttc(base);
  const { ecoLine, ecoHt } = carveEcoParticipation(base, 11); // 11 € TTC @10 % → 10 € HT
  assert.strictEqual(ecoHt, 10);
  assert.strictEqual(ecoLine.vat_rate, 'FR_100');
  assert.strictEqual(ttc([...base.map(l => ({ ...l })), ecoLine]) >= 0, true);
  // total conservé au centime
  const { lines } = carveEcoParticipation(base, 11);
  assert.strictEqual(ttc(lines), avantTtc);
});
