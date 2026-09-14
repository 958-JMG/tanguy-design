/**
 * Tests services/fournisseur-grille.js — node --test natif (ADR-004).
 *
 * Enjeu : à la signature, PLUS AUCUNE ligne ne doit disparaître en silence, et
 * aucun rattachement fournisseur ne doit se faire au hasard. Ces deux garanties
 * sont invisibles à l'œil (une ligne manquante sur un BC ne « plante » pas) :
 * seuls des tests les tiennent.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifierCategorie, routeCommandes, indexFournisseurs, CATEGORIES_GRILLE } = require('./fournisseur-grille');

// Grille de test calquée sur la vraie (extrait) : Bradano/Franke couvrent Évier
// ET Robinetterie ; Gessi robinetterie seule ; Findis électro seule.
const GRILLE = [
  { id: 'fMod', fields: { Nom: 'Modulnova', 'Catégories': ['Meuble'] } },
  { id: 'fFid', fields: { Nom: 'Fidelem', 'Catégories': ['Plan de travail'] } },
  { id: 'fFin', fields: { Nom: 'Findis', 'Catégories': ['Électroménager'] } },
  { id: 'fBra', fields: { Nom: 'Bradano', 'Catégories': ['Évier', 'Robinetterie'] } },
  { id: 'fFra', fields: { Nom: 'Franke', 'Catégories': ['Évier', 'Robinetterie'] } },
  { id: 'fGes', fields: { Nom: 'Gessi', 'Catégories': ['Robinetterie'] } },
  { id: 'fGoo', fields: { Nom: 'Goode Glass', 'Catégories': ['Crédence'] } },
];
const ligne = (cat, montant = 100) => ({ fields: { 'Catégorie': cat, 'Montant HT': montant } });

describe('classifierCategorie — vocabulaire réel Winner', () => {
  const cas = [
    ['Meubles', 'Meuble', true],
    ['Panneaux de recouvrement', 'Meuble', true],
    ['Plan de travail', 'Plan de travail', true],
    ['Plans de travail', 'Plan de travail', true],
    ['Electroménager', 'Électroménager', true],
    ['Eviers et robinetterie', 'Évier', true],   // combiné → Évier
    ['Robinetterie', 'Robinetterie', true],
    ['Sanitaires', 'Évier', true],
    ['Crédence', 'Crédence', true],
    ['Crédence et pied vert', 'Crédence', true],
  ];
  for (const [raw, canon, grille] of cas) {
    test(`« ${raw} » → ${canon}`, () => {
      const r = classifierCategorie(raw);
      assert.equal(r.canon, canon);
      assert.equal(r.grille, grille);
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
      assert.ok(r.raison, 'une raison explicite est fournie');
    }
  });

  test('catégorie inconnue → canon null + raison (JAMAIS un rattachement inventé)', () => {
    const r = classifierCategorie('Zellige marocain');
    assert.equal(r.canon, null);
    assert.equal(r.commande, true);   // on crée quand même une commande « À classer »
    assert.match(r.raison, /non reconnue/);
  });

  test('catégorie absente → canon null + raison', () => {
    const r = classifierCategorie('');
    assert.equal(r.canon, null);
    assert.match(r.raison, /absente/);
  });
});

describe('routeCommandes — aucune ligne jetée, aucun rattachement au hasard', () => {
  test('rattachement certain quand un seul fournisseur couvre la catégorie', () => {
    const groupes = routeCommandes([ligne('Meubles', 5000), ligne('Plan de travail', 800)], GRILLE);
    const meuble = groupes.find(g => g.canon === 'Meuble');
    assert.equal(meuble.fournisseurId, 'fMod');
    assert.equal(meuble.fournisseurNom, 'Modulnova');
    assert.equal(meuble.type, 'Meubles');
    const pt = groupes.find(g => g.canon === 'Plan de travail');
    assert.equal(pt.fournisseurId, 'fFid');
  });

  test('ambiguïté (Évier : Bradano + Franke) → pas de rattachement, candidats listés', () => {
    const groupes = routeCommandes([ligne('Eviers et robinetterie', 900)], GRILLE);
    const g = groupes.find(x => x.canon === 'Évier');
    assert.equal(g.fournisseurId, undefined, 'on ne tranche pas au hasard');
    assert.equal(g.candidats.length, 2);
    assert.match(g.raison, /à choisir/);
  });

  test('robinetterie seule → Gessi rattaché (Bradano/Franke aussi candidats… donc 3 → à choisir)', () => {
    const groupes = routeCommandes([ligne('Robinetterie', 300)], GRILLE);
    const g = groupes.find(x => x.canon === 'Robinetterie');
    // Bradano, Franke ET Gessi couvrent Robinetterie → 3 candidats, pas de choix auto.
    assert.equal(g.candidats.length, 3);
    assert.equal(g.fournisseurId, undefined);
  });

  test('catégorie INCONNUE → groupe « À classer » avec les lignes préservées (jamais perdues)', () => {
    const lignes = [ligne('Meubles', 5000), ligne('Zellige marocain', 450), ligne('Zellige marocain', 50)];
    const groupes = routeCommandes(lignes, GRILLE);
    const aClasser = groupes.find(g => g.aClasser);
    assert.ok(aClasser, 'un groupe À classer existe');
    assert.equal(aClasser.type, 'À classer');
    assert.equal(aClasser.lignes.length, 2, 'les 2 lignes inconnues sont conservées');
    assert.equal(aClasser.montant, 500);
    assert.match(aClasser.raison, /non reconnue/);
    // Invariant fort : la somme des lignes routées = la somme des lignes entrées.
    const totalRoute = groupes.reduce((s, g) => s + g.lignes.length, 0);
    assert.equal(totalRoute, lignes.length);
  });

  test('catégorie connue SANS fournisseur en grille → commande créée + raison (pas de silence)', () => {
    const grilleSansCredence = GRILLE.filter(f => f.id !== 'fGoo');
    const groupes = routeCommandes([ligne('Crédence', 700)], grilleSansCredence);
    const g = groupes.find(x => x.canon === 'Crédence');
    assert.equal(g.commande, true);
    assert.equal(g.fournisseurId, undefined);
    assert.match(g.raison, /Aucun fournisseur/);
  });

  test('Dépose/Divers → présents dans le résultat (commande:false), donc reportés', () => {
    const groupes = routeCommandes([ligne('Dépose', 0), ligne('Divers', 120)], GRILLE);
    assert.ok(groupes.find(g => g.canon === 'Dépose' && g.commande === false));
    assert.ok(groupes.find(g => g.canon === 'Divers' && g.commande === false));
  });

  test('montants agrégés et arrondis par groupe', () => {
    const groupes = routeCommandes([ligne('Meubles', 100.1), ligne('Meubles', 200.2)], GRILLE);
    assert.equal(groupes.find(g => g.canon === 'Meuble').montant, 300.3);
  });

  test('indexFournisseurs : un fournisseur multi-catégories est indexé partout', () => {
    const idx = indexFournisseurs(GRILLE);
    assert.equal(idx.get('evier').length, 2);        // Bradano + Franke
    assert.equal(idx.get('robinetterie').length, 3); // + Gessi
    assert.equal(idx.get('meuble').length, 1);
  });

  test('opts.forcer : le BC « Plan de travail » existe même sans ligne PT, fournisseur résolu', () => {
    const groupes = routeCommandes([ligne('Meubles', 5000)], GRILLE, { forcer: ['Plan de travail'] });
    const pt = groupes.find(g => g.canon === 'Plan de travail');
    assert.ok(pt, 'le groupe PT est présent');
    assert.equal(pt.lignes.length, 0);
    assert.equal(pt.montant, 0);
    assert.equal(pt.fournisseurId, 'fFid');  // Fidelem, seul PT de la grille
  });

  test('opts.forcer n\'ajoute pas de doublon quand des lignes PT existent', () => {
    const groupes = routeCommandes([ligne('Plan de travail', 800), ligne('Plan de travail', 200)], GRILLE, { forcer: ['Plan de travail'] });
    const pts = groupes.filter(g => g.canon === 'Plan de travail');
    assert.equal(pts.length, 1);
    assert.equal(pts[0].montant, 1000);
  });

  test('les 6 catégories de la grille sont bien exposées', () => {
    assert.deepEqual(CATEGORIES_GRILLE, ['Meuble', 'Plan de travail', 'Électroménager', 'Évier', 'Robinetterie', 'Crédence']);
  });
});
