/**
 * Gestion du site — revenir en arrière sans perdre ni publier par erreur (JMG, 14/10/2026).
 * 1. Abandonner un brouillon ; retirer une réalisation ajoutée (celles d'origine restent :
 *    leurs pages les lisent par leur position).
 * 2. « Restaurer la publication précédente » ne remplace plus un brouillon modifié sans le dire.
 * 3. La police de l'éditeur s'affiche tout de suite (font-display).
 * Vrai routeur, stockage en mémoire, comme services/site-vitrine.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createVitrine } = require('./site-vitrine');

function memoryStore() {
  let state = null, etag = '';
  return {
    configured: true,
    async read() { return state ? { value: structuredClone(state), etag } : null; },
    async write(value, expected) {
      if (expected !== etag) throw Object.assign(Error('conflict'), { status: 409 });
      state = structuredClone(value); etag = String(+etag + 1);
    },
    async upload() {}, async media() { throw Error('not found'); },
  };
}

async function setup(t) {
  const store = memoryStore(), app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: req.get('test-user'), siteCsrf: 'test-csrf' }; next(); });
  app.use(createVitrine({
    store, origin: 'http://localhost',
    requireAuth: (req, res, next) => req.session.user ? next() : res.redirect('/login'),
    requireAdmin: (req, res, next) => req.session.user === 'admin' ? next() : res.status(403).end(),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  const base = () => 'http://127.0.0.1:' + server.address().port;
  const etag = async () => (await store.read())?.etag ?? '';
  return {
    store, etag,
    page: async url => (await fetch(base() + url, { headers: { 'test-user': 'admin' } })).text(),
    request: url => fetch(base() + url, { redirect: 'manual' }),
    post: async (url, body, extra = {}) => {
      const r = await fetch(base() + url, { method: 'POST', redirect: 'manual', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'test-user': 'admin', 'x-csrf-token': 'test-csrf', ...extra } });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
  };
}

test('abandonner le brouillon : il reprend la version en ligne, et l\'écran le propose seulement s\'il y a lieu', async t => {
  const { post, page, store, etag } = await setup(t);
  let html = await page('/gestion-site');
  assert.match(html, /data-action="abandonner" disabled/, 'rien à abandonner : bouton grisé');
  assert.doesNotMatch(html, /pas encore publiées/);

  assert.equal((await post('/gestion-site/enregistrer', { etag: await etag(), fields: { 'home.title': 'Titre en cours' } })).status, 200);
  html = await page('/gestion-site');
  assert.match(html, /data-action="abandonner" >Abandonner le brouillon/, 'brouillon modifié : bouton actif');
  assert.match(html, /data-brouillon-modifie="1"/);
  assert.match(html, /Des modifications enregistrées ne sont pas encore publiées\./);

  assert.equal((await post('/gestion-site/abandonner', { etag: await etag() }, { 'x-csrf-token': 'mauvais' })).status, 403, 'jeton exigé');
  assert.equal((await post('/gestion-site/abandonner', { etag: 'perime' })).status, 409, 'version périmée refusée');
  const r = await post('/gestion-site/abandonner', { etag: await etag() });
  assert.equal(r.status, 200);
  assert.match(r.json.message, /Brouillon abandonné/);
  const s = (await store.read()).value;
  assert.deepEqual(s.draft, s.published);

  const deux = await post('/gestion-site/abandonner', { etag: await etag() });
  assert.equal(deux.status, 400, 'brouillon déjà identique : refus qui le dit');
  assert.match(deux.json.error, /déjà identique/);
});

test('restaurer : refusé tant que le brouillon modifié n\'est pas explicitement sacrifié', async t => {
  const { post, store, etag } = await setup(t);
  const origine = (await post('/gestion-site/enregistrer', { etag: '', fields: { 'home.title': 'Version A' } })).status;
  assert.equal(origine, 200);
  assert.equal((await post('/gestion-site/publish', { etag: await etag() })).status, 200);
  assert.equal((await post('/gestion-site/enregistrer', { etag: await etag(), fields: { 'home.title': 'Brouillon B' } })).status, 200);

  const refus = await post('/gestion-site/restore', { etag: await etag() });
  assert.equal(refus.status, 409);
  assert.equal(refus.json.brouillon, true);
  assert.match(refus.json.error, /modifications non publiées/);
  let s = (await store.read()).value;
  assert.equal(s.draft.home.title, 'Brouillon B', 'rien n\'a bougé');
  assert.equal(s.published.home.title, 'Version A');

  const ok = await post('/gestion-site/restore', { etag: await etag(), ecraserBrouillon: true });
  assert.equal(ok.status, 200);
  s = (await store.read()).value;
  assert.notEqual(s.published.home.title, 'Version A', 'la publication précédente est revenue');
  assert.deepEqual(s.draft, s.published);
});

test('restaurer sans brouillon modifié : inchangé, aucune confirmation de plus', async t => {
  const { post, etag } = await setup(t);
  await post('/gestion-site/enregistrer', { etag: '', fields: { 'home.title': 'Version A' } });
  await post('/gestion-site/publish', { etag: await etag() });
  assert.equal((await post('/gestion-site/restore', { etag: await etag() })).status, 200);
});

test('réalisation ajoutée : supprimable du brouillon ; publiée, elle reste en ligne jusqu\'à la publication suivante', async t => {
  const { post, page, request, store, etag } = await setup(t);
  assert.equal((await post('/gestion-site/projet', { etag: '' })).status, 200);
  const id = (await store.read()).value.draft.projects.at(-1).id;

  const html = await page('/gestion-site?section=projects');
  assert.equal((html.match(/data-supprimer-projet=/g) || []).length, 1, 'un seul bouton : la réalisation ajoutée');
  assert.match(html, new RegExp(`data-supprimer-projet="${id}"[^>]*data-en-ligne=""`), 'pas encore publiée : la question ne parle pas du site');
  assert.equal((html.match(/Réalisation d’origine du site/g) || []).length, 5, 'les 5 d\'origine le disent');
  assert.match(html, /name="projects\.5\.title"/, 'les champs gardent leur clé : l\'enregistrement ne change pas');

  assert.equal((await post('/gestion-site/publish', { etag: await etag() })).status, 200);
  assert.equal((await request(`/site/realisations/galerie-${id}/`)).status, 200);
  assert.match(await page('/gestion-site?section=projects'), new RegExp(`data-supprimer-projet="${id}"[^>]*data-en-ligne="1"`), 'publiée : la question prévient');

  const r = await post('/gestion-site/projet/supprimer', { etag: await etag(), id });
  assert.equal(r.status, 200);
  assert.match(r.json.message, /reste sur le site jusqu’à la prochaine publication/);
  assert.equal((await store.read()).value.draft.projects.some(p => p.id === id), false);
  assert.equal((await request(`/site/realisations/galerie-${id}/`)).status, 200, 'toujours en ligne avant publication');

  assert.equal((await post('/gestion-site/publish', { etag: await etag() })).status, 200);
  assert.equal((await request(`/site/realisations/galerie-${id}/`)).status, 404, 'retirée à la publication');
});

test('réalisation d\'origine ou inconnue : refus qui le dit, rien ne bouge', async t => {
  const { post, store, etag } = await setup(t);
  await post('/gestion-site/projet', { etag: '' });
  const avant = (await store.read()).value.draft.projects.map(p => p.id);

  const origine = await post('/gestion-site/projet/supprimer', { etag: await etag(), id: '73' });
  assert.equal(origine.status, 400);
  assert.match(origine.json.error, /pages d’origine/);
  const inconnue = await post('/gestion-site/projet/supprimer', { etag: await etag(), id: 'n-existe-pas' });
  assert.equal(inconnue.status, 404);
  assert.equal((await post('/gestion-site/projet/supprimer', { etag: await etag(), id: avant.at(-1) }, { 'x-csrf-token': 'mauvais' })).status, 403);
  assert.deepEqual((await store.read()).value.draft.projects.map(p => p.id), avant);
});

test('police de l\'éditeur : affichée tout de suite (font-display: swap), comme sur le site', () => {
  const css = fs.readFileSync(path.join(__dirname, '../website/admin.css'), 'utf8');
  for (const regle of css.match(/@font-face\{[^}]*\}/g)) assert.match(regle, /font-display:swap/);
});
