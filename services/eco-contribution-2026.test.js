'use strict';
// Barème éco-participation Ecomaison 2026 (poids estimé à la dimension).
// Preuve d'identité : reproduit AU CENTIME les 3 exemples de la feuille de Virginie.
const { test } = require('node:test');
const assert = require('node:assert');
const eco = require('./eco-contribution-2026');

const PARTICULES = 'Panneaux particules ≥75% - sans gestion durable';

test('exemple « Bas 60 » : 28,39 kg → tranche 20-30 → 3,71 € HT', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES });
  assert.ok(Math.abs(r.poidsKg - 28.3855104) < 0.01, `poids ${r.poidsKg}`);
  assert.strictEqual(r.tranche, '≥ 20 et < 30 kg');
  assert.strictEqual(r.ecoHtUnitaire, 3.71);
  assert.strictEqual(r.source, 'estimation-dimensions');
});

test('exemple « Haut 60 » : 19,79 kg → tranche 10-20 → 2,38 € HT', () => {
  const r = eco.ecoPiece({ type: 'Meuble haut', largeurMm: 600, hauteurMm: 720, profondeurMm: 350, classeMatiere: PARTICULES });
  assert.ok(Math.abs(r.poidsKg - 19.787976) < 0.01, `poids ${r.poidsKg}`);
  assert.strictEqual(r.tranche, '≥ 10 et < 20 kg');
  assert.strictEqual(r.ecoHtUnitaire, 2.38);
});

test('exemple « Colonne 60 » : 72,43 kg → tranche 60-100 → 11,83 € HT', () => {
  const r = eco.ecoPiece({ type: 'Colonne', largeurMm: 600, hauteurMm: 2100, profondeurMm: 560, classeMatiere: PARTICULES });
  assert.ok(Math.abs(r.poidsKg - 72.43236) < 0.01, `poids ${r.poidsKg}`);
  assert.strictEqual(r.tranche, '≥ 60 et < 100 kg');
  assert.strictEqual(r.ecoHtUnitaire, 11.83);
});

test('total des 3 exemples = 17,92 € HT / 21,50 € TTC (comme la feuille)', () => {
  const r = eco.calculer([
    { type: 'Meuble bas',  largeurMm: 600, hauteurMm: 720,  profondeurMm: 560, classeMatiere: PARTICULES },
    { type: 'Meuble haut', largeurMm: 600, hauteurMm: 720,  profondeurMm: 350, classeMatiere: PARTICULES },
    { type: 'Colonne',     largeurMm: 600, hauteurMm: 2100, profondeurMm: 560, classeMatiere: PARTICULES },
  ], { tauxTvaPct: 20 });
  assert.strictEqual(r.totalHt, 17.92);
  assert.strictEqual(r.totalTtc, 21.50);   // 17,92 × 1,20, arrondi au centime (monnaie)
  assert.strictEqual(r.piecesCalculees, 3);
  assert.strictEqual(r.complet, true);
});

test('quantité multiplie le total de la pièce', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES, quantite: 3 });
  assert.strictEqual(r.ecoHtUnitaire, 3.71);
  assert.strictEqual(r.totalHt, 11.13);
});

test('classe matière change le tarif (gestion durable certifiée moins chère)', () => {
  const certifiee = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: 'Panneaux particules ≥75% - gestion durable certifiée' });
  assert.strictEqual(certifiee.ecoHtUnitaire, 1.83);   // tranche 20-30, colonne certifiée
});

test('panneau plat (joue) : poids = L·H·e·densité·coeff, hauteur requise pas profondeur', () => {
  const r = eco.ecoPiece({ type: 'Joue / panneau', largeurMm: 600, hauteurMm: 720, classeMatiere: PARTICULES });
  // 0,6 × 0,72 × 0,018 × 650 × 1 = 5,0544 kg → tranche 5-10
  assert.ok(Math.abs(r.poidsKg - 5.0544) < 0.001, `poids ${r.poidsKg}`);
  assert.strictEqual(r.tranche, '≥ 5 et < 10 kg');
  assert.strictEqual(r.ecoHtUnitaire, 1.11);
});

test('plan de travail : poids = L·P·e(38)·densité, sans coeff, hauteur ignorée', () => {
  const r = eco.ecoPiece({ type: 'Plan de travail', largeurMm: 3000, profondeurMm: 650, classeMatiere: PARTICULES });
  // 3 × 0,65 × 0,038 × 650 = 48,165 kg → tranche 40-60
  assert.ok(Math.abs(r.poidsKg - 48.165) < 0.001, `poids ${r.poidsKg}`);
  assert.strictEqual(r.tranche, '≥ 40 et < 60 kg');
  assert.strictEqual(r.ecoHtUnitaire, 7.25);
});

test('dimension manquante : incalculable, dit ce qui manque (jamais de silence)', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, classeMatiere: PARTICULES }); // pas de profondeur
  assert.strictEqual(r.ecoHtUnitaire, null);
  assert.ok(r.manquants.includes('profondeur'));
});

test('type inconnu : incalculable + manquant « type »', () => {
  const r = eco.ecoPiece({ type: 'Table basse design', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES });
  assert.strictEqual(r.ecoHtUnitaire, null);
  assert.ok(r.manquants.includes('type'));
});

test('poids fournisseur prime sur l\'estimation', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES, poidsKgManuel: 12 });
  assert.strictEqual(r.source, 'poids-fournisseur');
  assert.strictEqual(r.tranche, '≥ 10 et < 20 kg');
  assert.strictEqual(r.ecoHtUnitaire, 2.38);
});

test('tarif fournisseur prime sur tout (code Ecomaison réel)', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES, tarifHtManuel: 4.17, quantite: 2 });
  assert.strictEqual(r.source, 'tarif-fournisseur');
  assert.strictEqual(r.ecoHtUnitaire, 4.17);
  assert.strictEqual(r.totalHt, 8.34);
});

test('classe matière inconnue : avertissement, pas de tarif', () => {
  const r = eco.ecoPiece({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: 'Plastique' });
  assert.strictEqual(r.ecoHtUnitaire, null);
  assert.ok(r.avertissements.some(a => /absente du barème/.test(a)));
});

test('épaisseur / densité surchargeables', () => {
  const base = eco.estimerPoidsKg({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560 });
  const lourd = eco.estimerPoidsKg({ type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, densite: 750 });
  assert.ok(lourd > base, 'densité plus forte → plus lourd');
});

test('tranche : poids très faible → première ligne, poids énorme → dernière', () => {
  assert.strictEqual(eco.trancheParPoids(0.05).label, '< 0,100 kg');
  assert.strictEqual(eco.trancheParPoids(500).label, '> 300 kg');
  assert.strictEqual(eco.trancheParPoids(-1), null);
});

test('calculer : total partiel annoncé comme partiel', () => {
  const r = eco.calculer([
    { type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, profondeurMm: 560, classeMatiere: PARTICULES },
    { type: 'Meuble bas', largeurMm: 600, hauteurMm: 720, classeMatiere: PARTICULES }, // incalculable
  ]);
  assert.strictEqual(r.piecesCalculees, 1);
  assert.strictEqual(r.piecesIncalculables, 1);
  assert.strictEqual(r.complet, false);
  assert.strictEqual(r.totalHt, 3.71);
});
