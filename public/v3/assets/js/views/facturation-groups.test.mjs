// Test de buildFacturationGroups — le regroupement de la facturation par devis
// signé. Le bug d'origine (RAULT « Compléments », 2026-09-18) : les acomptes d'un
// devis ADDITIF signé ne s'affichaient pas car la fiche ne gardait qu'UN devis
// signé. Ces tests prouvent que chaque devis signé retrouve SES échéances.
//
//   node --test public/v3/assets/js/views/facturation-groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacturationGroups } from './facturation-groups.js';

const devis = (id, statut, type, echIds) => ({
  id,
  fields: { Statut: statut, 'Type devis': type, 'Échéances devis': echIds },
});
const ech = (id, ordre) => ({ id, fields: { Ordre: ordre } });

test('Principal + Additif signés : chaque devis retrouve SES acomptes (le bug RAULT)', () => {
  const echs = [ech('eP1', 1), ech('eP2', 2), ech('eA1', 1), ech('eA2', 2)];
  const ds = [
    devis('dP', 'Signé', 'Principal', ['eP1', 'eP2']),
    devis('dA', 'Signé', 'Additif', ['eA1', 'eA2']),
  ];
  const groups = buildFacturationGroups(ds, echs);

  assert.equal(groups.length, 2, 'un bloc par devis signé');
  // Principal d'abord, additif ensuite.
  assert.equal(groups[0].devis.id, 'dP');
  assert.equal(groups[1].devis.id, 'dA');
  // Chaque bloc ne porte que SES échéances…
  assert.deepEqual(groups[0].echeances.map(e => e.id), ['eP1', 'eP2']);
  assert.deepEqual(groups[1].echeances.map(e => e.id), ['eA1', 'eA2']);
  // …et AUCUNE échéance n'est perdue (c'était le bug : eA1/eA2 disparaissaient).
  const shown = groups.flatMap(g => g.echeances.map(e => e.id)).sort();
  assert.deepEqual(shown, ['eA1', 'eA2', 'eP1', 'eP2']);
});

test('Additif signé listé AVANT le principal → le principal reste en tête', () => {
  const echs = [ech('eA1', 1), ech('eP1', 1)];
  const ds = [
    devis('dA', 'Signé', 'Additif', ['eA1']),
    devis('dP', 'Signé', 'Principal', ['eP1']),
  ];
  const groups = buildFacturationGroups(ds, echs);
  assert.deepEqual(groups.map(g => g.devis.id), ['dP', 'dA']);
});

test('Un seul devis signé avec ses échéances → un bloc filtré', () => {
  const echs = [ech('e1', 1), ech('e2', 2)];
  const ds = [devis('d1', 'Signé', 'Principal', ['e1', 'e2'])];
  const groups = buildFacturationGroups(ds, echs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].echeances.map(e => e.id), ['e1', 'e2']);
});

test('Un seul devis signé SANS échéance liée → fallback : toutes les échéances', () => {
  const echs = [ech('e1', 1), ech('e2', 2)];
  const ds = [devis('d1', 'Signé', 'Principal', [])];
  const groups = buildFacturationGroups(ds, echs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].devis.id, 'd1');
  assert.deepEqual(groups[0].echeances.map(e => e.id), ['e1', 'e2']);
});

test('Aucun devis signé → un bloc avec toutes les échéances (comportement historique)', () => {
  const echs = [ech('e1', 1)];
  const ds = [devis('d1', 'Brouillon', 'Principal', ['e1'])];
  const groups = buildFacturationGroups(ds, echs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].devis, null);
  assert.deepEqual(groups[0].echeances.map(e => e.id), ['e1']);
});

test('Un devis brouillon ne crée pas de bloc : ses échéances ne sont pas facturables', () => {
  const echs = [ech('eP1', 1), ech('eX1', 1)];
  const ds = [
    devis('dP', 'Signé', 'Principal', ['eP1']),
    devis('dX', 'Brouillon', 'Additif', ['eX1']),
  ];
  const groups = buildFacturationGroups(ds, echs);
  assert.equal(groups.length, 1, 'seul le devis signé fait un bloc');
  assert.deepEqual(groups[0].echeances.map(e => e.id), ['eP1']);
});
