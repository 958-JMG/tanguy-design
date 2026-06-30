/**
 * Test d'intégration bout-en-bout du flux 2FA — sans Airtable réel.
 *
 * On injecte un faux services/users-store dans le require-cache AVANT de charger
 * server.js, puis on exerce les vraies routes HTTP avec un cookie-jar manuel.
 *
 * Usage : node scripts/test-2fa-flow.js
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 */
'use strict';

const path = require('path');
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.NODE_ENV = 'test';
process.env.PORT = String(PORT);
process.env.SESSION_SECRET = 'integration-test-session-secret-0123456789';
process.env.ADMIN_LOGINS = 'demo';

let passed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { console.error(`  ❌ ${label}`); process.exitCode = 1; throw new Error(`FAIL: ${label}`); }
}

// --- Faux users-store en mémoire ------------------------------------------------
const HASH = bcrypt.hashSync('motdepasse', 10);
const db = {
  demo: {
    id: 'recDEMO', login: 'demo', hash: HASH, email: 'demo@t.local',
    displayName: 'Demo User', admin: true, actif: true,
    totpSecret: '', twoFAActif: false, source: 'airtable',
  },
};
const totpMod = require(path.join(__dirname, '..', 'services', 'totp'));
const fakeStore = {
  findUser: async (login) => db[String(login || '').toLowerCase()] || null,
  listUsers: async () => Object.values(db).map(u => ({ ...u, hash: undefined })),
  isAdmin: async (login) => !!(db[login] && db[login].admin),
  getEmail: async (login) => (db[login] && db[login].email) || '',
  setTotp: async (id, enc) => { const u = byId(id); u.totpSecret = enc; u.twoFAActif = true; },
  clearTotp: async (id) => { const u = byId(id); u.totpSecret = ''; u.twoFAActif = false; },
  refreshCache: async () => {},
  createUser: async () => ({}), updateUser: async () => ({}),
  resetPassword: async () => ({}), disableUser: async () => ({}),
};
function byId(id) { return Object.values(db).find(u => u.id === id); }

// Injection require-cache
const storePath = require.resolve(path.join(__dirname, '..', 'services', 'users-store'));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

// --- Cookie jar minimal ---------------------------------------------------------
let cookie = '';
async function call(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + url, {
    method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc && sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  let data = {}; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
function freshSession() { cookie = ''; }

async function main() {
  // Laisse le serveur démarrer.
  require(path.join(__dirname, '..', 'server.js'));
  await new Promise(res => setTimeout(res, 600));

  console.log('\n— Flux 1 : 1ʳᵉ connexion → enrôlement obligatoire —');
  let r = await call('POST', '/api/login', { login: 'demo', password: 'motdepasse' });
  ok(r.status === 200 && r.data.step === 'enroll', 'mot de passe OK → step=enroll');

  r = await call('POST', '/api/login/enroll/start', {});
  ok(r.status === 200 && /^data:image\/png/.test(r.data.qr || ''), 'enroll/start renvoie un QR PNG');
  ok(typeof r.data.secret === 'string' && r.data.secret.length >= 16, 'enroll/start renvoie un secret');
  const secret = r.data.secret;

  r = await call('POST', '/api/login/enroll/verify', { code: '000000' });
  ok(r.status === 401, 'enroll/verify refuse un mauvais code');

  r = await call('POST', '/api/login/enroll/verify', { code: authenticator.generate(secret) });
  ok(r.status === 200 && r.data.user === 'demo', 'enroll/verify avec bon code → connecté');
  ok(db.demo.twoFAActif === true && db.demo.totpSecret.startsWith('v1:'), 'secret chiffré persisté + 2FA actif');

  r = await call('GET', '/api/me', null);
  ok(r.status === 200 && r.data.user === 'demo', '/api/me authentifié après enrôlement');

  console.log('\n— Flux 2 : connexion suivante → code TOTP exigé —');
  freshSession();
  r = await call('POST', '/api/login', { login: 'demo', password: 'motdepasse' });
  ok(r.status === 200 && r.data.step === 'totp', '2FA actif → step=totp (pas d\'accès direct)');

  r = await call('GET', '/api/me', null);
  ok(r.status === 401, 'pas d\'accès avant le code TOTP');

  r = await call('POST', '/api/login/totp', { code: '000000' });
  ok(r.status === 401, 'totp refuse un mauvais code');

  r = await call('POST', '/api/login/totp', { code: authenticator.generate(secret) });
  ok(r.status === 200 && r.data.user === 'demo', 'totp bon code → connecté');

  console.log('\n— Flux 3 : mauvais mot de passe —');
  freshSession();
  r = await call('POST', '/api/login', { login: 'demo', password: 'faux' });
  ok(r.status === 401, 'mauvais mot de passe rejeté (pas de step 2FA)');

  console.log('\n— Flux 4 : break-glass admin reset 2FA —');
  // Connexion admin
  freshSession();
  await call('POST', '/api/login', { login: 'demo', password: 'motdepasse' });
  await call('POST', '/api/login/totp', { code: authenticator.generate(secret) });
  r = await call('POST', '/api/admin/users/recDEMO/reset-2fa', {});
  ok(r.status === 200, 'admin reset-2fa OK');
  ok(db.demo.twoFAActif === false && db.demo.totpSecret === '', '2FA réinitialisé en base');

  freshSession();
  r = await call('POST', '/api/login', { login: 'demo', password: 'motdepasse' });
  ok(r.status === 200 && r.data.step === 'enroll', 'après reset → ré-enrôlement requis');

  console.log(`\n✅ ${passed} assertions passées.`);
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('\n💥', e.message); process.exit(1); });
