/**
 * Tests services/echeances-helper.js — node --test natif (ADR-004).
 *
 * Usage : node --test services/echeances-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { deriveDateEcheance, enrichEcheancesAvecDates, offsetDays } = require('./echeances-helper');

describe('offsetDays()', () => {
  test('ajoute N jours à une date YYYY-MM-DD', () => {
    assert.equal(offsetDays('2026-01-01', 7), '2026-01-08');
    assert.equal(offsetDays('2026-12-25', 10), '2027-01-04');
  });

  test('retire N jours quand offset négatif', () => {
    assert.equal(offsetDays('2026-05-19', -7), '2026-05-12');
    assert.equal(offsetDays('2026-01-05', -10), '2025-12-26');
  });

  test('retourne null pour input falsy ou invalide', () => {
    assert.equal(offsetDays(null, 5), null);
    assert.equal(offsetDays('', 5), null);
    assert.equal(offsetDays(undefined, 5), null);
    assert.equal(offsetDays('pas-une-date', 5), null);
  });
});

describe('deriveDateEcheance()', () => {
  const dateDevis = '2026-01-22';
  const datePose = '2026-05-19';

  test('"A la commande" → date du devis', () => {
    assert.equal(deriveDateEcheance('A la commande', dateDevis, datePose), '2026-01-22');
  });

  test('"Acompte signature" → date du devis', () => {
    assert.equal(deriveDateEcheance('Acompte signature 30%', dateDevis, datePose), '2026-01-22');
  });

  test('"A la livraison" → date pose − 7 jours', () => {
    assert.equal(deriveDateEcheance('A la livraison', dateDevis, datePose), '2026-05-12');
  });

  test('"A la fin de la pose" → date pose + 5 jours', () => {
    assert.equal(deriveDateEcheance('A la fin de la pose', dateDevis, datePose), '2026-05-24');
  });

  test('"Solde" → date pose + 5 jours', () => {
    assert.equal(deriveDateEcheance('Solde après réception', dateDevis, datePose), '2026-05-24');
  });

  test('"Réception" / "Reception" (accent ou pas) → date pose + 5 jours', () => {
    assert.equal(deriveDateEcheance('A la réception', dateDevis, datePose), '2026-05-24');
    assert.equal(deriveDateEcheance('A la reception', dateDevis, datePose), '2026-05-24');
  });

  test('libellé inconnu → fallback date devis', () => {
    assert.equal(deriveDateEcheance('Quelque chose bizarre', dateDevis, datePose), '2026-01-22');
  });

  test('pose date manquante pour livraison → fallback date devis', () => {
    assert.equal(deriveDateEcheance('A la livraison', dateDevis, null), '2026-01-22');
  });

  test('toutes dates manquantes → null', () => {
    assert.equal(deriveDateEcheance('A la commande', null, null), null);
  });

  test('case insensitive', () => {
    assert.equal(deriveDateEcheance('A LA COMMANDE', dateDevis, datePose), '2026-01-22');
    assert.equal(deriveDateEcheance('À LA LIVRAISON', dateDevis, datePose), '2026-05-12');
  });
});

describe('enrichEcheancesAvecDates()', () => {
  test('reproduit le cas Morales (3 échéances sans date)', () => {
    // Cas réel : devis 563/1/12 signé 2026-01-22, pose prévue 2026-05-19
    const ech = [
      { ordre: 1, libelle: 'A la commande',        montant_prevu: 10945.58 },
      { ordre: 2, libelle: 'A la livraison',       montant_prevu: 23715.41 },
      { ordre: 3, libelle: 'A la fin de la pose',  montant_prevu: 1824.26  },
    ];
    const result = enrichEcheancesAvecDates(ech, '2026-01-22', '2026-05-19');
    assert.equal(result[0].date_prevue, '2026-01-22');
    assert.equal(result[1].date_prevue, '2026-05-12');
    assert.equal(result[2].date_prevue, '2026-05-24');
  });

  test('préserve les dates déjà fournies (manuelles)', () => {
    const ech = [{ libelle: 'A la commande', date_prevue: '2026-02-15' }];
    const result = enrichEcheancesAvecDates(ech, '2026-01-22', '2026-05-19');
    assert.equal(result[0].date_prevue, '2026-02-15', 'la date manuelle ne doit pas être écrasée');
  });

  test('input non-array → retourné tel quel', () => {
    assert.equal(enrichEcheancesAvecDates(null, '2026-01-22', '2026-05-19'), null);
    assert.equal(enrichEcheancesAvecDates(undefined, '2026-01-22', '2026-05-19'), undefined);
  });

  test('tableau vide → tableau vide', () => {
    assert.deepEqual(enrichEcheancesAvecDates([], '2026-01-22', '2026-05-19'), []);
  });
});
