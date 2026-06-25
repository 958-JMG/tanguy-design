/**
 * Tests services/devis-fournisseur-parser.js (P-H3).
 * Couvre l'extraction JSON robuste (sans appel réseau).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { extractJson } = require('./devis-fournisseur-parser');

test('extractJson : JSON pur', () => {
  const o = extractJson('{"totaux":{"total_ht":7762}}');
  assert.strictEqual(o.totaux.total_ht, 7762);
});

test('extractJson : JSON avec préambule et suffixe', () => {
  const o = extractJson('Voici le résultat :\n{"fournisseur":{"nom":"Granit Evolution"}}\nFin.');
  assert.strictEqual(o.fournisseur.nom, 'Granit Evolution');
});

test('extractJson : JSON dans un bloc markdown', () => {
  const o = extractJson('```json\n{"variante_prix":"PRO","lignes_detail":[]}\n```');
  assert.strictEqual(o.variante_prix, 'PRO');
  assert.deepStrictEqual(o.lignes_detail, []);
});

test('extractJson : pas de JSON → throw', () => {
  assert.throws(() => extractJson('aucun json ici'), /sans JSON/);
});

test('extractJson : JSON malformé → throw explicite', () => {
  assert.throws(() => extractJson('{"a": }'), /JSON invalide/);
});
