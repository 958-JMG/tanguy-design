// Libellés de ligne Pennylane « en mots de client » (demande JMG du 14/10/2026 :
// « le libellé doit être électroménager, les clients doivent comprendre ce à quoi
// correspond quoi ») et référence externe déjà prise (test grandeur nature du 14/10).
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const pennylane = require('./pennylane');
const { libellesParTaux, natureDeCategorie, buildInvoiceLines, buildEcheanceInvoiceLines } = pennylane;
const { normaliserArticles, construireDevisElectro } = require('./devis-electro');

describe('libellesParTaux()', () => {
  test('FINDIS 35789 → « Électroménager et robinetterie » à 20 %', () => {
    const { articles } = normaliserArticles(require(path.join(__dirname, 'fixtures', 'findis', 'projet-35789.json')));
    const d = construireDevisElectro({ numero: 'X', articles, tvaTaux: 20, dateDevis: '2026-10-14' });
    assert.deepEqual(libellesParTaux(d.lignes, d.fields), { 20: 'Électroménager et robinetterie' });
  });

  test('Devis express meuble (Novamobili, 10 %) → « Mobilier » (avant : « Produit cuisine — pose et prestations »)', () => {
    const f = { 'TVA taux 1 pourcentage': 10 };
    assert.deepEqual(libellesParTaux([{ 'Catégorie': 'Mobilier', 'Montant HT': 15524, 'TVA pourcentage': 10, 'Eco-participation': 121.21 }], f), { 10: 'Mobilier' });
  });

  test('Cuisine Winner : chaque taux nommé d\'après son contenu, pose et livraison comprises', () => {
    const f = { 'TVA taux 1 pourcentage': 20, 'TVA taux 2 pourcentage': 10, 'Pose HT': 720, 'Pose TVA taux': 10, 'Livraison HT': 380, 'Livraison TVA taux': 10 };
    const lignes = [
      { 'Catégorie': 'Meubles', 'Montant HT': 7269.6, 'TVA pourcentage': 10 },
      { 'Catégorie': 'Plan de travail', 'Montant HT': 1800, 'TVA pourcentage': 10 },
      { 'Catégorie': 'Électroménager', 'Montant HT': 2915.83, 'TVA pourcentage': 20 },
      { 'Catégorie': 'Luminaire', 'Montant HT': 300, 'TVA pourcentage': 20 },
    ];
    assert.deepEqual(libellesParTaux(lignes, f), { 10: 'Mobilier, plan de travail, pose et livraison', 20: 'Électroménager et luminaires' });
    const cinq = [...lignes, { 'Catégorie': 'Crédence', 'Montant HT': 50, 'TVA pourcentage': 10 }];
    assert.equal(libellesParTaux(cinq, f)[10], 'Mobilier, plan de travail, pose et autres', 'au-delà de 4 : les 3 principales');
  });

  test('sans catégorie reconnue (ou pose seule) → aucun libellé : l\'ancien reste', () => {
    assert.deepEqual(libellesParTaux([{ 'Catégorie': 'Divers', 'Montant HT': 100 }], {}), {});
    assert.deepEqual(libellesParTaux([], { 'Pose HT': 200, 'Pose TVA taux': 10 }), {});
  });

  test('natureDeCategorie : vocabulaire Winner et FINDIS', () => {
    assert.equal(natureDeCategorie('Eviers et robinetterie'), 'Évier et robinetterie');
    assert.equal(natureDeCategorie('Panneaux de recouvrement'), 'Mobilier');
    assert.equal(natureDeCategorie('Robinetterie'), 'Robinetterie');
    assert.equal(natureDeCategorie('Produits de vente'), 'Accessoires');
    assert.equal(natureDeCategorie(''), null);
  });

  test('buildInvoiceLines / buildEcheanceInvoiceLines utilisent le libellé ; repli inchangé', () => {
    const f = { 'TVA taux 1 base': 4430.67, 'TVA taux 1 pourcentage': 20, 'Total TTC': 5316.8 };
    assert.equal(buildInvoiceLines(f, { libelles: { 20: 'Électroménager et robinetterie' } }).lines[0].label, 'Électroménager et robinetterie');
    assert.equal(buildInvoiceLines(f).lines[0].label, 'Produit cuisine', 'sans libellé : comportement d\'avant');
    assert.equal(buildEcheanceInvoiceLines(f, 1595.04, 'Acompte 30 %', { libelles: { 20: 'Électroménager' } }).lines[0].label, 'Acompte 30 % — Électroménager');
  });
});

test('référence externe déjà prise : un nouvel essai horodaté, et c\'est dit', async () => {
  process.env.PENNYLANE_API_KEY = 'plTEST';
  const vrai = globalThis.fetch;
  const recus = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    recus.push(body.external_reference);
    if (body.external_reference === 'EXP-2026-004') {
      return new Response(JSON.stringify({ message: 'External reference has already been taken' }), { status: 422 });
    }
    return new Response(JSON.stringify({ id: 42, quote_number: 'D-2026-10-30', status: 'pending' }), { status: 201 });
  };
  try {
    const q = await pennylane.createDraftQuote({ customer_id: '1', date: '2026-10-14', deadline: '2026-11-13', lines: [{ label: 'x' }], external_reference: 'EXP-2026-004' });
    assert.equal(recus.length, 2);
    assert.equal(q.referenceDejaPrise, 'EXP-2026-004');
    assert.match(q.reference, /^EXP-2026-004 · \d\d\/\d\d \d\d:\d\d:\d\d$/);
    assert.equal(q.number, 'D-2026-10-30');
    // Une autre erreur n'est jamais maquillée en nouvel essai.
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'customer_id invalide' }), { status: 422 });
    await assert.rejects(pennylane.createDraftQuote({ customer_id: '1', date: 'x', deadline: 'y', lines: [{}], external_reference: 'EXP-1' }), /customer_id invalide/);
  } finally { globalThis.fetch = vrai; }
});
