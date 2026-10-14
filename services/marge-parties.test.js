/**
 * Tests services/marge-parties.js — marge de chaque partie d'un projet.
 * Cas réels : devis LAGO 381/15/17 (remise 10 %, pose + livraison) et projet
 * FINDIS 35789 (électroménager + mitigeur, prix d'achat connus).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { margeParParties, partieDeLigne } = require('./marge-parties');
const { normaliserArticles, construireDevisElectro } = require('./devis-electro');

const P = (ps, nom) => ps.parties.find(p => p.partie === nom);

// Devis 381/15/17 (MACE / LAGO) : 11 lignes « Meubles », remise 10 %, livraison 380, pose 720.
const montantsLago = [1801, 109, 121, 1166, 415, 1166, 541, 109, 903, 121, 817.6];
const DEVIS_LAGO = { id: 'recLAGO', fields: { 'Numéro devis': '381/15/17', Statut: 'Signé', 'Total HT articles': 7269.6, 'Total HT après remise': 6542.64, 'Livraison HT': 380, 'Pose HT': 720, 'Total HT final': 7642.64 } };
const LIGNES_LAGO = montantsLago.map((m, i) => ({ id: `recL${i}`, fields: { Devis: ['recLAGO'], Position: String(i + 1), 'Code produit': `C${i}`, 'Catégorie': 'Meubles', 'Montant HT': m } }));

describe('margeParParties()', () => {
  test('LAGO : CA réparti au centime — Mobilier 6 542,64 (remise appliquée), Pose & livraison 1 100', () => {
    const r = margeParParties({ devis: [DEVIS_LAGO], lignes: LIGNES_LAGO, commandes: [] });
    assert.equal(P(r, 'Mobilier').ca, 6542.64);
    assert.equal(P(r, 'Pose & livraison').ca, 1100);
    assert.equal(r.total.ca, 7642.64, 'somme des parties = Total HT final du devis');
    assert.equal(P(r, 'Mobilier').marge, null, 'ni prix d\'achat ni AR : marge inconnue, pas inventée');
  });

  test('LAGO : l\'AR du BC Mobilier devient le coût réel de la partie', () => {
    const bc = { id: 'recBC', fields: { 'Numéro': 'MACE · MEUBLES · 381/15/17-1', 'Montant AR': 4000, 'Lignes BC': JSON.stringify(LIGNES_LAGO.map(l => ({ pos: l.fields.Position, code: l.fields['Code produit'] }))) } };
    const r = margeParParties({ devis: [DEVIS_LAGO], lignes: LIGNES_LAGO, commandes: [bc] });
    const mob = P(r, 'Mobilier');
    assert.equal(mob.coutReel, 4000);
    assert.equal(mob.marge, 2542.64);
    assert.equal(mob.base, 'réelle');
  });

  test('FINDIS 35789 : marge prévue par partie, total = celle du devis (1 590,52 €), éco neutre', () => {
    const { articles } = normaliserArticles(require(path.join(__dirname, 'fixtures', 'findis', 'projet-35789.json')));
    const d = construireDevisElectro({ numero: 'EXP-2026-010', articles, tvaTaux: 20, dateDevis: '2026-10-14' });
    const devis = { id: 'recEXP', fields: { ...d.fields, Statut: 'Signé' } };
    const lignes = d.lignes.map((l, i) => ({ id: `recE${i}`, fields: { ...l, Devis: ['recEXP'] } }));
    const r = margeParParties({ devis: [devis], lignes, commandes: [] });
    const elec = P(r, 'Électroménager');
    const ptc = P(r, 'Plan de travail & crédence');
    assert.equal(elec.base, 'prévue');
    assert.equal(ptc.base, 'prévue', 'le mitigeur (Robinetterie) compte dans Plan de travail & crédence');
    assert.equal(ptc.marge, 69.36);
    assert.equal(r.total.ca, 4430.67);
    assert.equal(r.total.coutPrevu, 2840.15, 'achat 2 786,02 + éco 54,13');
    assert.equal(Math.round((elec.marge + ptc.marge) * 100) / 100, 1590.52);
  });

  test('devis signé sans total : hors calcul, et dit', () => {
    const r = margeParParties({ devis: [{ id: 'recZ', fields: { 'Numéro devis': '700/1/1', Statut: 'Signé' } }], lignes: [], commandes: [] });
    assert.deepEqual(r.parties, []);
    assert.match(r.alertes[0], /700\/1\/1 signé sans total HT/);
  });

  test('devis signé sans lignes : non ventilé, et dit', () => {
    const r = margeParParties({ devis: [{ id: 'recX', fields: { 'Numéro devis': '286/3/1', Statut: 'Signé', 'Total HT final': 1000 } }], lignes: [], commandes: [] });
    assert.equal(P(r, 'Non ventilé').ca, 1000);
    assert.match(r.alertes[0], /286\/3\/1.*non ventilés/);
  });

  test('devis non signé : pas de CA ; BC sans ligne reconnaissable → partie de sa référence courte', () => {
    const r = margeParParties({
      devis: [{ id: 'recB', fields: { 'Numéro devis': 'B1', Statut: 'Brouillon', 'Total HT final': 500 } }],
      lignes: [],
      commandes: [
        { id: 'c1', fields: { 'Numéro': 'X · ELECTRO · B1-1', 'Référence courte': 'ELECTRO', 'Montant AR': 300 } },
        { id: 'c2', fields: { 'Numéro': 'X · ??? · Z-1', 'Référence courte': 'INCONNUE', 'Montant AR': 50 } },
        { id: 'c3', fields: { 'Numéro': 'sans AR', 'Montant HT': 999 } },
      ],
    });
    assert.equal(r.total.ca, 0);
    assert.equal(P(r, 'Électroménager').coutReel, 300);
    assert.equal(P(r, 'Divers & à classer').coutReel, 50);
    assert.equal(r.total.coutReel, 350, 'sans AR, pas de coût réel (même règle que la marge globale)');
  });

  test('prix d\'achat connu sur une partie des lignes seulement → « partiel »', () => {
    const devis = [{ id: 'd', fields: { 'Numéro devis': 'D', Statut: 'Signé', 'Total HT final': 300, 'Total HT articles': 300 } }];
    const lignes = [
      { id: 'a', fields: { Devis: ['d'], 'Catégorie': 'Meubles', 'Montant HT': 200, 'Prix achat HT': 100 } },
      { id: 'b', fields: { Devis: ['d'], 'Catégorie': 'Meubles', 'Montant HT': 100 } },
    ];
    const mob = P(margeParParties({ devis, lignes, commandes: [] }), 'Mobilier');
    assert.equal(mob.prevuPartiel, true);
    assert.equal(mob.coutPrevu, 100);
  });

  test('partieDeLigne : Dépose → Pose & livraison, Divers → Divers & à classer', () => {
    assert.equal(partieDeLigne({ 'Catégorie': 'Dépose' }), 'Pose & livraison');
    assert.equal(partieDeLigne({ 'Catégorie': 'Divers' }), 'Divers & à classer');
    assert.equal(partieDeLigne({ 'Catégorie': 'Robinetterie' }), 'Plan de travail & crédence');
  });
});
