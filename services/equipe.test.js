'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banc = require('./fixtures/banc-serveur')();
const { membresActifs } = require('./equipe');
before(async () => {
  const t = 'tblO9UtjQh78X14Xk';
  banc.put(t, 'recActif', { Login: 'actif', 'Display name': 'Personne active', Actif: true });
  banc.put(t, 'recParti', { Login: 'parti', 'Display name': 'Ancien membre' });
  banc.put(t, 'recInactif', { Login: 'inactif', Actif: false });
  banc.put(t, 'recTerrain', { Login: 'terrain', Actif: true, Poseur: true });
  await banc.demarrer();
});
after(() => banc.arreter());
test('équipe : uniquement les membres actifs, sans secret ni ancien membre', async () => {
  const r = await banc.appel('GET', '/api/equipe');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { membres: [{ login: 'actif', nom: 'Personne active' }] });
  const store = require('./users-store');
  assert.equal((await store.findUser('parti')).actif, false, 'une case absente est décochée');
});
test('équipe : aucun ancien compte de secours, libellé de tâche conservé pour un membre actif', () => {
  assert.deepEqual(membresActifs([
    { login: 'ancien', actif: true, source: 'env' },
    { login: 'sebastien', displayName: 'Sebastien', actif: true, source: 'airtable' },
  ]), [{ login: 'sebastien', nom: 'Sébastien' }]);
});
