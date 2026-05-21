#!/usr/bin/env node
/**
 * Migration v4 — Importe les users de USERS_HASHES env var dans la table
 * "Users cockpit" Airtable (créée par setup-v4-users-table.js).
 *
 * Pour chaque user dans USERS_HASHES env var :
 *   - Login   : depuis la clé
 *   - Hash bcrypt : depuis la valeur
 *   - Email   : depuis USERS_EMAILS env var si dispo, sinon vide
 *   - Display name : login capitalisé
 *   - Admin   : true si login est dans ADMIN_LOGINS, sinon false
 *   - Actif   : true
 *   - Date création : aujourd'hui
 *
 * Idempotent : si un login existe déjà dans la table, skip (pas d'écrasement).
 *
 * Usage :
 *   node scripts/migrate-users-to-airtable.js          # dry-run
 *   node scripts/migrate-users-to-airtable.js --apply  # exécute
 */
const fs = require('fs');
const path = require('path');

if (!process.env.AIRTABLE_KEY) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  }
}
const fetchFn = globalThis.fetch;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const USERS_TABLE_ID = process.env.USERS_TABLE_ID || 'tblO9UtjQh78X14Xk';
const APPLY = process.argv.includes('--apply');

function parseUsers(raw) {
  const map = {};
  for (const part of (raw || '').split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const login = part.slice(0, idx).trim().toLowerCase();
    const hash = part.slice(idx + 1).trim();
    if (login && hash) map[login] = hash;
  }
  return map;
}
function parseEmails(raw) {
  const map = {};
  for (const part of (raw || '').split(',')) {
    const [login, email] = part.split(':').map(s => s.trim());
    if (login && email) map[login.toLowerCase()] = email;
  }
  return map;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — relance avec --apply\n');

  let usersRaw = process.env.USERS_HASHES || '';
  if (process.env.USERS_HASHES_B64) {
    try { usersRaw = Buffer.from(process.env.USERS_HASHES_B64, 'base64').toString('utf8'); }
    catch (e) { console.warn('USERS_HASHES_B64 decode failed:', e.message); }
  }
  const users = parseUsers(usersRaw);
  const emails = parseEmails(process.env.USERS_EMAILS || '');
  const adminSet = new Set(
    (process.env.ADMIN_LOGINS || 'virginie')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );

  if (Object.keys(users).length === 0) {
    console.log('  ⚠️  Aucun user dans USERS_HASHES env var. Set la var et relance.');
    return;
  }
  console.log(`  ${Object.keys(users).length} user(s) à importer : ${Object.keys(users).join(', ')}`);

  // Récupérer les users existants pour éviter les doublons
  const listR = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}?maxRecords=100`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!listR.ok) throw new Error(`list users: ${listR.status}`);
  const list = await listR.json();
  const existingLogins = new Set((list.records || []).map(r => (r.fields?.Login || '').toLowerCase()));

  const today = new Date().toISOString().slice(0, 10);
  const toCreate = [];
  for (const [login, hash] of Object.entries(users)) {
    if (existingLogins.has(login)) {
      console.log(`  [skip] "${login}" déjà dans la table`);
      continue;
    }
    const record = {
      fields: {
        'Login': login,
        'Hash bcrypt': hash,
        'Email': emails[login] || '',
        'Display name': cap(login),
        'Admin': adminSet.has(login),
        'Actif': true,
        'Date création': today,
        'Notes': 'Importé depuis USERS_HASHES env var (migration v4)',
      },
    };
    // Nettoyage des champs vides
    if (!record.fields.Email) delete record.fields.Email;
    toCreate.push(record);
    console.log(`  [create] "${login}" — admin=${adminSet.has(login)} email=${emails[login] || '(vide)'}`);
  }

  if (toCreate.length === 0) {
    console.log('\n  ✅ Aucun nouvel user à importer (tous déjà présents)');
    return;
  }

  if (!APPLY) {
    console.log(`\n🧪 Dry-run — relance avec --apply pour importer ${toCreate.length} user(s)`);
    return;
  }

  // Batch de 10 max
  for (let i = 0; i < toCreate.length; i += 10) {
    const batch = toCreate.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(`batch ${i}: ${r.status} ${e.error?.message || ''}`);
    }
  }
  console.log(`\n✅ ${toCreate.length} user(s) importés dans la table "Users cockpit"`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
