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

test('lecture texte si toutes les pages sont lisibles, repli PDF si une page est scannée', async () => {
  const { contenuPdf } = require('./devis-fournisseur-parser');
  const b = Buffer.from('%PDF-1.4 fictif');
  assert.strictEqual((await contenuPdf(b, async () => ({ text: ['Texte du devis '.repeat(20)] }))).mode, 'texte');
  assert.strictEqual((await contenuPdf(b, async () => ({ text: ['Texte '.repeat(50), ''] }))).mode, 'pdf');
});
test('cache borné : un seul appel IA pour deux lectures simultanées, puis réutilisation', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  let appels = 0;
  const lire = creerLecteur({ extraire: async () => ({ text: ['Descriptif '.repeat(20)] }), ia: async () => { appels++; return { texte: '{"totaux":{"total_ht":1010,"eco_ht":10,"eco_incluse":true}}' }; } });
  const buffer = Buffer.from('%PDF-1.4 fictif cache');
  const [a, b] = await Promise.all([lire(buffer), lire(buffer)]);
  a.totaux.total_ht = 1;
  const c = await lire(buffer);
  assert.strictEqual(appels, 1);
  assert.strictEqual(b.totaux.total_ht, 1010);
  assert.strictEqual(c.totaux.total_ht, 1010);
  assert.strictEqual(c.lecture_reutilisee, true);
});
test('échec de lecture non mis en cache : une relance peut réussir', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  let appels = 0;
  const lire = creerLecteur({ extraire: async () => ({ text: [] }), ia: async () => { if (++appels === 1) throw new Error('Essai indisponible'); return { texte: '{}' }; } });
  const b = Buffer.from('%PDF-fictif erreur');
  await assert.rejects(lire(b), /indisponible/);
  await lire(b);
  assert.strictEqual(appels, 2);
});
