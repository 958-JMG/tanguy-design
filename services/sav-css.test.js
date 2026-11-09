const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
require('./fixtures/banc-serveur.js')();
const app = require('../server.js');
test('le SAV contrôle la CSS publique ; pages, scripts métier et API restent authentifiés', async t => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const css = await fetch(base + '/v3/assets/css/styles.css', {redirect:'manual'});
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.headers.get('cache-control'), /no-cache/);
  assert.equal(await css.text(), fs.readFileSync(path.join(__dirname,'../public/v3/assets/css/styles.css'),'utf8'));
  for (const url of ['/v3', '/v3/assets/js/main.js']) {
    const r = await fetch(base + url, {redirect:'manual'});
    assert.equal(r.status, 302, url); assert.equal(r.headers.get('location'), '/login');
  }
  assert.equal((await fetch(base + '/api/data/chantiers', {redirect:'manual'})).status, 401);
});
