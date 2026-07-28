'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEVIS_IMPORT_HASH_FIELD,
  computeImportHash,
  buildHashFilterFormula,
  findDevisByImportHash,
} = require('./devis-idempotency');

test('computeImportHash — même contenu → même empreinte (déterministe)', () => {
  const a = Buffer.from('%PDF-1.4 contenu devis winner');
  const b = Buffer.from('%PDF-1.4 contenu devis winner');
  assert.strictEqual(computeImportHash(a), computeImportHash(b));
  assert.match(computeImportHash(a), /^[0-9a-f]{64}$/);
});

test('computeImportHash — 1 octet de différence → empreinte différente', () => {
  const a = Buffer.from('%PDF-1.4 devis A');
  const b = Buffer.from('%PDF-1.4 devis B');
  assert.notStrictEqual(computeImportHash(a), computeImportHash(b));
});

test('computeImportHash — accepte un Uint8Array', () => {
  const buf = Buffer.from('xyz');
  const view = new Uint8Array(buf);
  assert.strictEqual(computeImportHash(view), computeImportHash(buf));
});

test('computeImportHash — rejette une entrée non-buffer', () => {
  assert.throws(() => computeImportHash('pas un buffer'), /buffer requis/);
  assert.throws(() => computeImportHash(null), /buffer requis/);
});

test('buildHashFilterFormula — formule Airtable correcte', () => {
  const hash = 'a'.repeat(64);
  assert.strictEqual(
    buildHashFilterFormula(hash),
    `{${DEVIS_IMPORT_HASH_FIELD}}='${hash}'`
  );
});

test('buildHashFilterFormula — refuse une valeur non-hex (anti-injection)', () => {
  assert.throws(() => buildHashFilterFormula("x')=1,'"), /sha256 hex attendue/);
  assert.throws(() => buildHashFilterFormula(''), /sha256 hex attendue/);
  assert.throws(() => buildHashFilterFormula('ABC'), /sha256 hex attendue/);
});

test('findDevisByImportHash — retrouve le devis existant', () => {
  const hash = computeImportHash(Buffer.from('devis winner 42'));
  const records = [
    { id: 'rec1', fields: { 'Numéro devis': 'D-1' } },
    { id: 'rec2', fields: { 'Numéro devis': 'D-2', [DEVIS_IMPORT_HASH_FIELD]: hash } },
  ];
  const found = findDevisByImportHash(records, hash);
  assert.ok(found);
  assert.strictEqual(found.id, 'rec2');
});

test('findDevisByImportHash — null si aucune correspondance', () => {
  const records = [{ id: 'rec1', fields: { [DEVIS_IMPORT_HASH_FIELD]: 'deadbeef' } }];
  assert.strictEqual(findDevisByImportHash(records, 'autre'), null);
  assert.strictEqual(findDevisByImportHash([], 'x'), null);
  assert.strictEqual(findDevisByImportHash(null, 'x'), null);
});

// Scénario réel : upload → annulation → retry avec LE MÊME fichier.
// La 2e passe doit retrouver le devis créé par la 1re et ne PAS en recréer un.
test('scénario doublon — le retry du même PDF retrouve le devis créé', () => {
  const pdf = Buffer.from('%PDF-1.4 Winner devis Mme Martin cuisine');
  const hash1 = computeImportHash(pdf);      // 1re tentative
  const devisCree = { id: 'recABC', fields: { 'Numéro devis': 'WIN-100', [DEVIS_IMPORT_HASH_FIELD]: hash1 } };

  // 2e tentative (retry) — même fichier, on relit la table
  const hash2 = computeImportHash(pdf);
  assert.strictEqual(hash1, hash2);
  const existant = findDevisByImportHash([devisCree], hash2);
  assert.ok(existant, 'le retry doit retrouver le devis déjà créé');
  assert.strictEqual(existant.id, 'recABC');
});
