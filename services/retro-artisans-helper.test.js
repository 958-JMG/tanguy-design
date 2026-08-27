/**
 * Tests services/retro-artisans-helper.js — node --test natif (ADR-004).
 *
 * Le test qui compte : un artisan NON contractuel doit compter dans la rétro.
 * C'est la règle du 29/07/2026, qui n'avait été appliquée que sur la fiche
 * projet — l'écran admin des marges filtrait encore, et affichait donc une
 * marge différente pour le même chantier.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TAUX_RETRO, dedupliquerDevisArtisans, retroDevis, retroTotale } = require('./retro-artisans-helper');

const devis = (fields, id = 'rec' + Math.random().toString(36).slice(2)) => ({ id, fields });

describe('retroDevis()', () => {
  test('lit « Rétro-commission HT » en priorité (commission négociée)', () => {
    assert.equal(retroDevis(devis({ 'Montant HT': 1000, 'Rétro-commission HT': 80 })), 80);
  });

  test('à défaut, 5 % du montant HT', () => {
    assert.equal(retroDevis(devis({ 'Montant HT': 1000 })), 50);
    assert.equal(TAUX_RETRO, 0.05);
  });

  test('une rétro stockée à 0 est respectée, pas recalculée', () => {
    assert.equal(retroDevis(devis({ 'Montant HT': 1000, 'Rétro-commission HT': 0 })), 0);
  });

  test('devis sans montant → 0', () => {
    assert.equal(retroDevis(devis({})), 0);
  });

  test('accepte aussi des fields bruts', () => {
    assert.equal(retroDevis({ 'Montant HT': 2000 }), 100);
  });
});

describe('retroTotale() — la règle du 29/07', () => {
  test('un artisan NON contractuel compte dans la rétro', () => {
    // Le champ Contractuel ne doit plus avoir AUCUN effet sur le calcul.
    const avec = retroTotale([devis({ 'Montant HT': 1000, Contractuel: true })]).total;
    const sans = retroTotale([devis({ 'Montant HT': 1000, Contractuel: false })]).total;
    assert.equal(avec, 50);
    assert.equal(sans, 50);
    assert.equal(avec, sans);
  });

  test('somme plusieurs devis', () => {
    const r = retroTotale([
      devis({ 'Montant HT': 1000, 'Numéro devis': 'A-1' }),
      devis({ 'Montant HT': 3000, 'Numéro devis': 'A-2' }),
    ]);
    assert.equal(r.total, 200);
    assert.equal(r.devisRetenus, 2);
    assert.equal(r.devisIgnores, 0);
  });

  test('liste vide → 0', () => {
    assert.equal(retroTotale([]).total, 0);
    assert.equal(retroTotale(undefined).total, 0);
  });
});

describe('dedupliquerDevisArtisans()', () => {
  test('même numéro ET même montant → un seul retenu', () => {
    const l = [
      devis({ 'Numéro devis': 'DA-42', 'Montant HT': 1000 }, 'r1'),
      devis({ 'Numéro devis': 'DA-42', 'Montant HT': 1000 }, 'r2'),
    ];
    const r = retroTotale(l);
    assert.equal(r.total, 50, 'un devis importé deux fois ne doit pas compter double');
    assert.equal(r.devisIgnores, 1);
  });

  test('même numéro mais montant différent → deux devis distincts', () => {
    const l = [
      devis({ 'Numéro devis': 'DA-42', 'Montant HT': 1000 }, 'r1'),
      devis({ 'Numéro devis': 'DA-42', 'Montant HT': 2000 }, 'r2'),
    ];
    assert.equal(dedupliquerDevisArtisans(l).length, 2);
  });

  test('numéros absents ou AUTO- : jamais dédupliqués entre eux', () => {
    const l = [
      devis({ 'Montant HT': 1000 }, 'r1'),
      devis({ 'Montant HT': 1000 }, 'r2'),
      devis({ 'Numéro devis': 'AUTO-1', 'Montant HT': 500 }, 'r3'),
      devis({ 'Numéro devis': 'AUTO-1', 'Montant HT': 500 }, 'r4'),
    ];
    assert.equal(dedupliquerDevisArtisans(l).length, 4, 'deux devis sans numéro sont deux devis');
  });

  test('les doublons écartés sont comptés, pas escamotés', () => {
    const l = [
      devis({ 'Numéro devis': 'X', 'Montant HT': 100 }, 'r1'),
      devis({ 'Numéro devis': 'X', 'Montant HT': 100 }, 'r2'),
      devis({ 'Numéro devis': 'X', 'Montant HT': 100 }, 'r3'),
    ];
    assert.equal(retroTotale(l).devisIgnores, 2);
  });
});
