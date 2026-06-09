/**
 * Tests services/rh-helper.js — node --test natif (ADR-004).
 *
 * Usage : node --test services/rh-helper.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { joursOuvres, boundsMois, joursAbsenceDansMois, recapPaieMois, alertesVisitesMedicales } = require('./rh-helper');

describe('joursOuvres()', () => {
  test('semaine complète lun-ven = 5', () => {
    assert.equal(joursOuvres('2026-06-01', '2026-06-05'), 5);
  });
  test('week-end exclu (lun → dim = 5)', () => {
    assert.equal(joursOuvres('2026-06-01', '2026-06-07'), 5);
  });
  test('un seul jour ouvré = 1, un samedi = 0', () => {
    assert.equal(joursOuvres('2026-06-03', '2026-06-03'), 1);
    assert.equal(joursOuvres('2026-06-06', '2026-06-06'), 0);
  });
  test('bornes inversées ou invalides → 0', () => {
    assert.equal(joursOuvres('2026-06-05', '2026-06-01'), 0);
    assert.equal(joursOuvres(null, '2026-06-01'), 0);
  });
});

describe('boundsMois()', () => {
  test('mois standard et février', () => {
    assert.deepEqual(boundsMois('2026-06'), ['2026-06-01', '2026-06-30']);
    assert.deepEqual(boundsMois('2026-02'), ['2026-02-01', '2026-02-28']);
    assert.deepEqual(boundsMois('2028-02'), ['2028-02-01', '2028-02-29']); // bissextile
  });
  test('format invalide → null', () => {
    assert.equal(boundsMois('2026-13'), null);
    assert.equal(boundsMois('juin'), null);
    assert.equal(boundsMois(null), null);
  });
});

describe('joursAbsenceDansMois()', () => {
  test('absence entièrement dans le mois → jours saisis conservés (demi-journées)', () => {
    const abs = { dateDebut: '2026-06-08', dateFin: '2026-06-10', jours: 2.5 };
    assert.equal(joursAbsenceDansMois(abs, '2026-06'), 2.5);
  });
  test('absence entièrement dans le mois sans jours saisis → calcul jours ouvrés', () => {
    const abs = { dateDebut: '2026-06-08', dateFin: '2026-06-12' };
    assert.equal(joursAbsenceDansMois(abs, '2026-06'), 5);
  });
  test('absence à cheval sur deux mois → seule la part du mois est comptée', () => {
    const abs = { dateDebut: '2026-05-28', dateFin: '2026-06-03', jours: 5 };
    // intersection juin = 01/06 (lun) au 03/06 (mer) = 3 jours ouvrés
    assert.equal(joursAbsenceDansMois(abs, '2026-06'), 3);
  });
  test('absence hors mois → 0', () => {
    const abs = { dateDebut: '2026-07-01', dateFin: '2026-07-05' };
    assert.equal(joursAbsenceDansMois(abs, '2026-06'), 0);
  });
});

describe('recapPaieMois()', () => {
  const salaries = [
    { id: 'recS1', nom: 'Marie Dupont', poste: 'Poseuse', typeContrat: 'CDI', soldeConges: 12.5 },
    { id: 'recS2', nom: 'Jean Martin', poste: 'Conseiller', typeContrat: 'CDI', soldeConges: 8 },
  ];
  const heures = [
    { salarieId: 'recS1', semaine: '2026-06-01', heuresNormales: 35, heuresSupp: 4 },
    { salarieId: 'recS1', semaine: '2026-06-08', heuresNormales: 35, heuresSupp: 0 },
    { salarieId: 'recS1', semaine: '2026-05-25', heuresNormales: 35, heuresSupp: 2 }, // mai → exclu
    { salarieId: 'recS2', semaine: '2026-06-01', heuresNormales: 39, heuresSupp: 0 },
  ];
  const absences = [
    { salarieId: 'recS1', type: 'Congés payés', dateDebut: '2026-06-15', dateFin: '2026-06-19', jours: 5, statut: 'Validée' },
    { salarieId: 'recS1', type: 'Maladie', dateDebut: '2026-06-22', dateFin: '2026-06-23', statut: 'Validée' },
    { salarieId: 'recS2', type: 'Congés payés', dateDebut: '2026-06-08', dateFin: '2026-06-09', jours: 2, statut: 'Demandée' }, // pas validée → exclue
  ];

  test('agrège heures du mois + absences validées par salarié', () => {
    const recap = recapPaieMois({ salaries, heures, absences, mois: '2026-06' });
    const marie = recap.find(r => r.salarieId === 'recS1');
    assert.equal(marie.heuresNormales, 70);
    assert.equal(marie.heuresSupp, 4);
    assert.equal(marie.congesPris, 5);
    assert.equal(marie.maladie, 2);
    assert.equal(marie.soldeConges, 12.5);
    const jean = recap.find(r => r.salarieId === 'recS2');
    assert.equal(jean.heuresNormales, 39);
    assert.equal(jean.congesPris, 0, 'absence non validée ne compte pas');
  });

  test('mois invalide → throw', () => {
    assert.throws(() => recapPaieMois({ salaries, heures, absences, mois: 'juin-2026' }));
  });
});

describe('alertesVisitesMedicales()', () => {
  const today = '2026-06-06';
  test('détecte dépassées et à planifier sous le seuil, triées par urgence', () => {
    const salaries = [
      { id: 'r1', nom: 'A', prochaineVisite: '2026-05-01' },  // dépassée
      { id: 'r2', nom: 'B', prochaineVisite: '2026-07-15' },  // dans 39 j → à planifier
      { id: 'r3', nom: 'C', prochaineVisite: '2027-01-01' },  // loin → pas d'alerte
      { id: 'r4', nom: 'D', prochaineVisite: null },           // pas de date → ignoré
    ];
    const alertes = alertesVisitesMedicales(salaries, today, 60);
    assert.equal(alertes.length, 2);
    assert.equal(alertes[0].nom, 'A');
    assert.equal(alertes[0].statut, 'Dépassée');
    assert.equal(alertes[1].statut, 'À planifier');
  });
});
