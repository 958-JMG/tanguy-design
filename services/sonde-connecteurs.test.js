// Test hors-ligne de la sonde des connecteurs.
// RÈGLE 9·58 : un test ne joint JAMAIS un vrai service. On neutralise fetch (il throw si
// appelé) et on vide les clés d'env → chaque sonde doit court-circuiter en 'absent' SANS
// toucher le réseau. Si une garde manquait, fetch serait appelé et le test échouerait.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sonderConnecteurs, classer, ORDRE } = require('./sonde-connecteurs');

const ENV_CLES = [
  'AIRTABLE_BASE_ID', 'AIRTABLE_KEY', 'AI_PROVIDER', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY',
  'PENNYLANE_API_KEY', 'S3_TRANSFERT_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
];

function sansEnvNiReseau(fn) {
  const envSauve = {}; for (const c of ENV_CLES) { envSauve[c] = process.env[c]; delete process.env[c]; }
  const fetchSauve = global.fetch;
  global.fetch = () => { throw new Error('INTERDIT : une sonde non configurée a tenté un appel réseau'); };
  return Promise.resolve().then(fn).finally(() => {
    global.fetch = fetchSauve;
    for (const c of ENV_CLES) { if (envSauve[c] === undefined) delete process.env[c]; else process.env[c] = envSauve[c]; }
  });
}

test('classer traduit les codes HTTP en états', () => {
  assert.equal(classer(200, { vert: 'OK' }).etat, 'vert');
  assert.equal(classer(204, { vert: 'OK' }).etat, 'vert');
  assert.equal(classer(401, { vert: 'OK' }).etat, 'rouge');
  assert.match(classer(401, { vert: 'OK' }).detail, /401/);
  assert.equal(classer(403, { vert: 'OK' }).etat, 'rouge');
  assert.equal(classer(404, { vert: 'OK' }).etat, 'rouge');
  const r500 = classer(500, { vert: 'OK', body: 'boom interne' });
  assert.equal(r500.etat, 'rouge');
  assert.match(r500.detail, /500/);
  assert.match(r500.detail, /boom interne/);
});

test('sans clé ni réseau : toutes les sondes sont absentes et le contrat tient', async () => {
  await sansEnvNiReseau(async () => {
    const bilan = await sonderConnecteurs();
    // Contrat de sortie
    assert.ok(bilan.global === 'vert' || bilan.global === 'rouge');
    assert.doesNotThrow(() => new Date(bilan.genere_a).toISOString());
    assert.ok(Array.isArray(bilan.connecteurs));
    // Un connecteur par clé de ORDRE, dans l'ordre, avec les bons champs
    assert.deepEqual(bilan.connecteurs.map(c => c.cle), ORDRE);
    for (const c of bilan.connecteurs) {
      assert.ok(typeof c.nom === 'string' && c.nom.length > 0);
      assert.ok(['vert', 'rouge', 'absent'].includes(c.etat));
      assert.ok(typeof c.detail === 'string' && c.detail.length > 0);
      assert.ok(Number.isFinite(c.ms) && c.ms >= 0);
    }
    // Rien n'étant configuré, tout est absent → aucun rouge → global vert
    assert.ok(bilan.connecteurs.every(c => c.etat === 'absent'), 'toutes absentes sans clé');
    assert.equal(bilan.global, 'vert');
  });
});
