/**
 * Tests services/description-devis-helper.js — node --test natif (ADR-004).
 * Le descriptif alimente à la fois le bon de commande et la description des
 * lignes de facture Pennylane : les deux doivent raconter la même chose.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { zonePrincipale, titreZone, detailsZone, descriptionDevis, descriptionCourte } = require('./description-devis-helper');

const ZONES = [
  { id: 'z2', fields: { Ordre: 2, Marque: 'Autre', 'Modèle': 'Secondaire' } },
  { id: 'z1', fields: { Ordre: 1, Marque: 'Novamobili', 'Modèle': 'Night',
      'Exécution façade': 'Mat', 'Coloris façade': 'Foglia', 'Type de gorge': 'Gorge J' } },
];

describe('zonePrincipale()', () => {
  test('retient la zone d\'Ordre le plus petit, pas la première du tableau', () => {
    assert.equal(zonePrincipale(ZONES)['Modèle'], 'Night');
  });
  test('accepte des fields bruts comme des records Airtable', () => {
    assert.equal(zonePrincipale([{ Ordre: 1, 'Modèle': 'X' }])['Modèle'], 'X');
  });
  test('aucune zone → null', () => {
    assert.equal(zonePrincipale([]), null);
    assert.equal(zonePrincipale(undefined), null);
  });
});

describe('descriptionDevis()', () => {
  test('titre « Marque — Modèle » et détails dans l\'ordre du bon de commande', () => {
    const d = descriptionDevis(ZONES);
    assert.equal(d.titre, 'Novamobili — Night');
    assert.deepEqual(d.details, ['Exécution façade : Mat', 'Coloris façade : Foglia', 'Type de gorge : Gorge J']);
    assert.equal(d.vide, false);
  });

  test('les champs vides ou absents sont ignorés', () => {
    const d = descriptionDevis([{ Ordre: 1, Marque: 'Novamobili', 'Coloris façade': '   ', 'Modularité': null }]);
    assert.deepEqual(d.details, []);
    assert.equal(d.titre, 'Novamobili');
  });

  test('aucune zone exploitable → vide:true, pour que l\'appelant le DISE', () => {
    assert.equal(descriptionDevis([]).vide, true);
    assert.equal(descriptionDevis([{ Ordre: 1 }]).vide, true);
  });

  test('troncature avec marqueur de coupe', () => {
    const d = descriptionDevis([{ Ordre: 1, Marque: 'x'.repeat(300) }], { maxLongueur: 50 });
    assert.ok(d.texte.length <= 50);
    assert.match(d.texte, /…$/);
  });

  test('descriptionCourte() tient sur une ligne', () => {
    const c = descriptionCourte(ZONES);
    assert.doesNotMatch(c, /\n/);
    assert.match(c, /Novamobili — Night · /);
  });
});
