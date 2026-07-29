/**
 * services/users-store.js
 *
 * Sprint v4 — Source de vérité unique pour les comptes utilisateurs du cockpit.
 * Lit la table Airtable "Users cockpit" et expose une API CRUD.
 *
 * Cache en mémoire avec refresh automatique (TTL 60s) pour minimiser les appels
 * Airtable. Fallback sur USERS_HASHES env var si Airtable indisponible (résilience).
 *
 * Sécurité :
 *  - bcrypt rounds=10 (cohérent avec auth existante)
 *  - Hash jamais retourné dans listUsers() pour le frontend
 *  - Disable (Actif=false) au lieu de delete pour préserver l'audit trail
 */

const bcrypt = require('bcrypt');
const logger = require('./logger');

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
const USERS_TABLE_ID = process.env.USERS_TABLE_ID || 'tblO9UtjQh78X14Xk';
const CACHE_TTL_MS = 60 * 1000;
const BCRYPT_ROUNDS = 10;

let cache = null;       // Map<login, userObj>
let cacheTime = 0;
let envFallback = null; // Map fallback depuis env var

function parseEnvUsers(raw) {
  const map = new Map();
  for (const part of (raw || '').split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const login = part.slice(0, idx).trim().toLowerCase();
    const hash = part.slice(idx + 1).trim();
    if (login && hash) map.set(login, { login, hash, admin: false, actif: true, source: 'env' });
  }
  return map;
}

function initEnvFallback() {
  if (envFallback) return envFallback;
  let raw = process.env.USERS_HASHES || '';
  if (process.env.USERS_HASHES_B64) {
    try { raw = Buffer.from(process.env.USERS_HASHES_B64, 'base64').toString('utf8'); }
    catch (e) { logger.warn('USERS_HASHES_B64 decode failed:', e.message); }
  }
  envFallback = parseEnvUsers(raw);
  return envFallback;
}

async function fetchFromAirtable() {
  if (!BASE_ID || !AT_KEY) throw new Error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis');
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}?maxRecords=100`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!r.ok) throw new Error(`users fetch ${r.status}`);
  const d = await r.json();
  const map = new Map();
  for (const rec of (d.records || [])) {
    const f = rec.fields || {};
    const login = String(f.Login || '').toLowerCase().trim();
    if (!login) continue;
    map.set(login, {
      id: rec.id,
      login,
      hash: f['Hash bcrypt'] || '',
      email: f.Email || '',
      displayName: f['Display name'] || login,
      admin: !!f.Admin,
      actif: f.Actif !== false, // default true si pas set
      dateCreation: f['Date création'] || null,
      notes: f.Notes || '',
      // 2FA TOTP (Sprint sécu) — secret chiffré au repos, voir services/totp.js
      totpSecret: f['TOTP secret'] || '',
      twoFAActif: !!f['2FA actif'],
      // Rôle poseur (accès terrain restreint aux documents chantier)
      poseur: !!f.Poseur,
      source: 'airtable',
    });
  }
  return map;
}

async function loadUsers(force = false) {
  const now = Date.now();
  if (!force && cache && (now - cacheTime) < CACHE_TTL_MS) return cache;
  try {
    cache = await fetchFromAirtable();
    cacheTime = now;
    logger.debug({ count: cache.size }, '[users-store] cache refreshed from Airtable');
    return cache;
  } catch (e) {
    logger.warn(`[users-store] Airtable fetch failed: ${e.message} — fallback env var`);
    if (!envFallback) initEnvFallback();
    return envFallback;
  }
}

// ============================================================================
// API publique
// ============================================================================

async function findUser(login) {
  if (!login) return null;
  const users = await loadUsers();
  return users.get(String(login).toLowerCase()) || null;
}

async function listUsers() {
  const users = await loadUsers();
  // Ne JAMAIS renvoyer le hash dans la liste publique
  return [...users.values()].map(u => ({
    id: u.id,
    login: u.login,
    email: u.email,
    displayName: u.displayName,
    admin: u.admin,
    poseur: !!u.poseur,
    actif: u.actif,
    twoFAActif: !!u.twoFAActif,
    dateCreation: u.dateCreation,
    source: u.source,
  }));
}

async function createUser({ login, password, email, displayName, admin = false, poseur = false, notes = '' }) {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable non configuré');
  const loginLo = String(login || '').toLowerCase().trim();
  if (!loginLo) throw new Error('Login requis');
  const existing = await findUser(loginLo);
  if (existing) throw new Error(`Login "${loginLo}" déjà utilisé`);
  // Connexion passwordless (TOTP) : le mot de passe n'est plus utilisé au login.
  // On stocke tout de même un hash (aléatoire si non fourni) pour ne pas laisser le champ vide.
  const pwd = (password && password.length >= 8) ? password : require('crypto').randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
  const fields = {
    'Login': loginLo,
    'Hash bcrypt': hash,
    'Email': email || '',
    'Display name': displayName || loginLo,
    'Admin': !!admin,
    'Poseur': !!poseur,
    'Actif': true,
    'Date création': new Date().toISOString().slice(0, 10),
    'Notes': notes || '',
  };
  if (!fields.Email) delete fields.Email;
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`Airtable create: ${r.status} ${e.error?.message || ''}`);
  }
  cache = null; // invalide cache
  const created = await r.json();
  return { id: created.id, login: loginLo, admin };
}

async function updateUser(userId, patch) {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable non configuré');
  if (!userId) throw new Error('userId requis');
  const fields = {};
  if (patch.email !== undefined) fields.Email = patch.email || '';
  if (patch.displayName !== undefined) fields['Display name'] = patch.displayName || '';
  if (patch.admin !== undefined) fields.Admin = !!patch.admin;
  if (patch.poseur !== undefined) fields.Poseur = !!patch.poseur;
  if (patch.actif !== undefined) fields.Actif = !!patch.actif;
  if (patch.notes !== undefined) fields.Notes = patch.notes || '';
  if (Object.keys(fields).length === 0) throw new Error('Aucun champ à mettre à jour');
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`Airtable update: ${r.status} ${e.error?.message || ''}`);
  }
  cache = null;
  return await r.json();
}

async function resetPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('Mot de passe ≥ 8 caractères');
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'Hash bcrypt': hash } }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`Reset password: ${r.status} ${e.error?.message || ''}`);
  }
  cache = null;
  return { ok: true };
}

async function disableUser(userId) {
  return updateUser(userId, { actif: false });
}

// ============================================================================
// 2FA TOTP
// ============================================================================

/**
 * Enregistre le secret TOTP (déjà CHIFFRÉ par services/totp.js) d'un user et
 * active son 2FA. Appelé à la fin de l'enrôlement réussi.
 */
async function setTotp(userId, encryptedSecret) {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable non configuré');
  if (!userId) throw new Error('userId requis');
  if (!encryptedSecret) throw new Error('secret requis');
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'TOTP secret': encryptedSecret, '2FA actif': true } }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`setTotp: ${r.status} ${e.error?.message || ''}`);
  }
  cache = null;
  return { ok: true };
}

/**
 * Réinitialise le 2FA d'un user (break-glass : perte du téléphone).
 * Vide le secret + décoche 2FA actif → l'user devra ré-enrôler au prochain login.
 */
async function clearTotp(userId) {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable non configuré');
  if (!userId) throw new Error('userId requis');
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'TOTP secret': '', '2FA actif': false } }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`clearTotp: ${r.status} ${e.error?.message || ''}`);
  }
  cache = null;
  return { ok: true };
}

async function isAdmin(login) {
  const u = await findUser(login);
  return u?.admin === true && u?.actif !== false;
}

async function getEmail(login) {
  const u = await findUser(login);
  if (u && u.email) return u.email;
  return `${String(login || '').toLowerCase()}@tanguydesign.local`;
}

module.exports = {
  findUser,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  disableUser,
  setTotp,
  clearTotp,
  isAdmin,
  getEmail,
  refreshCache: () => loadUsers(true),
};
