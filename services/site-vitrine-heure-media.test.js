/**
 * Gestion du site — deux défauts vus au test d'écriture en prod du 14/10/2026.
 * (a) « Dernière publication » s'affichait à l'heure du conteneur (UTC) : 16:15:38 pour 18:15 à Paris.
 * (b) Une image absente du stockage répondait 503 « stockage indisponible » au lieu de 404.
 * Le fuseau du processus est mis sur UTC, comme dans le conteneur Scaleway : sans cela, le test
 * passerait sur un Mac réglé sur Paris même avec le défaut.
 */
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const { createVitrine, initial } = require('./site-vitrine');

const PUBLIEE_ABSENTE = '11111111-1111-1111-1111-111111111111.webp';
const BROUILLON_ABSENTE = '22222222-2222-2222-2222-222222222222.webp';
const PRESENTE = '33333333-3333-3333-3333-333333333333.webp';
const EN_PANNE = '44444444-4444-4444-4444-444444444444.webp';

// Erreurs telles que le SDK S3 les lève.
const noSuchKey = () => Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
const panne = () => Object.assign(new Error('connect ETIMEDOUT'), { name: 'TimeoutError', $metadata: {} });

function store() {
  const state = initial();
  state.publishedAt = '2026-10-14T16:15:38.092Z';
  state.published.home.hero = '/media/' + PUBLIEE_ABSENTE;
  state.published.home.conceptImage = '/media/' + EN_PANNE;
  return {
    configured: true,
    async read() { return { value: structuredClone(state), etag: '1' }; },
    async write() { throw new Error('aucune écriture attendue'); },
    async upload() {},
    async media(id) {
      if (id === PRESENTE) return { ContentType: 'image/webp', Body: Readable.from(Buffer.from('RIFF....WEBP')) };
      if (id === EN_PANNE) throw panne();
      throw noSuchKey();
    },
  };
}

async function setup(t) {
  const app = express();
  app.use((req, res, next) => { req.session = { user: req.get('test-user'), siteCsrf: 'x' }; next(); });
  app.use(createVitrine({
    store: store(), origin: 'http://localhost',
    requireAuth: (req, res, next) => req.session.user ? next() : res.redirect('/login'),
    requireAdmin: (req, res, next) => req.session.user === 'admin' ? next() : res.status(403).end(),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  return (url, user) => fetch('http://127.0.0.1:' + server.address().port + url, { redirect: 'manual', headers: user ? { 'test-user': user } : {} });
}

test('« Dernière publication » à l\'heure de Paris, pas à celle du conteneur', async t => {
  const get = await setup(t);
  const html = await (await get('/gestion-site', 'admin')).text();
  assert.match(html, /Dernière publication : 14\/10\/2026 18:15:38/);
  assert.doesNotMatch(html, /16:15:38/);
});

test('image absente du stockage : 404, qu\'elle soit publiée ou seulement dans le brouillon', async t => {
  const get = await setup(t);
  assert.equal((await get('/site/media/' + PUBLIEE_ABSENTE)).status, 404, 'publiée, visiteur');
  assert.equal((await get('/site/media/' + BROUILLON_ABSENTE, 'admin')).status, 404, 'brouillon, admin');
  assert.equal((await get('/site/media/' + BROUILLON_ABSENTE)).status, 404, 'brouillon, visiteur : jamais servie');
});

test('vraie panne du stockage : toujours 503 ; image présente : servie', async t => {
  const get = await setup(t);
  assert.equal((await get('/site/media/' + EN_PANNE)).status, 503, 'publiée');
  const ok = await get('/site/media/' + PRESENTE, 'admin');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/webp');
});
