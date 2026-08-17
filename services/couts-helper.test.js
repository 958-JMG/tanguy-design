/**
 * Tests services/couts-helper.js — node --test natif (ADR-004).
 * Usage : node --test services/couts-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  sumCouts, retenuePerte, retenueResteAEncaisser, computeMarge, leveePrevue,
} = require('./couts-helper');

describe('sumCouts()', () => {
  test('agrège total / sur marge / refacturé + ventile par type', () => {
    const r = sumCouts([
      { montant: 250, imputation: 'Tanguy (sur marge)', type: 'SAV / reprise' },
      { montant: 350, imputation: 'Refacturé client', type: 'Transport / livraison' },
      { montant: 100, imputation: 'Tanguy (sur marge)', type: 'SAV / reprise' },
    ]);
    assert.equal(r.total, 700);
    assert.equal(r.surMarge, 350);
    assert.equal(r.refactureClient, 350);
    assert.equal(r.parType['SAV / reprise'], 350);
    assert.equal(r.parType['Transport / livraison'], 350);
    assert.equal(r.count, 3);
  });

  test('sans imputation explicite → compté sur la marge (défaut prudent)', () => {
    const r = sumCouts([{ montant: 120, type: 'Frais divers' }]);
    assert.equal(r.surMarge, 120);
    assert.equal(r.refactureClient, 0);
  });

  test('liste vide / non-array / montants pourris → 0, pas de crash', () => {
    assert.equal(sumCouts([]).total, 0);
    assert.equal(sumCouts(null).total, 0);
    assert.equal(sumCouts([{ montant: 'abc' }, { montant: null }]).total, 0);
  });
});

describe('retenue helpers', () => {
  test('perte sèche uniquement si abandonnée', () => {
    assert.equal(retenuePerte({ montant: 500, statut: 'Abandonnée' }), 500);
    assert.equal(retenuePerte({ montant: 500, statut: 'En cours' }), 0);
    assert.equal(retenuePerte({ montant: 500, statut: 'Levée / encaissée' }), 0);
    assert.equal(retenuePerte(null), 0);
  });
  test('reste à encaisser uniquement si en cours', () => {
    assert.equal(retenueResteAEncaisser({ montant: 500, statut: 'En cours' }), 500);
    assert.equal(retenueResteAEncaisser({ montant: 500, statut: 'Levée / encaissée' }), 0);
    assert.equal(retenueResteAEncaisser(null), 0);
  });
});

describe('computeMarge()', () => {
  test('cas de base sans coûts ni retenue = formule historique (caHT - fourn + rétro)', () => {
    const r = computeMarge({ caHT: 20000, coutFourn: 12000, retro: 500 });
    assert.equal(r.margeAbs, 8500);
    assert.equal(r.coutReelChantier, 12000);
    assert.equal(r.resteAEncaisser, 0);
    assert.ok(Math.abs(r.margePct - 42.5) < 1e-9);
  });

  test('GUERRIER — retenue 500 € EN COURS : n’ampute pas la marge, mais reste à encaisser', () => {
    const r = computeMarge({
      caHT: 20000, coutFourn: 12000, retro: 0,
      retenue: { montant: 500, statut: 'En cours' },
    });
    assert.equal(r.margeAbs, 8000);      // marge inchangée
    assert.equal(r.resteAEncaisser, 500); // affiché comme dû
    assert.equal(r.retenuePerte, 0);
  });

  test('retenue ABANDONNÉE : perte sèche → ampute la marge', () => {
    const r = computeMarge({
      caHT: 20000, coutFourn: 12000, retro: 0,
      retenue: { montant: 500, statut: 'Abandonnée' },
    });
    assert.equal(r.margeAbs, 7500);
    assert.equal(r.resteAEncaisser, 0);
    assert.equal(r.retenuePerte, 500);
  });

  test('MORALES — reprise peintre 250 € sur marge : ampute la marge, entre dans le coût réel', () => {
    const r = computeMarge({
      caHT: 20000, coutFourn: 12000, retro: 0,
      couts: [{ montant: 250, imputation: 'Tanguy (sur marge)', type: 'SAV / reprise' }],
    });
    assert.equal(r.margeAbs, 7750);
    assert.equal(r.coutReelChantier, 12250);
    assert.equal(r.coutsSurMarge, 250);
  });

  test('CHARTIN — transport 350 € refacturé client : neutre sur la marge', () => {
    const r = computeMarge({
      caHT: 20000, coutFourn: 12000, retro: 0,
      couts: [{ montant: 350, imputation: 'Refacturé client', type: 'Transport / livraison' }],
    });
    assert.equal(r.margeAbs, 8000);       // pas d'impact marge
    assert.equal(r.coutReelChantier, 12000);
    assert.equal(r.coutsRefactures, 350);
  });

  test('DUPUY — mix compléments (sur marge + refacturés) + retenue en cours', () => {
    const r = computeMarge({
      caHT: 30000, coutFourn: 18000, retro: 200,
      couts: [
        { montant: 800, imputation: 'Tanguy (sur marge)', type: 'Complément commande' },
        { montant: 400, imputation: 'Refacturé client', type: 'Complément commande' },
      ],
      retenue: { montant: 300, statut: 'En cours' },
    });
    // 30000 - 18000 + 200 - 800 (sur marge) = 11400
    assert.equal(r.margeAbs, 11400);
    assert.equal(r.coutReelChantier, 18800);
    assert.equal(r.coutsSurMarge, 800);
    assert.equal(r.coutsRefactures, 400);
    assert.equal(r.resteAEncaisser, 300);
  });

  test('caHT = 0 → margePct null (pas de division par zéro)', () => {
    const r = computeMarge({ caHT: 0, coutFourn: 0 });
    assert.equal(r.margePct, null);
  });
});

describe('leveePrevue()', () => {
  test('retenue de garantie loi 1971 → +1 an', () => {
    assert.equal(leveePrevue('2026-08-17', 'Retenue de garantie (loi 1971)'), '2027-08-17');
  });
  test('autre type → null', () => {
    assert.equal(leveePrevue('2026-08-17', 'Retenue SAV / réserves'), null);
  });
  test('date invalide → null', () => {
    assert.equal(leveePrevue('', 'Retenue de garantie (loi 1971)'), null);
    assert.equal(leveePrevue(null, 'Retenue de garantie (loi 1971)'), null);
  });
});
