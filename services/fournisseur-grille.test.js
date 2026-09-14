/**
 * Tests services/fournisseur-grille.js — node --test natif (ADR-004).
 *
 * Enjeu : à la signature, PLUS AUCUNE ligne ne doit disparaître en silence, et
 * aucun rattachement fournisseur ne doit se faire au hasard. Ces deux garanties
 * sont invisibles à l'œil (une ligne manquante sur un BC ne « plante » pas) :
 * seuls des tests les tiennent.
 *
 * Grille refondue le 2026-09-14 (JMG) : 4 familles — Mobilier, Électroménager,
 * Luminaire, « Plan de travail & crédence » (= plan de travail + évier +
 * robinetterie + crédence).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifierCategorie, routeCommandes, indexFournisseurs, CATEGORIES_GRILLE } = require('./fournisseur-grille');

const PTC = 'Plan de travail & crédence';
const GRILLE = [
  { id: 'fMod', fields: { Nom: 'Modulnova', 'Catégories': ['Mobilier'] } },
  { id: 'fFid', fields: { Nom: 'Fidelem', 'Catégories': [PTC] } },
  { id: 'fFin', fields: { Nom: 'Findis', 'Catégories': ['Électroménager'] } },
  { id: 'fBra', fields: { Nom: 'Bradano', 'Catégories': [PTC] } },
  { id: 'fFra', fields: { Nom: 'Franke', 'Catégories': [PTC] } },
  { id: 'fGoo', fields: { Nom: 'Goode Glass', 'Catégories': [PTC] } },
  { id: 'fArt', fields: { Nom: 'Artemide', 'Catégories': ['Luminaire'] } },
];
const ligne = (cat, montant = 100) => ({ fields: { 'Catégorie': cat, 'Montant HT': montant } });

describe('classifierCategorie — vocabulaire réel Winner → 4 familles', () => {
  const cas = [
    ['Meubles', 'Mobilier'],
    ['Panneaux de recouvrement', 'Mobilier'],
    ['Mobilier', 'Mobilier'],
    ['Plan de travail', PTC],
    ['Plans de travail', PTC],
    ['Eviers et robinetterie', PTC],
    ['Robinetterie', PTC],
    ['Sanitaires', PTC],
    ['Crédence', PTC],
    ['Crédence et pied vert', PTC],
    ['Electroménager', 'Électroménager'],
    ['Luminaires', 'Luminaire'],
    ['Éclairage / spots', 'Luminaire'],
  ];
  for (const [raw, canon] of cas) {
    test(`« ${raw} » → ${canon}`, () => {
      const r = classifierCategorie(raw);
      assert.equal(r.canon, canon);
      assert.equal(r.grille, true);
      assert.equal(r.commande, true);
    });
  }

  test('Produits de vente → Accessoires (commande, hors grille)', () => {
    const r = classifierCategorie('Produits de vente');
    assert.equal(r.canon, 'Accessoires');
    assert.equal(r.commande, true);
    assert.equal(r.grille, false);
  });

  test('Dépose et Divers → pas de commande, mais catégorie reconnue (jamais tue)', () => {
    for (const c of ['Dépose', 'Divers']) {
      const r = classifierCategorie(c);
      assert.equal(r.commande, false);
      assert.ok(r.raison);
    }
  });

  test('catégorie inconnue → canon null + raison (JAMAIS un rattachement inventé)', () => {
    const r = classifierCategorie('Zellige marocain');
    assert.equal(r.canon, null);
    assert.equal(r.commande, true);
    assert.match(r.raison, /non reconnue/);
  });

  test('catégorie absente → canon null + raison', () => {
    const r = classifierCategorie('');
    assert.equal(r.canon, null);
    assert.match(r.raison, /absente/);
  });
});

describe('routeCommandes — aucune ligne jetée, aucun rattachement au hasard', () => {
  test('rattachement certain quand un seul fournisseur couvre la famille', () => {
    const groupes = routeCommandes([ligne('Meubles', 5000)], GRILLE);
    const mob = groupes.find(g => g.canon === 'Mobilier');
    assert.equal(mob.fournisseurId, 'fMod');
    assert.equal(mob.fournisseurNom, 'Modulnova');
    assert.equal(mob.type, 'Mobilier');
  });

  test('« Plan de travail & crédence » regroupe plan de travail, évier, robinetterie, crédence', () => {
    const lignes = [ligne('Plan de travail', 800), ligne('Eviers et robinetterie', 900), ligne('Crédence', 700)];
    const groupes = routeCommandes(lignes, GRILLE);
    const ptc = groupes.filter(g => g.canon === PTC);
    assert.equal(ptc.length, 1, 'les 4 sous-familles tombent dans une seule commande');
    assert.equal(ptc[0].lignes.length, 3);
    assert.equal(ptc[0].montant, 2400);
    // Fidelem, Bradano, Franke, Goode Glass couvrent PTC → 4 candidats, pas de choix auto.
    assert.equal(ptc[0].fournisseurId, undefined);
    assert.match(ptc[0].raison, /à choisir/);
  });

  test('Luminaire : rattachement certain (Artemide seul)', () => {
    const groupes = routeCommandes([ligne('Luminaires', 300)], GRILLE);
    const lum = groupes.find(g => g.canon === 'Luminaire');
    assert.equal(lum.fournisseurId, 'fArt');
  });

  test('catégorie INCONNUE → groupe « À classer » avec lignes préservées (jamais perdues)', () => {
    const lignes = [ligne('Meubles', 5000), ligne('Zellige marocain', 450), ligne('Zellige marocain', 50)];
    const groupes = routeCommandes(lignes, GRILLE);
    const aClasser = groupes.find(g => g.aClasser);
    assert.ok(aClasser);
    assert.equal(aClasser.type, 'À classer');
    assert.equal(aClasser.lignes.length, 2);
    assert.equal(aClasser.montant, 500);
    const totalRoute = groupes.reduce((s, g) => s + g.lignes.length, 0);
    assert.equal(totalRoute, lignes.length);
  });

  test('famille connue SANS fournisseur en grille → commande créée + raison (pas de silence)', () => {
    const grilleSansLum = GRILLE.filter(f => f.id !== 'fArt');
    const groupes = routeCommandes([ligne('Luminaires', 700)], grilleSansLum);
    const g = groupes.find(x => x.canon === 'Luminaire');
    assert.equal(g.commande, true);
    assert.equal(g.fournisseurId, undefined);
    assert.match(g.raison, /Aucun fournisseur/);
  });

  test('Dépose/Divers → présents dans le résultat (commande:false), donc reportés', () => {
    const groupes = routeCommandes([ligne('Dépose', 0), ligne('Divers', 120)], GRILLE);
    assert.ok(groupes.find(g => g.canon === 'Dépose' && g.commande === false));
    assert.ok(groupes.find(g => g.canon === 'Divers' && g.commande === false));
  });

  test('opts.forcer : le BC « Plan de travail & crédence » existe même sans ligne', () => {
    const groupes = routeCommandes([ligne('Meubles', 5000)], GRILLE, { forcer: [PTC] });
    const g = groupes.find(x => x.canon === PTC);
    assert.ok(g);
    assert.equal(g.lignes.length, 0);
    assert.equal(g.montant, 0);
  });

  test('indexFournisseurs : PTC couvert par 4 fournisseurs', () => {
    const idx = indexFournisseurs(GRILLE);
    assert.equal(idx.get('plan de travail credence').length, 4);
    assert.equal(idx.get('mobilier').length, 1);
    assert.equal(idx.get('luminaire').length, 1);
  });

  test('les 4 familles de la grille sont bien exposées', () => {
    assert.deepEqual(CATEGORIES_GRILLE, ['Mobilier', 'Électroménager', 'Luminaire', 'Plan de travail & crédence']);
  });
});
