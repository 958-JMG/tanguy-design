'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparerLignesWinner, champsWinner, ordonnerLignes, fournisseurWinner, enrichirLignesWinner } = require('./winner-lignes');
const { routeCommandes } = require('./fournisseur-grille');
const { lignesBcStructurees, lignesSansCommande } = require('./commande-bc');
const { modeleDepuisLignes } = require('./commande-bc');
const exemple = require('./fixtures/winner-ordre');
const records = () => preparerLignesWinner(exemple.lignes).map((l, i) => ({ id: `rec${i}`, fields: {
  ...champsWinner(l), Position: l.position, 'Position parent': l.position_parent, 'Catégorie': l.categorie,
  'Code produit': l.code_produit, 'Désignation': l.designation, 'Montant HT': l.montant_ht,
} }));
const fournisseurs = [...new Set(exemple.lignes.map(l => l.fournisseur))].map((Nom, i) => ({ id: `recFO${i}`, fields: { Nom } }));

test('déroulé Winner exact malgré retour Airtable inversé, 503 avant 20 avant 15, accessoires à la fin', () => {
  const lignes = records().reverse();
  const sorted = ordonnerLignes(lignes);
  assert.deepEqual(sorted.map(l => l.fields.Position), exemple.lignes.map(l => l.position));
  assert.equal(lignes[0].fields.Position, '4.2', 'aucune mutation');
  assert.deepEqual(lignesBcStructurees(lignes).map(l => l.pos), exemple.lignes.map(l => l.position));
});

test('ancien import : 2, 2.1, 2.2, 2.10, 10, 503 ; aucun parseFloat des repères', () => {
  const lignes = ['503', '2.10', '2.2', '10', '2.1', '2'].map(Position => ({ fields: { Position } }));
  assert.deepEqual(ordonnerLignes(lignes).map(l => l.fields.Position), ['2', '2.1', '2.2', '2.10', '10', '503']);
});

test('sous-ligne dans une autre section : conserve sa famille, sa place et son fournisseur', () => {
  const lignes = preparerLignesWinner(exemple.lignes);
  assert.equal(lignes.find(l => l.position === '3.1').zone_nom, 'Cuisine test');
  const accessoire = lignes.find(l => l.position === '2.1');
  assert.equal(accessoire.section, 'Accessoires');
  assert.equal(accessoire.fournisseur, 'Accessoires Test');
  assert.equal(accessoire.zone_nom, '');
  assert.equal(lignes.find(l => l.position === '7.3').montant_ht, 0);
});

test('routage : un BC par module et fournisseur, sans perdre ni renuméroter les 40 lignes', () => {
  const groupes = routeCommandes(records().reverse(), fournisseurs, { forcer: ['Plan de travail & crédence'] });
  assert.deepEqual(groupes.map(g => g.type), ['Mobilier', 'Plan de travail', 'Panneaux de recouvrement', 'Électroménager', 'Sanitaire', 'Accessoires']);
  assert.equal(groupes.flatMap(g => g.lignes).length, 40);
  assert.ok(groupes.every(g => g.fournisseurId));
  assert.deepEqual(groupes.at(-1).lignes.map(l => l.fields.Position), ['2.1', '4.2']);
  assert.equal(groupes.reduce((s, g) => s + g.montant, 0), 3900);
});

test('même famille, fournisseurs distincts : jamais une commande mélangée', () => {
  const lignes = records().slice(0, 2);
  lignes[1].fields['Fournisseur Winner'] = 'Autre Atelier';
  const groupes = routeCommandes(lignes, [...fournisseurs, { id: 'recAUTRE', fields: { Nom: 'Autre Atelier' } }]);
  assert.equal(groupes.length, 2);
  assert.notEqual(groupes[0].fournisseurId, groupes[1].fournisseurId);
});

test('un accessoire intégré dans la section Meubles reste dans le module du meuble', () => {
  const l = records()[0];
  l.fields['Catégorie'] = 'Accessoires';
  const [g] = routeCommandes([l], fournisseurs);
  assert.equal(g.canon, 'Mobilier');
  assert.equal(g.type, 'Mobilier');
});

test('nom absent ou ambigu : ne remplace jamais un fournisseur explicite par celui de la grille', () => {
  const l = records()[0];
  l.fields['Fournisseur Winner'] = 'Inconnu';
  const grille = [{ id: 'recHASARD', fields: { Nom: 'Un autre', 'Catégories': ['Mobilier'] } }];
  const [g] = routeCommandes([l], grille);
  assert.equal(g.fournisseurId, undefined);
  assert.match(g.raison, /Inconnu.*introuvable/);
  const result = fournisseurWinner(l, [{ id: 'a', fields: { Nom: 'Inconnu' } }, { id: 'b', fields: { Nom: 'INCONNU' } }]);
  assert.equal(result.id, null);
  assert.match(result.raison, /ambigu/);
});

test('marque seule : visible, ne choisit pas le distributeur et sépare les marques', () => {
  const lignes = records().slice(0, 2);
  for (const l of lignes) l.fields['Fournisseur Winner'] = '';
  lignes[1].fields['Marque Winner'] = 'Autre marque';
  const groupes = routeCommandes(lignes, [{ id: 'recHASARD', fields: { Nom: 'Catalogue Test', 'Catégories': ['Mobilier'] } }]);
  assert.equal(groupes.length, 2);
  assert.ok(groupes.every(g => !g.fournisseurId));
  assert.equal(enrichirLignesWinner(lignes)[0].marqueNom, 'Catalogue Test');
});

test('identité : deux sections peuvent porter le même repère et le même code', () => {
  const lignes = records().slice(0, 2);
  lignes[1].fields.Position = lignes[0].fields.Position;
  lignes[1].fields['Code produit'] = lignes[0].fields['Code produit'];
  const bc = JSON.stringify(lignesBcStructurees([lignes[0]]));
  assert.deepEqual(lignesSansCommande(lignes, [bc]).lignes.map(l => l.id), [lignes[1].id]);
});

test('modèle : celui des lignes de la commande, jamais la première zone d’un autre fournisseur', () => {
  const zones = [{ id: 'za', fields: { Marque: 'A', Modèle: 'Alpha' } }, { id: 'zb', fields: { Marque: 'B', Modèle: 'Beta' } }];
  const ligne = { fields: { Zone: ['zb'], 'Marque Winner': 'B' } };
  assert.equal(modeleDepuisLignes([ligne], zones).modeleHeader, 'B — Beta');
  assert.equal(modeleDepuisLignes([{ fields: { Zone: ['za', 'zb'] } }], zones), null);
  assert.equal(modeleDepuisLignes([{ fields: { 'Marque Winner': 'Autre' } }], zones.slice(0, 1)), null);
});
