#!/usr/bin/env node
/**
 * Migration v3.10 — ajoute "Architecte" au singleSelect Type de la table Clients.
 *
 * Workflow JMG 2026-05-21 : "Rattacher un architecte à un ou plusieurs clients
 * et quand on va sur la fiche de l'archi on a tout les clients et donc tout les
 * chantiers et potentiellement le CA généré".
 *
 * L'architecte est un client à part entière (avec sa fiche, ses notes, ses
 * documents) qui est lié à d'autres clients via le champ "Architecte référent".
 *
 * Usage :
 *   node scripts/setup-fields-v3-type-architecte.js          # dry-run
 *   node scripts/setup-fields-v3-type-architecte.js --apply  # exécute
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
const CLIENTS_TBL = 'tbl2zmxpWWzbY1wT0';

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — relance avec --apply\n');

  const schemaR = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!schemaR.ok) throw new Error(`schema fetch ${schemaR.status}`);
  const schema = await schemaR.json();
  const tbl = schema.tables.find(t => t.id === CLIENTS_TBL);
  const typeField = tbl?.fields?.find(f => f.name === 'Type');
  if (!typeField) throw new Error('Champ Type introuvable sur Clients');

  const choices = typeField.options?.choices || [];
  if (choices.some(c => c.name === 'Architecte')) {
    console.log('  ✅ Type "Architecte" existe déjà');
    return;
  }

  console.log('  [update] Ajoute "Architecte" aux choices Type Clients');
  console.log('  Choices actuels :', choices.map(c => c.name).join(', '));

  const newChoices = [
    ...choices.map(c => ({ id: c.id, name: c.name, color: c.color })),
    { name: 'Architecte', color: 'purpleLight2' },
  ];

  if (!APPLY) {
    console.log('  Nouvelles choices :', newChoices.map(c => c.name).join(', '));
    console.log('\n🧪 Dry-run — relance avec --apply');
    return;
  }

  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${CLIENTS_TBL}/fields/${typeField.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: { choices: newChoices } }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`update Type: ${r.status} ${e.error?.message || ''}`);
  }
  console.log('\n✅ "Architecte" ajouté à Type Clients');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
