'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrer } = require('../scripts/setup-winner-fields');
const { FIELDS_WINNER } = require('./winner-lignes');
test('migration : simulation sans écriture, apply additif, seconde exécution sans écriture', async () => {
  const table = { id: 'tblCxDvzQAqBzpCx2', name: 'Lignes devis', fields: [] };
  let writes = 0;
  const fetchFn = async (_url, opts) => {
    if (opts.method === 'POST') { writes++; table.fields.push(JSON.parse(opts.body)); }
    return { ok: true, json: async () => ({ tables: [table] }) };
  };
  const opts = { base: 'base-fictive', key: 'cle-fictive', fetchFn, log() {} };
  await migrer(opts);
  assert.equal(writes, 0);
  await migrer({ ...opts, apply: true });
  assert.equal(writes, 4);
  assert.deepEqual(table.fields, FIELDS_WINNER);
  await migrer({ ...opts, apply: true });
  assert.equal(writes, 4);
});
test('migration : cible incorrecte ou type incompatible → aucune écriture', async () => {
  for (const table of [
    { id: 'autre', name: 'Lignes devis', fields: [] },
    { id: 'tblCxDvzQAqBzpCx2', name: 'Lignes devis', fields: [{ name: 'Marque Winner', type: 'number' }] },
  ]) {
    let writes = 0;
    await assert.rejects(migrer({ base: 'base-fictive', key: 'cle-fictive', apply: true, log() {}, fetchFn: async (_url, opts) => {
      if (opts.method) writes++;
      return { ok: true, json: async () => ({ tables: [table] }) };
    } }));
    assert.equal(writes, 0);
  }
});
