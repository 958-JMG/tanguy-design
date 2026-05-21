#!/usr/bin/env node
/**
 * Migration v4 — création de la table "Users cockpit" Airtable.
 *
 * JMG 2026-05-21 : "TODO admin UI pour que Virginie crée les accès".
 *
 * Structure :
 *  - Login (singleLineText, primary)         — ex "virginie", "solene"
 *  - Hash bcrypt (singleLineText)            — bcrypt rounds=10
 *  - Email (email)
 *  - Display name (singleLineText)           — "Virginie Lorho"
 *  - Admin (checkbox)
 *  - Actif (checkbox, par défaut true)
 *  - Date création (date)
 *  - Notes (multilineText)
 *
 * Une fois créée, les 4 users existants (env var USERS_HASHES) sont migrés
 * dans la table via le script populate. Le serveur lira depuis cette table
 * au lieu de l'env var (avec fallback env var pour bootstrap initial).
 *
 * Usage :
 *   node scripts/setup-v4-users-table.js          # dry-run
 *   node scripts/setup-v4-users-table.js --apply  # exécute
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

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — relance avec --apply\n');

  // Vérifier que la table n'existe pas déjà
  const schemaR = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!schemaR.ok) throw new Error(`schema fetch ${schemaR.status}`);
  const schema = await schemaR.json();
  const existing = schema.tables.find(t => t.name === 'Users cockpit');
  if (existing) {
    console.log(`  ✅ Table "Users cockpit" existe déjà (id=${existing.id})`);
    console.log(`  Fields : ${existing.fields.map(f => f.name).join(', ')}`);
    return;
  }

  console.log('  [create] Table "Users cockpit"');
  console.log('  Fields : Login (primary), Hash bcrypt, Email, Display name, Admin, Actif, Date création, Notes');

  if (!APPLY) {
    console.log('\n🧪 Dry-run — relance avec --apply');
    return;
  }

  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Users cockpit',
      description: 'Comptes utilisateurs du cockpit Tanguy Design. Géré via /v3/#admin/users.',
      fields: [
        { name: 'Login', type: 'singleLineText' },
        { name: 'Hash bcrypt', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Display name', type: 'singleLineText' },
        { name: 'Admin', type: 'checkbox', options: { icon: 'star', color: 'yellowBright' } },
        { name: 'Actif', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
        { name: 'Date création', type: 'date', options: { dateFormat: { name: 'iso' } } },
        { name: 'Notes', type: 'multilineText' },
      ],
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`create table: ${r.status} ${e.error?.message || ''}`);
  }
  const created = await r.json();
  console.log('\n✅ Table créée — id =', created.id);
  console.log('  Ajoute dans .env :');
  console.log(`  USERS_TABLE_ID=${created.id}`);
  console.log('\n  Lance ensuite : node scripts/migrate-users-to-airtable.js --apply');
  console.log('  (migre les users de USERS_HASHES env var vers la table)');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
