/**
 * Tests services/eco-contribution-bareme.js — node --test natif (ADR-004).
 *
 * Les 36 cellules de la grille sont vérifiées une à une : une valeur mal
 * recopiée depuis le PDF ne se voit PAS à l'usage (0,29 € au lieu de 0,40 €
 * passe inaperçu sur une ligne, fausse la déclaration sur l'année).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  MATERIAUX, trancheLongueur, trancheIndeterminee, cleHauteur,
  tarifUnitaireTtc, ttcVersHt, calculerEcoContribution,
} = require('./eco-contribution-bareme');

const { BOIS_MASSIF, PANNEAUX_PARTICULES, BIOSOURCES } = MATERIAUX;

describe('trancheLongueur()', () => {
  test('bornes des trois tranches', () => {
    assert.equal(trancheLongueur(1), '0 à 600 mm');
    assert.equal(trancheLongueur(600), '0 à 600 mm');
    assert.equal(trancheLongueur(610), '610 à 1200 mm');
    assert.equal(trancheLongueur(1200), '610 à 1200 mm');
    assert.equal(trancheLongueur(1201), '> 1200 mm');
    assert.equal(trancheLongueur(2400), '> 1200 mm');
  });

  test('longueur absente ou absurde → null (jamais de tranche devinée)', () => {
    assert.equal(trancheLongueur(undefined), null);
    assert.equal(trancheLongueur(0), null);
    assert.equal(trancheLongueur(-5), null);
    assert.equal(trancheLongueur('abc'), null);
  });

  test('trou 601-609 mm laissé par la grille → signalé, tranche supérieure', () => {
    assert.equal(trancheIndeterminee(605), true);
    assert.equal(trancheLongueur(605), '610 à 1200 mm');
    assert.equal(trancheIndeterminee(600), false);
    assert.equal(trancheIndeterminee(610), false);
  });
});

describe('cleHauteur()', () => {
  test('seuil à 250 mm — 250 bascule côté « ≥ »', () => {
    assert.equal(cleHauteur(249), 'h<250');
    assert.equal(cleHauteur(250), 'h>=250');
    assert.equal(cleHauteur(251), 'h>=250');
  });

  test('hauteur absente → null (elle double presque le tarif, on ne la suppose pas)', () => {
    assert.equal(cleHauteur(undefined), null);
    assert.equal(cleHauteur(0), null);
  });
});

describe('grille complète — les 36 cellules', () => {
  // [matériau, longueur, hauteur, certifiée, tarif TTC attendu]
  const CELLULES = [
    // BOIS MASSIF ≥ 75%
    [BOIS_MASSIF, 500, 200, false, 0.19], [BOIS_MASSIF, 500, 200, true, 0.06],
    [BOIS_MASSIF, 500, 300, false, 0.41], [BOIS_MASSIF, 500, 300, true, 0.11],
    [BOIS_MASSIF, 900, 200, false, 0.35], [BOIS_MASSIF, 900, 200, true, 0.11],
    [BOIS_MASSIF, 900, 300, false, 0.70], [BOIS_MASSIF, 900, 300, true, 0.29],
    [BOIS_MASSIF, 1500, 200, false, 0.40], [BOIS_MASSIF, 1500, 200, true, 0.29],
    [BOIS_MASSIF, 1500, 300, false, 0.96], [BOIS_MASSIF, 1500, 300, true, 0.29],
    // PANNEAUX DE PARTICULES ≥ 75%
    [PANNEAUX_PARTICULES, 500, 200, false, 0.19], [PANNEAUX_PARTICULES, 500, 200, true, 0.06],
    [PANNEAUX_PARTICULES, 500, 300, false, 0.41], [PANNEAUX_PARTICULES, 500, 300, true, 0.11],
    [PANNEAUX_PARTICULES, 900, 200, false, 0.35], [PANNEAUX_PARTICULES, 900, 200, true, 0.11],
    [PANNEAUX_PARTICULES, 900, 300, false, 0.70], [PANNEAUX_PARTICULES, 900, 300, true, 0.29],
    [PANNEAUX_PARTICULES, 1500, 200, false, 0.64], [PANNEAUX_PARTICULES, 1500, 200, true, 0.29],
    [PANNEAUX_PARTICULES, 1500, 300, false, 0.96], [PANNEAUX_PARTICULES, 1500, 300, true, 0.40],
    // BOIS CERTIFIÉS / BIOSOURCÉS ≥ 50%
    [BIOSOURCES, 500, 200, false, 0.22], [BIOSOURCES, 500, 200, true, 0.08],
    [BIOSOURCES, 500, 300, false, 0.47], [BIOSOURCES, 500, 300, true, 0.17],
    [BIOSOURCES, 900, 200, false, 0.41], [BIOSOURCES, 900, 200, true, 0.17],
    [BIOSOURCES, 900, 300, false, 0.82], [BIOSOURCES, 900, 300, true, 0.41],
    [BIOSOURCES, 1500, 200, false, 0.76], [BIOSOURCES, 1500, 200, true, 0.41],
    [BIOSOURCES, 1500, 300, false, 1.08], [BIOSOURCES, 1500, 300, true, 0.48],
  ];

  for (const [materiau, longueurMm, hauteurMm, certifiee, attendu] of CELLULES) {
    test(`${materiau} · L=${longueurMm} · h=${hauteurMm} · ${certifiee ? 'certifiée' : 'sans gestion durable'} → ${attendu} € TTC`, () => {
      const r = tarifUnitaireTtc({ longueurMm, hauteurMm, materiau, gestionDurableCertifiee: certifiee });
      assert.equal(r.tarifTtc, attendu);
    });
  }

  test('massif et particules divergent au-delà de 1200 mm (piège de recopie)', () => {
    const massif = tarifUnitaireTtc({ longueurMm: 1500, hauteurMm: 200, materiau: BOIS_MASSIF, gestionDurableCertifiee: false });
    const particules = tarifUnitaireTtc({ longueurMm: 1500, hauteurMm: 200, materiau: PANNEAUX_PARTICULES, gestionDurableCertifiee: false });
    assert.equal(massif.tarifTtc, 0.40);
    assert.equal(particules.tarifTtc, 0.64);
    assert.notEqual(massif.tarifTtc, particules.tarifTtc);
  });
});

describe('tarifUnitaireTtc() — défauts et données manquantes', () => {
  test('défaut Tanguy : panneaux de particules, gestion durable certifiée', () => {
    const r = tarifUnitaireTtc({ longueurMm: 900, hauteurMm: 300 });
    assert.equal(r.materiau, PANNEAUX_PARTICULES);
    assert.equal(r.gestionDurable, 'certifiee');
    assert.equal(r.tarifTtc, 0.29);
  });

  test('longueur manquante → pas de tarif, « longueur » listé dans manquants', () => {
    const r = tarifUnitaireTtc({ hauteurMm: 300 });
    assert.equal(r.tarifTtc, null);
    assert.deepEqual(r.manquants, ['longueur']);
  });

  test('hauteur manquante → pas de tarif (elle change presque du simple au double)', () => {
    const r = tarifUnitaireTtc({ longueurMm: 900 });
    assert.equal(r.tarifTtc, null);
    assert.deepEqual(r.manquants, ['hauteur']);
  });

  test('les deux manquantes → les deux signalées', () => {
    assert.deepEqual(tarifUnitaireTtc({}).manquants, ['longueur', 'hauteur']);
  });

  test('matériau hors barème → refus explicite, pas de repli silencieux', () => {
    const r = tarifUnitaireTtc({ longueurMm: 900, hauteurMm: 300, materiau: 'Aluminium' });
    assert.equal(r.tarifTtc, null);
    assert.match(r.avertissements[0], /Aluminium/);
  });

  test('longueur dans le trou 601-609 → tarif rendu MAIS avertissement joint', () => {
    const r = tarifUnitaireTtc({ longueurMm: 605, hauteurMm: 300 });
    assert.equal(r.tarifTtc, 0.29);
    assert.equal(r.avertissements.length, 1);
    assert.match(r.avertissements[0], /601-609/);
  });
});

describe('ttcVersHt()', () => {
  test('conversion aux taux courants', () => {
    assert.equal(ttcVersHt(1.20, 20), 1);
    assert.equal(ttcVersHt(1.10, 10), 1);
    assert.equal(ttcVersHt(2.40, 20), 2);
  });

  test('taux absent → null (jamais de taux supposé en douce)', () => {
    assert.equal(ttcVersHt(1.20, null), null);
    assert.equal(ttcVersHt(1.20, undefined), null);
  });

  test('taux 0 → montant inchangé', () => {
    assert.equal(ttcVersHt(1.20, 0), 1.20);
  });
});

describe('calculerEcoContribution()', () => {
  const pieces = [
    { designation: 'Tablette chêne 1800×300', quantite: 4, longueurMm: 1800, hauteurMm: 300 },
    { designation: 'Tablette 900×200', quantite: 2, longueurMm: 900, hauteurMm: 200 },
  ];

  test('somme les pièces au tarif de la grille (défauts Tanguy)', () => {
    const r = calculerEcoContribution(pieces);
    // 4 × 0,40 (particules >1200 h≥250 certifiée) + 2 × 0,11 = 1,60 + 0,22
    assert.equal(r.totalTtc, 1.82);
    assert.equal(r.piecesCalculees, 2);
    assert.equal(r.complet, true);
  });

  test('quantité absente → 1 pièce', () => {
    const r = calculerEcoContribution([{ longueurMm: 900, hauteurMm: 200 }]);
    assert.equal(r.lignes[0].quantite, 1);
    assert.equal(r.totalTtc, 0.11);
  });

  test('total HT seulement si le taux de TVA est fourni', () => {
    assert.equal(calculerEcoContribution(pieces).totalHt, null);
    assert.equal(calculerEcoContribution(pieces, { tauxTvaPct: 20 }).totalHt, 1.52);
  });

  test('pièce sans dimensions → total PARTIEL annoncé comme tel', () => {
    const r = calculerEcoContribution([...pieces, { designation: 'Panneau sur mesure', quantite: 1 }]);
    assert.equal(r.piecesIncalculables, 1);
    assert.equal(r.complet, false);
    assert.equal(r.totalTtc, 1.82); // la pièce inconnue ne gonfle ni ne fausse le total
    assert.deepEqual(r.lignes[2].manquants, ['longueur', 'hauteur']);
    assert.equal(r.lignes[2].source, 'incalculable');
  });

  test('correction manuelle : prend le pas sur la grille et se trace', () => {
    const r = calculerEcoContribution([
      { designation: 'Tablette', quantite: 3, longueurMm: 900, hauteurMm: 200, tarifTtcManuel: 0.25 },
    ]);
    assert.equal(r.lignes[0].tarifUnitaireTtc, 0.25);
    assert.equal(r.lignes[0].totalTtc, 0.75);
    assert.equal(r.lignes[0].source, 'manuel');
  });

  test('correction manuelle sur une pièce SANS dimensions → redevient calculable', () => {
    const r = calculerEcoContribution([{ designation: 'Sur mesure', quantite: 2, tarifTtcManuel: 0.5 }]);
    assert.equal(r.totalTtc, 1);
    assert.equal(r.complet, true);
    assert.equal(r.piecesIncalculables, 0);
  });

  test('liste vide → total 0 et complet:false (rien à déclarer ≠ calcul fait)', () => {
    const r = calculerEcoContribution([]);
    assert.equal(r.totalTtc, 0);
    assert.equal(r.complet, false);
  });

  test('les avertissements des lignes remontent au niveau du total', () => {
    const r = calculerEcoContribution([{ longueurMm: 605, hauteurMm: 300, quantite: 1 }]);
    assert.equal(r.avertissements.length, 1);
    assert.match(r.avertissements[0], /601-609/);
  });
});
