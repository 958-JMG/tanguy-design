// Test hors-ligne de la sonde des connecteurs.
// RÈGLE 9·58 : un test ne joint JAMAIS un vrai service. On neutralise fetch (il throw si
// appelé) et on vide les clés d'env → chaque sonde doit court-circuiter en 'absent' SANS
// toucher le réseau. Si une garde manquait, fetch serait appelé et le test échouerait.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sonderConnecteurs, sonderAvecReessai, classer, ORDRE } = require('./sonde-connecteurs');

const timeoutErr = () => Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });

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

// Le réessai ne doit JAMAIS peindre un faux rouge sur un pic transitoire (leçon fail2ban /
// fonts.check), ni cacher un vrai rouge franc, ni ralentir un rouge déterministe par un réessai inutile.
test('réessai : un blip (timeout puis OK) est absorbé en vert', async () => {
  let appels = 0;
  const fn = async () => { appels++; if (appels === 1) throw timeoutErr(); return { etat: 'vert', detail: 'OK' }; };
  const { out } = await sonderAvecReessai(fn, undefined, { delai: 0 });
  assert.equal(out.etat, 'vert');
  assert.equal(appels, 2, 'doit avoir réessayé une fois');
});

test('réessai : un 5xx transitoire puis OK est absorbé en vert', async () => {
  let appels = 0;
  const fn = async () => { appels++; return appels === 1 ? classer(503, { vert: 'OK' }) : { etat: 'vert', detail: 'OK' }; };
  const { out } = await sonderAvecReessai(fn, undefined, { delai: 0 });
  assert.equal(out.etat, 'vert');
  assert.equal(appels, 2);
});

test('réessai : un timeout persistant reste rouge (après 2 tentatives)', async () => {
  let appels = 0;
  const fn = async () => { appels++; throw timeoutErr(); };
  const { out } = await sonderAvecReessai(fn, undefined, { delai: 0 });
  assert.equal(out.etat, 'rouge');
  assert.match(out.detail, /timeout/);
  assert.equal(appels, 2);
  assert.ok(!('transitoire' in out), 'le flag interne ne fuit pas en sortie');
});

test('réessai : un 401 franc reste rouge SANS réessai (déterministe)', async () => {
  let appels = 0;
  const fn = async () => { appels++; return classer(401, { vert: 'OK' }); };
  const { out } = await sonderAvecReessai(fn, undefined, { delai: 0 });
  assert.equal(out.etat, 'rouge');
  assert.match(out.detail, /401/);
  assert.equal(appels, 1, 'un échec franc ne se réessaie pas');
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
