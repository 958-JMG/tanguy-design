// Table de vérité du rôle admin unifié (isAdminLogin) : la case « Admin » d'Airtable
// est la source de vérité, l'allowlist env ADMIN_LOGINS reste un filet de sécurité.
// On stubbe usersStore.isAdmin (le flag Airtable) pour piloter le cas.
const test = require('node:test');
const assert = require('node:assert');

const usersStore = require('../services/users-store');
let airtableAdmins = new Set(); // logins avec case « Admin » cochée ET actifs
usersStore.isAdmin = async (login) => airtableAdmins.has(login);

const app = require('../server');
const isAdminLogin = app.isAdminLogin;
// En test, ADMIN_LOGINS n'est pas posé → défaut 'virginie' (cf. server.js).

test('membre (case décochée, hors allowlist) → PAS admin', async () => {
  airtableAdmins = new Set();
  assert.equal(await isAdminLogin('marine'), false);
});

test('case Admin cochée dans Airtable → admin (sans toucher à l\'env)', async () => {
  airtableAdmins = new Set(['marine']);
  assert.equal(await isAdminLogin('marine'), true);
});

test('allowlist env (virginie) → admin même sans case Airtable (filet break-glass)', async () => {
  airtableAdmins = new Set(); // pas coché dans Airtable
  assert.equal(await isAdminLogin('virginie'), true);
});

test('compte désactivé décoché → pas admin (usersStore.isAdmin exclut inactif)', async () => {
  airtableAdmins = new Set(); // usersStore.isAdmin renverrait false pour un inactif
  assert.equal(await isAdminLogin('thomas'), false);
});

test('login vide → pas admin', async () => {
  assert.equal(await isAdminLogin(undefined), false);
  assert.equal(await isAdminLogin(''), false);
});
