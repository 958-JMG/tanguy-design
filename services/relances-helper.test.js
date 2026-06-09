/**
 * Tests services/relances-helper.js — node --test natif (ADR-004).
 *
 * Usage : node --test services/relances-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  joursRetard, niveauRelanceSuggere, buildEmailRelance,
  buildEmailRelanceFournisseur, buildMailto, fmtEuros, fmtDateFr,
} = require('./relances-helper');

describe('joursRetard()', () => {
  test('échéance dépassée → jours positifs', () => {
    assert.equal(joursRetard('2026-05-30', '2026-06-06'), 7);
  });
  test('échéance future → négatif, même jour → 0', () => {
    assert.equal(joursRetard('2026-06-10', '2026-06-06'), -4);
    assert.equal(joursRetard('2026-06-06', '2026-06-06'), 0);
  });
  test('inputs manquants → 0', () => {
    assert.equal(joursRetard(null, '2026-06-06'), 0);
    assert.equal(joursRetard('2026-06-06', null), 0);
  });
});

describe('niveauRelanceSuggere()', () => {
  test('cadence 7/21/35 jours', () => {
    assert.equal(niveauRelanceSuggere({ joursRetard: 3, niveauRelance: 0 }), 0);
    assert.equal(niveauRelanceSuggere({ joursRetard: 7, niveauRelance: 0 }), 1);
    assert.equal(niveauRelanceSuggere({ joursRetard: 21, niveauRelance: 0 }), 2);
    assert.equal(niveauRelanceSuggere({ joursRetard: 40, niveauRelance: 0 }), 3);
  });
  test('pas de re-suggestion si le niveau est déjà atteint', () => {
    assert.equal(niveauRelanceSuggere({ joursRetard: 10, niveauRelance: 1 }), 0);
    assert.equal(niveauRelanceSuggere({ joursRetard: 25, niveauRelance: 1 }), 2);
    assert.equal(niveauRelanceSuggere({ joursRetard: 40, niveauRelance: 3 }), 0);
  });
});

describe('buildEmailRelance()', () => {
  const base = { numero: 'FC-2026-012', clientNom: 'M. Livet', montantRestant: 4520.5, dateEcheance: '2026-05-15', projetRef: 'LIVET-CUIS' };

  test('niveau 1 : ton courtois, mentionne facture + montant + échéance', () => {
    const { sujet, corps } = buildEmailRelance({ ...base, niveau: 1 });
    assert.ok(sujet.includes('FC-2026-012'));
    assert.ok(corps.includes('4 520,50 €'.replace(/ /g, corps.includes(' ') ? ' ' : ' ')) || corps.includes('520,50'));
    assert.ok(corps.includes('15/05/2026'));
    assert.ok(corps.includes('M. Livet'));
    assert.ok(!sujet.includes('MISE EN DEMEURE'));
  });

  test('niveau 3 : mise en demeure avec référence légale', () => {
    const { sujet, corps } = buildEmailRelance({ ...base, niveau: 3 });
    assert.ok(sujet.includes('MISE EN DEMEURE'));
    assert.ok(corps.includes('L441-10'));
  });
});

describe('buildEmailRelanceFournisseur()', () => {
  test('mentionne numéro, contremarque et date prévue', () => {
    const { sujet, corps } = buildEmailRelanceFournisseur({
      numero: 'BC-0042', contremarque: 'MORALES', dateLivraisonPrevue: '2026-05-20', fournisseurNom: 'Modulnova',
    });
    assert.ok(sujet.includes('BC-0042'));
    assert.ok(sujet.includes('MORALES'));
    assert.ok(corps.includes('20/05/2026'));
    assert.ok(corps.includes('Modulnova'));
  });
});

describe('buildMailto() / formats', () => {
  test('mailto encodé avec sujet et corps', () => {
    const m = buildMailto('a@b.fr', 'Sujet é', 'Ligne 1\nLigne 2');
    assert.ok(m.startsWith('mailto:a@b.fr?subject='));
    assert.ok(m.includes(encodeURIComponent('Sujet é')));
    assert.ok(m.includes(encodeURIComponent('\n')));
  });
  test('fmtDateFr et fmtEuros gèrent les inputs invalides', () => {
    assert.equal(fmtDateFr(null), '—');
    assert.equal(fmtEuros(null), '—');
    assert.equal(fmtDateFr('2026-06-06'), '06/06/2026');
  });
});
