/**
 * Tests services/retro-apporteurs-helper.js — node --test natif (ADR-004).
 *
 * Usage : node --test services/retro-apporteurs-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildRetroApporteurs, TAUX_RETRO } = require('./retro-apporteurs-helper');

describe('buildRetroApporteurs()', () => {
  const clients = [
    { id: 'cliA', Apporteur: 'Solène' },
    { id: 'cliB', Apporteur: 'Solène' },
    { id: 'cliC', Apporteur: 'Virginie' },
    { id: 'cliD' }, // pas d'apporteur
  ];

  test('rétro réservée à Solène par défaut (Virginie exclue de l\'assiette)', () => {
    const { rows, totaux } = buildRetroApporteurs({
      clients,
      projets: [
        { clientIds: ['cliA'], budgetHT: 100000, phase: 'Signé' },
        { clientIds: ['cliB'], budgetHT: 50000, phase: 'Signé' },
        { clientIds: ['cliC'], budgetHT: 30000, phase: 'Signé' }, // Virginie → ignorée
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].apporteur, 'Solène');
    assert.equal(rows[0].nbDossiers, 2);
    assert.equal(rows[0].caHT, 150000);
    assert.equal(rows[0].retro, 4500); // 3 % de 150 000 (CA Solène uniquement)
    assert.equal(totaux.caHT, 150000); // 30k de Virginie NON compté
    assert.equal(totaux.nbDossiers, 2);
    assert.equal(totaux.retro, 4500);
  });

  test('apporteursRetro paramétrable : agrège plusieurs apporteurs si demandé', () => {
    const { rows, totaux } = buildRetroApporteurs({
      clients,
      apporteursRetro: ['Solène', 'Virginie'],
      projets: [
        { clientIds: ['cliA'], budgetHT: 100000, phase: 'Signé' },
        { clientIds: ['cliB'], budgetHT: 50000, phase: 'Signé' },
        { clientIds: ['cliC'], budgetHT: 30000, phase: 'Signé' },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].apporteur, 'Solène');
    assert.equal(rows[0].caHT, 150000);
    assert.equal(rows[1].apporteur, 'Virginie');
    assert.equal(rows[1].retro, 900);
    assert.equal(totaux.caHT, 180000);
    assert.equal(totaux.retro, 5400);
  });

  test('ignore les projets non signés (périmètre = Signé uniquement)', () => {
    const { rows, totaux } = buildRetroApporteurs({
      clients,
      projets: [
        { clientIds: ['cliA'], budgetHT: 100000, phase: 'Signé' },
        { clientIds: ['cliA'], budgetHT: 999999, phase: 'Découverte' },
        { clientIds: ['cliB'], budgetHT: 80000, phase: 'En attente décision' },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].caHT, 100000);
    assert.equal(totaux.retro, 3000);
  });

  test('ignore les projets dont le client n\'a pas d\'apporteur', () => {
    const { rows, totaux } = buildRetroApporteurs({
      clients,
      projets: [
        { clientIds: ['cliD'], budgetHT: 100000, phase: 'Signé' },
      ],
    });
    assert.equal(rows.length, 0);
    assert.equal(totaux.caHT, 0);
  });

  test('champ Apporteur absent partout → liste vide, pas d\'erreur (défensif)', () => {
    const { rows, totaux } = buildRetroApporteurs({
      clients: [{ id: 'cliA' }, { id: 'cliB' }],
      projets: [{ clientIds: ['cliA'], budgetHT: 100000, phase: 'Signé' }],
    });
    assert.equal(rows.length, 0);
    assert.equal(totaux.caHT, 0);
  });

  test('Budget HT manquant compté comme 0', () => {
    const { rows } = buildRetroApporteurs({
      clients,
      projets: [
        { clientIds: ['cliA'], phase: 'Signé' },
        { clientIds: ['cliA'], budgetHT: 40000, phase: 'Signé' },
      ],
    });
    assert.equal(rows[0].nbDossiers, 2);
    assert.equal(rows[0].caHT, 40000);
  });

  test('projet multi-clients : CA compté une seule fois via le 1er apporteur', () => {
    const { rows } = buildRetroApporteurs({
      clients,
      projets: [
        { clientIds: ['cliD', 'cliA'], budgetHT: 60000, phase: 'Signé' },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].apporteur, 'Solène');
    assert.equal(rows[0].caHT, 60000);
  });

  test('taux personnalisable (défaut = 3 %)', () => {
    assert.equal(TAUX_RETRO, 0.03);
    const { rows } = buildRetroApporteurs({
      clients,
      projets: [{ clientIds: ['cliA'], budgetHT: 100000, phase: 'Signé' }],
      taux: 0.05,
    });
    assert.equal(rows[0].retro, 5000);
  });

  test('entrées vides → résultat vide sans throw', () => {
    const { rows, totaux } = buildRetroApporteurs({});
    assert.equal(rows.length, 0);
    assert.equal(totaux.retro, 0);
  });
});
