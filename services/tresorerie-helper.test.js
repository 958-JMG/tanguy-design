/**
 * Tests services/tresorerie-helper.js — node --test natif (ADR-004).
 *
 * Usage : node --test services/tresorerie-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { addDays, mondayOf, echeancesFacturees, buildPlanTresorerie, toCsv } = require('./tresorerie-helper');

describe('mondayOf()', () => {
  test('retourne le lundi de la semaine', () => {
    assert.equal(mondayOf('2026-06-06'), '2026-06-01'); // samedi → lundi 1er
    assert.equal(mondayOf('2026-06-01'), '2026-06-01'); // lundi → lui-même
    assert.equal(mondayOf('2026-06-07'), '2026-06-01'); // dimanche → lundi précédent
  });
  test('input invalide → null', () => {
    assert.equal(mondayOf(null), null);
    assert.equal(mondayOf('pas-une-date'), null);
  });
});

describe('echeancesFacturees()', () => {
  test('agrège les IDs d\'échéances liées aux factures', () => {
    const set = echeancesFacturees([
      { echeanceIds: ['recA', 'recB'] },
      { echeanceIds: [] },
      { echeanceIds: ['recC'] },
    ]);
    assert.equal(set.size, 3);
    assert.ok(set.has('recA') && set.has('recC'));
  });
  test('input vide → set vide', () => {
    assert.equal(echeancesFacturees([]).size, 0);
    assert.equal(echeancesFacturees(undefined).size, 0);
  });
});

describe('buildPlanTresorerie()', () => {
  const today = '2026-06-06'; // samedi, lundi courant = 2026-06-01

  test('ventile entrées/sorties par semaine avec solde cumulé', () => {
    const plan = buildPlanTresorerie({
      entrees: [
        { date: '2026-06-03', montant: 10000, label: 'FC-2026-001' },  // semaine 1
        { date: '2026-06-10', montant: 5000, label: 'Échéance livraison' }, // semaine 2
      ],
      sorties: [
        { date: '2026-06-04', montant: 4000, label: 'Modulnova' },      // semaine 1
      ],
      today, nbSemaines: 4,
    });
    assert.equal(plan.semaines.length, 4);
    assert.equal(plan.semaines[0].semaine, '2026-06-01');
    assert.equal(plan.semaines[0].encaissements, 10000);
    assert.equal(plan.semaines[0].decaissements, 4000);
    assert.equal(plan.semaines[0].solde, 6000);
    assert.equal(plan.semaines[1].encaissements, 5000);
    assert.equal(plan.semaines[1].soldeCumule, 11000);
  });

  test('retards / sans date / au-delà de l\'horizon vont dans les bons buckets', () => {
    const plan = buildPlanTresorerie({
      entrees: [
        { date: '2026-05-20', montant: 8000, label: 'impayé' },       // < today → en retard
        { date: null, montant: 1000, label: 'sans date' },
        { date: '2026-09-15', montant: 2000, label: 'lointain' },     // > horizon 4 sem.
      ],
      sorties: [],
      today, nbSemaines: 4,
    });
    assert.equal(plan.enRetard.encaissements, 8000);
    assert.equal(plan.sansDate.encaissements, 1000);
    assert.equal(plan.plusTard.encaissements, 2000);
    assert.equal(plan.totaux.encaissements, 8000); // retard inclus, lointain/sans date exclus
  });

  test('montants nuls ou négatifs ignorés', () => {
    const plan = buildPlanTresorerie({
      entrees: [{ date: '2026-06-03', montant: 0, label: 'rien' }, { date: '2026-06-03', montant: -50, label: 'avoir' }],
      sorties: [],
      today, nbSemaines: 2,
    });
    assert.equal(plan.semaines[0].encaissements, 0);
    assert.equal(plan.semaines[0].entrees.length, 0);
  });

  test('today invalide → throw', () => {
    assert.throws(() => buildPlanTresorerie({ entrees: [], sorties: [], today: 'invalide' }));
  });
});

describe('toCsv()', () => {
  const cols = [{ key: 'numero', label: 'Numéro' }, { key: 'montant', label: 'Montant HT' }];

  test('génère en-tête + lignes, séparateur ;, virgule décimale FR', () => {
    const csv = toCsv([{ numero: 'FC-001', montant: 1234.5 }], cols);
    assert.ok(csv.includes('Numéro;Montant HT'));
    assert.ok(csv.includes('FC-001;1234,5'));
  });

  test('échappe les valeurs contenant ; ou guillemets', () => {
    const csv = toCsv([{ numero: 'A;B', montant: 'dit "ok"' }], cols);
    assert.ok(csv.includes('"A;B"'));
    assert.ok(csv.includes('"dit ""ok"""'));
  });

  test('rows vide → en-tête seul', () => {
    const csv = toCsv([], cols);
    assert.ok(csv.endsWith('Numéro;Montant HT'));
  });
});
