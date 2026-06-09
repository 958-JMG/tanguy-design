#!/usr/bin/env node
/**
 * Agenda v2 (2026-06) — ajoute "Réception" et "Pose" au champ Type de la table
 * rendez-vous (split de l'ancien type combiné "Réception/Pose", conservé pour l'historique).
 *
 * ADDITIF & idempotent : n'ajoute que des options manquantes, ne renomme/supprime rien.
 * Si le champ Type n'est PAS un singleSelect (ex. texte libre), aucune action n'est requise
 * (n'importe quelle valeur est déjà acceptée) → le script le signale et sort proprement.
 *
 * Usage :
 *   node scripts/setup-agenda-v2-types.js          # dry-run
 *   node scripts/setup-agenda-v2-types.js --apply  # exécute
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
const RDV_TBL = 'tbli7Rdwv7J3XY3dU'; // table rendez-vous
const NOUVELLES = ['Réception', 'Pose'];

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — relance avec --apply\n');

  const schemaR = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!schemaR.ok) throw new Error(`schema fetch ${schemaR.status}`);
  const schema = await schemaR.json();
  const tbl = schema.tables.find(t => t.id === RDV_TBL);
  const typeField = tbl?.fields?.find(f => f.name === 'Type');
  if (!typeField) throw new Error('Champ Type introuvable sur rendez-vous');

  if (typeField.type !== 'singleSelect') {
    console.log(`  ✅ Type est "${typeField.type}" (pas un singleSelect) → aucune option à créer, toute valeur est acceptée.`);
    return;
  }

  const choices = typeField.options?.choices || [];
  const present = new Set(choices.map(c => c.name));
  const aAjouter = NOUVELLES.filter(n => !present.has(n));
  if (!aAjouter.length) {
    console.log('  ✅ "Réception" et "Pose" existent déjà dans Type rendez-vous');
    return;
  }

  console.log('  Choices actuels :', choices.map(c => c.name).join(', '));
  console.log('  À ajouter :', aAjouter.join(', '));

  const newChoices = [
    ...choices.map(c => ({ id: c.id, name: c.name, color: c.color })),
    ...aAjouter.map(name => ({ name })),
  ];

  if (!APPLY) { console.log('\n🧪 Dry-run — relance avec --apply'); return; }

  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${RDV_TBL}/fields/${typeField.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: { choices: newChoices } }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`update Type: ${r.status} ${e.error?.message || ''}`);
  }
  console.log(`\n✅ ${aAjouter.join(' + ')} ajouté(s) à Type rendez-vous`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
