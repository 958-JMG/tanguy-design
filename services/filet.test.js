// Le filet (services/filet.js) : une route async qui rejette répond 500 au lieu de tuer le processus ; une route qui a
// son try ne change pas ; le statut porté par une erreur est respecté ; un middleware async monté par app.use et un
// gestionnaire d'erreurs async (quatre paramètres) sont couverts ; app.get('réglage') lit toujours un réglage. Et le
// processus : avec installerFilet, une promesse rejetée hors de tout est journalisée et le processus vit ; sans lui, Node
// sort en code 1 — le test sait échouer.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const { securiserRoutes, envelopper, gestionnaireErreurs, installerFilet, MESSAGE_500 } = require('./filet');

const RACINE = path.join(__dirname, '..');
const journalDe = () => { const lignes = []; return { lignes, logger: { error: (o, m) => lignes.push({ niveau: 'error', o, m }), warn: (o, m) => lignes.push({ niveau: 'warn', o, m }) } }; };
async function servir(app) { const srv = await new Promise((r) => { const h = app.listen(0, '127.0.0.1', () => r(h)); }); return { srv, base: `http://127.0.0.1:${srv.address().port}` }; }
const appDeTest = () => {
  const { lignes, logger } = journalDe();
  const app = securiserRoutes(express());
  app.get('/api/sync', (req, res) => res.json({ ok: true }));
  app.get('/api/boum', async () => { throw new Error('boum'); });
  app.get('/api/avec-try', async (req, res) => { try { throw new Error('x'); } catch (e) { res.status(400).json({ error: 'dit par la route' }); } });
  app.get('/page/boum', async () => { throw new Error('boum page'); });
  app.get('/api/trop-gros', async () => { const e = new Error('Fichier trop gros'); e.status = 413; throw e; });
  app.use('/api/porte', async () => { throw new Error('porte'); });
  app.get('/api/porte/x', (req, res) => res.json({ passe: true }));
  app.use(gestionnaireErreurs(logger));
  return { app, lignes };
};

test('envelopper : une fonction async est enveloppée, son arité gardée ; tout le reste revient tel quel', () => {
  const sync = (req, res) => res.end();
  assert.equal(envelopper(sync), sync);
  assert.equal(envelopper('/chemin'), '/chemin');
  assert.equal(envelopper(async (req, res) => res.end()).length, 3);
  assert.equal(envelopper(async (err, req, res, next) => next()).length, 4, 'un gestionnaire d’erreurs reste un gestionnaire d’erreurs');
});

test('app.get(« réglage ») lit toujours un réglage après securiserRoutes', () => {
  const app = securiserRoutes(express());
  app.set('vue', 'valeur');
  assert.equal(app.get('vue'), 'valeur');
  assert.equal(typeof app.get('env'), 'string');
});

test('une route async qui rejette répond 500 (JSON sous /api), est journalisée, et le processus vit', async () => {
  const { app, lignes } = appDeTest();
  const { srv, base } = await servir(app);
  try {
    const r = await fetch(base + '/api/boum', { signal: AbortSignal.timeout(2000) });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: MESSAGE_500 });
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].niveau, 'error'); assert.equal(lignes[0].o.err.message, 'boum'); assert.equal(lignes[0].o.chemin, '/api/boum');
    assert.ok(!JSON.stringify(await (await fetch(base + '/api/boum')).json()).includes('filet.test'), 'la pile ne sort jamais');
    const page = await fetch(base + '/page/boum');
    assert.equal(page.status, 500); assert.match(page.headers.get('content-type'), /text\/plain/); assert.equal(await page.text(), MESSAGE_500);
  } finally { srv.close(); }
});

test('une route sync, une route qui a son try, un statut porté par l’erreur : rien ne change, le statut est respecté', async () => {
  const { app, lignes } = appDeTest();
  const { srv, base } = await servir(app);
  try {
    assert.deepEqual(await (await fetch(base + '/api/sync')).json(), { ok: true });
    const t = await fetch(base + '/api/avec-try'); assert.equal(t.status, 400); assert.deepEqual(await t.json(), { error: 'dit par la route' });
    const g = await fetch(base + '/api/trop-gros'); assert.equal(g.status, 413); assert.deepEqual(await g.json(), { error: 'Fichier trop gros' });
    assert.deepEqual(lignes.map((l) => l.niveau), ['warn'], 'un 4xx est un avertissement, pas une erreur');
  } finally { srv.close(); }
});

test('un middleware async monté par app.use est couvert lui aussi', async () => {
  const { app } = appDeTest();
  const { srv, base } = await servir(app);
  try { const r = await fetch(base + '/api/porte/x', { signal: AbortSignal.timeout(2000) }); assert.equal(r.status, 500); } finally { srv.close(); }
});

test('un gestionnaire d’erreurs async (quatre paramètres) est bien appelé comme tel', async () => {
  const app = securiserRoutes(express());
  app.get('/boum', async () => { throw new Error('boum'); });
  app.use(async (err, req, res, next) => { res.status(418).json({ vu: err.message }); });
  const { srv, base } = await servir(app);
  try { const r = await fetch(base + '/boum'); assert.equal(r.status, 418); assert.deepEqual(await r.json(), { vu: 'boum' }); } finally { srv.close(); }
});

const enfant = (code) => new Promise((res) => {
  const p = spawn(process.execPath, ['-e', code], { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test' } });
  let sortie = ''; p.stdout.on('data', (d) => { sortie += d; }); p.stderr.on('data', (d) => { sortie += d; });
  p.on('exit', (code) => res({ code, sortie }));
});

// Un vrai serveur Express dans un processus enfant, une route async qui rejette, une requête dessus : avec ou sans le filet.
const serveurEnfant = (avecFilet) => enfant(`
  const express = require('express'); const app = express();
  ${avecFilet ? "require('./services/filet').securiserRoutes(app);" : ''}
  app.get('/boum', async () => { throw new Error('échappée'); });
  const s = app.listen(0, '127.0.0.1', async () => {
    try { const r = await fetch('http://127.0.0.1:' + s.address().port + '/boum', { signal: AbortSignal.timeout(1500) }); console.log('REPONSE', r.status); }
    catch (e) { console.log('SANS REPONSE', e.name); }
    process.exit(0);
  });`);

test('sans le filet, le rejet d’une route async tue le processus (code 1) et la requête reste sans réponse ; avec, 500 et le processus vit', async () => {
  const sans = await serveurEnfant(false);
  assert.equal(sans.code, 1, 'l’ancien monde : Node sort sur la promesse rejetée');
  assert.match(sans.sortie, /échappée/);
  assert.ok(!sans.sortie.includes('REPONSE'), 'personne n’a répondu');
  const avec = await serveurEnfant(true);
  assert.equal(avec.code, 0);
  assert.match(avec.sortie, /REPONSE 500/, 'le gestionnaire d’erreurs (ici celui d’Express) répond 500');
});

test('installerFilet : une promesse rejetée hors de tout est journalisée, le processus vit (sans lui, Node sort en code 1)', async () => {
  const sans = await enfant("Promise.reject(new Error('boum')); setTimeout(() => process.exit(0), 150);");
  assert.equal(sans.code, 1, 'l’ancien monde : Node sort sur la promesse rejetée');
  const avec = await enfant("require('./services/filet').installerFilet({ error: (o, m) => console.error('JOURNAL', m, o.err.message) }); Promise.reject(new Error('boum')); setTimeout(() => process.exit(0), 150);");
  assert.equal(avec.code, 0, 'avec le filet : le processus va au bout');
  assert.match(avec.sortie, /JOURNAL promesse rejetée sans gestionnaire — journalisée, le serveur continue boum/);
});
