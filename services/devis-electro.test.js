/**
 * Tests services/devis-electro.js — sur les 6 projets FINDIS réels du 14/10/2026
 * (services/fixtures/findis/, articles seulement, sans le bloc client).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  nombreFr, familleFindis, normaliserArticles, montantsLigne, totauxArticles, construireDevisElectro,
} = require('./devis-electro');

const projet = n => require(path.join(__dirname, 'fixtures', 'findis', `projet-${n}.json`));

describe('nombreFr()', () => {
  test('format FINDIS', () => {
    assert.equal(nombreFr('1 166,56'), 1166.56);
    assert.equal(nombreFr('1 999,00 € TTC'), 1999);
    assert.equal(nombreFr('0,01 € HT'), 0.01);
    assert.equal(nombreFr(519.9), 519.9);
  });
  test('rien d\'exploitable → null (jamais 0 inventé)', () => {
    assert.equal(nombreFr(''), null);
    assert.equal(nombreFr(null), null);
    assert.equal(nombreFr('Sur commande'), null);
  });
});

describe('familleFindis()', () => {
  test('mitigeur → Robinetterie, le reste → Électroménager', () => {
    assert.equal(familleFindis('Mitigeur sans douchette', 'Mitigeur'), 'Robinetterie');
    assert.equal(familleFindis('Four encastrable', 'Four pyrolyse'), 'Électroménager');
    assert.equal(familleFindis('Hotte encastrée', 'Hotte encastrée'), 'Électroménager');
  });
});

describe('normaliserArticles() — 6 projets réels', () => {
  test('35789 : 5 articles, 2 promos retenues comme prix d\'achat, mitigeur en Robinetterie', () => {
    const r = normaliserArticles(projet('35789'));
    assert.equal(r.articles.length, 5);
    const smeg = r.articles.find(a => a.reference === 'SCD90IMX9-1');
    assert.equal(smeg.achatHtUnit, 1166.56);
    assert.equal(smeg.promoHtUnit, 1118.72);
    assert.equal(smeg.promoRetenue, true);
    assert.equal(smeg.achatRetenuHtUnit, 1118.72);
    assert.equal(smeg.venteTtcUnit, 1999);
    assert.equal(smeg.ecoHtUnit, 12.2);
    const hotte = r.articles.find(a => a.reference === 'PRF0114761A');
    assert.equal(hotte.promoRetenue, false);
    assert.equal(hotte.achatRetenuHtUnit, 222.04);
    assert.equal(r.articles.find(a => a.reference === '17155#031').famille, 'Robinetterie');
    assert.ok(r.articles.every(a => a.selectionnable));
    assert.deepEqual(r.comparatifs, []);
  });

  test('35658 : l\'article remplacé n\'a pas de prix → non sélectionnable, avec la raison', () => {
    const r = normaliserArticles(projet('35658'));
    assert.equal(r.articles.length, 17);
    const remplace = r.articles.find(a => a.reference === 'SPH4HL801E');
    assert.equal(remplace.selectionnable, false);
    assert.match(remplace.raisonNonSelectionnable, /SPH4HL802E/);
    assert.equal(r.articles.filter(a => a.selectionnable).length, 16);
  });

  test('comparatifs repérés par nature d\'appareil : 3 fours (32470), 3 réfrigérateurs (35757)', () => {
    const fours = normaliserArticles(projet('32470')).comparatifs;
    assert.deepEqual(fours.map(c => [c.type, c.ids.length]), [['Four', 3]], '« Four encastrable » ×2 + « Four encastrable nettoyage vapeur »');
    const frigos = normaliserArticles(projet('35757')).comparatifs;
    assert.deepEqual(frigos.map(c => [c.type, c.ids.length]), [['Réfrigérateur', 3]], 'le Gaggenau « Réfrigérateur intégrable » en fait partie');
  });

  test('aucun comparatif quand chaque appareil est unique (35789)', () => {
    assert.deepEqual(normaliserArticles(projet('35789')).comparatifs, []);
  });

  test('« Hors tarif », « Sur commande », délai et stock gardés en note', () => {
    const r = normaliserArticles(projet('35449'));
    const prestige = r.articles.find(a => a.marque === 'MIELE PRESTIGE');
    assert.equal(prestige.horsTarif, true);
    assert.ok(prestige.notes.includes('Hors tarif FINDIS'));
    const aeg = r.articles.find(a => a.reference === 'FFB83816PM');
    assert.ok(aeg.notes.some(n => /^Délai : 6\/21\.10\.2026$/.test(n)));
  });

  test('même article sur deux captures → compté une fois, et dit', () => {
    const p = projet('35789');
    const lu = { articles: [...p.articles.map(a => ({ ...a, source: 0 })), { ...p.articles[4], source: 1 }] };
    const r = normaliserArticles(lu, { nbFichiers: 2 });
    assert.equal(r.articles.length, 5);
    assert.ok(r.alertes.some(a => /deux captures/.test(a)));
  });

  test('promo supérieure au prix d\'achat : prix d\'achat retenu, et dit', () => {
    const r = normaliserArticles({ articles: [{ reference: 'X1', prix_vente_ttc: '100,00', prix_achat_ht: '40,00', promo_ht: '45,00', eco_part_ht: '1,00' }] });
    assert.equal(r.articles[0].achatRetenuHtUnit, 40);
    assert.ok(r.articles[0].notes.some(n => /supérieure/.test(n)));
  });

  test('aucun article lu → alerte (une panne n\'est pas une liste vide)', () => {
    assert.ok(normaliserArticles({ articles: [] }).alertes.length);
  });
});

describe('marges', () => {
  test('35789, les 5 articles à 20 % : 1 590,52 € HT de marge (36,3 %)', () => {
    const { articles } = normaliserArticles(projet('35789'));
    const t = totauxArticles(articles, 20);
    assert.equal(t.global.venteTtc, 5316.8);
    assert.equal(t.global.ecoHt, 54.13);
    assert.equal(t.global.achatHt, 2786.02);
    assert.equal(t.global.marge, 1590.52);
    assert.equal(t.global.margePct, 36.34);
    assert.equal(t.parFamille['Robinetterie'].nb, 1);
    assert.equal(t.parFamille['Électroménager'].nb, 4);
  });

  test('ligne : quantité 2 → montants doublés', () => {
    const m = montantsLigne({ quantite: 2, venteTtcUnit: 120, ecoHtUnit: 1, achatRetenuHtUnit: 50 }, 20);
    assert.deepEqual(m, { venteTtc: 240, venteHt: 200, ecoHt: 2, venteHtHorsEco: 198, achatHt: 100, marge: 98, margePct: 49.49 });
  });
});

describe('construireDevisElectro()', () => {
  const { articles } = normaliserArticles(projet('35789'));
  const r = construireDevisElectro({
    numero: 'EXP-2026-010', articles, tvaTaux: 20, dateDevis: '2026-10-14',
    typeDevis: 'Additif', projetFindis: '35789', fournisseurId: 'recFINDIS',
  });

  test('totaux depuis les bases de TVA, au centime des prix FINDIS', () => {
    assert.equal(r.coherence.ok, true, JSON.stringify(r.coherence));
    assert.equal(r.fields['Total TTC'], 5316.8);
    assert.equal(r.fields['Total HT final'], 4430.67);
    assert.equal(r.fields['TVA taux 1 montant'], 886.13);
    assert.equal(r.fields['Eco-participation électroménager'], 54.13);
    assert.equal(r.fields['Éco-participation'], 64.96, '« dont éco » TTC pour Pennylane');
    assert.equal(r.fields['Type devis'], 'Additif');
    assert.match(r.fields['Notes internes'], /Projet FINDIS n° 35789/);
    assert.match(r.fields['Notes internes'], /marge prévue 1[\s\u202F\u00A0]590,52 € HT \(36,34 %\)/);
    assert.deepEqual(r.avertissements, []);
  });

  test('une ligne par article : catégorie, référence, montant hors éco, éco, prix d\'achat, fournisseur', () => {
    assert.equal(r.lignes.length, 5);
    const smeg = r.lignes[0];
    assert.equal(smeg['Catégorie'], 'Électroménager');
    assert.equal(smeg['Code produit'], 'SCD90IMX9-1');
    assert.equal(smeg['Montant HT'], 1653.63, '1999/1,2 − 12,20');
    assert.equal(smeg['Eco-participation'], 12.2);
    assert.equal(smeg['Prix achat HT'], 1118.72);
    assert.deepEqual(smeg['Fournisseur'], ['recFINDIS']);
    assert.match(smeg['Notes'], /Promo FINDIS retenue/);
    assert.equal(r.lignes[4]['Catégorie'], 'Robinetterie');
    assert.equal(smeg['Désignation'], 'SMEG Piano de cuisson induction', 'type FINDIS identique : pas répété');
    assert.equal(r.lignes[1]['Désignation'], 'SAMSUNG Réfrigérateur combiné\nRéfrigérateur intégrable combiné', 'type FINDIS plus précis : gardé');
    const somme = Math.round(r.lignes.reduce((s, l) => s + l['Montant HT'] + l['Eco-participation'], 0) * 100) / 100;
    assert.equal(somme, r.fields['Total HT final'], 'lignes + éco = Total HT final, au centime');
  });

  test('aucun article retenu → incohérent, refusé', () => {
    const vide = construireDevisElectro({ numero: 'X', articles: [], tvaTaux: 20, dateDevis: '2026-10-14' });
    assert.equal(vide.coherence.ok, false);
    assert.ok(vide.avertissements.includes('Aucun article retenu'));
  });

  test('les 6 projets complets se construisent sans incohérence', () => {
    for (const n of ['35658', '35859', '35789', '35449', '32470', '35757']) {
      const arts = normaliserArticles(projet(n)).articles.filter(a => a.selectionnable);
      const d = construireDevisElectro({ numero: 'X', articles: arts, tvaTaux: 20, dateDevis: '2026-10-14' });
      assert.equal(d.coherence.ok, true, `projet ${n}`);
      assert.equal(d.lignes.length, arts.length);
    }
  });
});
