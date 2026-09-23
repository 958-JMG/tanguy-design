/**
 * Tests services/description-devis-helper.js — node --test natif (ADR-004).
 * Le descriptif alimente à la fois le bon de commande et la description des
 * lignes de facture Pennylane : les deux doivent raconter la même chose.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { zonePrincipale, titreZone, detailsZone, descriptionDevis, descriptionCourte, lignesDevisTexte } = require('./description-devis-helper');

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

  test('toutesZones : multi-zones → tous les ensembles signés apparaissent', () => {
    const zones = [
      { id: 'a', fields: { Ordre: 1, 'Nom zone': 'CUISINE', Marque: 'Modulnova', 'Modèle': 'MH6', 'Exécution façade': 'Miltech', 'Coloris façade': 'C90', 'Type de gorge': 'gorge' } },
      { id: 'b', fields: { Ordre: 2, 'Nom zone': 'LIVING', 'Exécution façade': 'Miltech', 'Coloris façade': 'D60 Bronze' } },
      { id: 'c', fields: { Ordre: 3, 'Nom zone': 'VITRINES', 'Coloris façade': 'DRF' } },
    ];
    const d = descriptionDevis(zones, { toutesZones: true });
    assert.match(d.texte, /Ensembles \(3\)/);
    assert.match(d.texte, /CUISINE : Miltech C90/);
    assert.match(d.texte, /LIVING : Miltech D60 Bronze/);
    assert.match(d.texte, /VITRINES : DRF/);
    assert.match(d.texte, /Type de gorge : gorge/);   // détails techniques de la zone principale conservés
  });

  test('toutesZones : mono-zone → identique au comportement d\'origine', () => {
    const sans = descriptionDevis(ZONES).texte;
    const avec = descriptionDevis([ZONES[1]], { toutesZones: true }).texte;
    assert.equal(avec, sans);   // une seule zone → pas de bloc « Ensembles »
    assert.doesNotMatch(avec, /Ensembles/);
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

describe('lignesDevisTexte() — liste d\'articles propre pour la description Pennylane', () => {
  const ZONES = [
    { id: 'z1', fields: { Ordre: 1, 'Nom zone': 'ZONE 1', Marque: 'LAGO' } },
    { id: 'z2', fields: { Ordre: 2, 'Nom zone': 'Cellier' } },
  ];
  const LIGNES = [
    { id: 'l3', fields: { Position: '10', 'Code produit': 'C1', Désignation: 'CAISSON BAS 60', Quantité: 2, Zone: ['z1'] } },
    { id: 'l1', fields: { Position: '2',  'Code produit': 'P1', Désignation: 'PLAN DE TRAVAIL', Quantité: 1, Zone: ['z1'] } },
    { id: 'l2', fields: { Position: '5',  Désignation: 'Étagère', Zone: ['z2'] } },
    { id: 'l4', fields: { Position: '9',  'Code produit': 'X9', Désignation: 'DIVERS' } }, // hors zone
  ];

  test('groupe par zone, trie par Position, titres en casse phrase, hors-zone en dernier', () => {
    const { texte, total, tronque } = lignesDevisTexte(LIGNES, ZONES);
    assert.equal(total, 4);
    assert.equal(tronque, false);
    assert.deepEqual(texte.split('\n'), [
      'Zone 1',
      '• P1 Plan de travail',        // Position 2 avant 10, casse phrase, qté 1 → pas de ×
      '• C1 Caisson bas 60 ×2',      // qté > 1 → ×2
      '',                            // ligne vide entre zones
      'Cellier',
      '• Étagère',                   // sans code
      '',
      'Hors ensemble',
      '• X9 Divers',
    ]);
  });

  test('nettoie la désignation Winner : marque seule + FINITION/FITTING jetées, code non répété, cotes compactées', () => {
    const ligne = [{ Position: '1', 'Code produit': 'GA3610', Quantité: 1, Zone: ['z1'],
      Désignation: 'LAGO\nGA3610 COLONNE NOW BATTANTE ASYMÉTRIQUE 1125 x 2270 x 610\nFINITION DOS MÉLAMINÉ MANDORLA\nFITTING TROUS PERÇAGE CONTINU ENTRAXE 96' }];
    const { texte } = lignesDevisTexte(ligne, ZONES);
    assert.equal(texte.split('\n')[1], '• GA3610 Colonne now battante asymétrique 1125×2270×610');
  });

  test('tronque proprement et ANNONCE le reste (jamais de coupe muette)', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, fields: { Position: String(i), Désignation: 'Article ' + i, Zone: ['z1'] } }));
    const { texte, tronque, inclus, total } = lignesDevisTexte(many, ZONES, { max: 120 });
    assert.equal(total, 40);
    assert.equal(tronque, true);
    assert.ok(inclus < total);
    assert.match(texte, new RegExp(`\\+${total - inclus} articles`));
    assert.ok(texte.length <= 200);
  });

  test('aucune ligne → vide', () => {
    assert.equal(lignesDevisTexte([], ZONES).vide, true);
  });

  test('accepte des fields nus (sans wrapper .fields)', () => {
    const { texte } = lignesDevisTexte(
      [{ Position: '1', Désignation: 'Direct', Zone: ['z1'] }], ZONES);
    assert.match(texte, /Zone 1\n• Direct/);
  });
});
