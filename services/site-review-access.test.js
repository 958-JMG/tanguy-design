const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcrypt');
const { createVitrine } = require('./site-vitrine');

const password = require('node:crypto').randomBytes(24).toString('hex');
const hash = bcrypt.hashSync(password, 10);

async function setup(t, access = {}, options = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ name: 'review-test', keys: ['test-only-session-key'], sameSite: 'strict', httpOnly: true }));
  const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).end();
  app.use(createVitrine({
    store: { configured: true, read: async () => null }, requireAuth, requireAdmin: requireAuth,
    reviewAccess: { enabled: true, username: 'reviewer', passwordHash: hash, ...access }, ...options,
  }));
  app.get('/api/private', requireAuth, (req, res) => res.send('private'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const jar = {};
  const request = (path, { body, host = 'localhost', cookies = jar } = {}) => new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : '';
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body ? 'POST' : 'GET', headers: { Host: host, Cookie: Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; '),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      for (const cookie of res.headers['set-cookie'] || []) {
        const [key, ...value] = cookie.split(';')[0].split('='); jar[key] = value.join('=');
      }
      let text = ''; res.on('data', b => text += b);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end(data);
  });
  const login = async (extra = {}) => {
    const page = await request('/site/acces');
    const csrf = page.text.match(/name="csrf" value="([^"]+)"/)[1];
    return request('/site/acces', { body: { login: 'reviewer', password, csrf, ...extra } });
  };
  return { request, login, jar };
}

test('review gate protects all pages, media and assets; login grants no cockpit access', async t => {
  const { request, login } = await setup(t);
  for (const path of ['/site', '/site/', '/site/cuisines/', '/site/assets/style.css', '/site/media/unknown.jpg', '/site/sitemap.xml', '/SITE/']) {
    const r = await request(path);
    assert.equal(r.status, 303, path);
    assert.match(r.headers.location, /^\/site\/acces\?/);
    assert.equal(r.headers['cache-control'], 'private, no-store');
  }
  const page = await request('/site/acces');
  assert.match(page.text, /Aucun compte ChatGPT/);
  assert.match(page.headers['set-cookie'][0], /httponly/i);
  assert.equal((await login({ password: 'incorrect' })).status, 401);
  const ok = await login({ next: '/site/cuisines/' });
  assert.equal(ok.status, 303); assert.equal(ok.headers.location, '/site/cuisines/');
  for (const path of ['/site/', '/site/cuisines/', '/site/assets/style.css']) {
    const r = await request(path); assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    assert.match(r.headers['x-robots-tag'], /noindex/);
  }
  assert.equal((await request('/gestion-site')).status, 401);
  assert.equal((await request('/api/private')).status, 401);
});

test('review session expires and credential rotation invalidates the old grant', async t => {
  let clock = Date.now();
  const first = await setup(t, { now: () => clock, maxAge: 1000 });
  await first.login();
  const second = await setup(t, { passwordHash: bcrypt.hashSync(password + '2', 10) });
  assert.equal((await second.request('/site/', { cookies: first.jar })).status, 303);
  clock += 1001;
  assert.equal((await first.request('/site/')).status, 303);
});

test('CSRF, external redirects and repeated failed passwords are rejected', async t => {
  const { request, login } = await setup(t);
  assert.equal((await request('/site/acces', { body: { login: 'reviewer', password } })).status, 403);
  assert.equal((await login({ next: 'https://example.com/' })).headers.location, '/site/');
  assert.equal((await request('/site/acces?next=%2F%2Fevil.example')).headers.location, '/site/');
  assert.equal((await request('/site/acces?next=%2Fsite%2F..%2Fgestion-site')).headers.location, '/site/');
  const limited = await setup(t, { attempts: 1 });
  assert.equal((await limited.login({ password: 'bad' })).status, 401);
  const blocked = await limited.login({ password: 'bad' });
  assert.equal(blocked.status, 429); assert(blocked.headers['retry-after']);
});

test('enabled gate without credentials fails closed', async t => {
  const { request } = await setup(t, { passwordHash: '' });
  assert.equal((await request('/site/')).status, 503);
});

test('future commercial domain is public and the alternate domain redirects; preview stays protected', async t => {
  const { request } = await setup(t, {}, { publicOrigin: 'https://www.tanguydesign.com', indexable: true });
  const r = await request('/cuisines/', { host: 'www.tanguydesign.com' });
  assert.equal(r.status, 200); assert.match(r.text, /content="index,follow/);
  const alternate = await request('/cuisines/?origine=mail', { host: 'tanguydesign.com' });
  assert.equal(alternate.status, 301);
  assert.equal(alternate.headers.location, 'https://www.tanguydesign.com/cuisines/?origine=mail');
  assert.equal((await request('/site/')).status, 303);
  assert.equal((await request('/site/', { host: 'cockpits68691d55-tanguy.functions.fnc.fr-par.scw.cloud' })).status, 303);
  assert.equal((await request('/gestion-site', { host: 'www.tanguydesign.com' })).status, 404);
});
