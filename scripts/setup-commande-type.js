#!/usr/bin/env node
/**
 * Migration Airtable — ajout du champ "Type" sur la table Commandes (2026-04-30)
 *
 * Permet de typer les commandes pour les regrouper sur la fiche projet et
 * filtrer dans la liste globale (Cuisine / Électroménager / Plan de travail /
 * Sanitaire / Plan technique / Accessoires / Autre).
 *
 * Idempotent : peut être relancé. N'écrase rien.
 *
 * Usage :
 *   node scripts/setup-commande-type.js          # dry-run
 *   node scripts/setup-commande-type.js --apply  # exécute
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token avec scope schema.bases:write).
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

const COMMANDES_TABLE_ID = 'tblDynhnhLXb4Ibs2';
const FIELD_NAME = 'Type';
const TYPES = [
  { name: 'Cuisine',          color: 'blueLight2' },
  { name: 'Électroménager',   color: 'cyanLight2' },
  { name: 'Plan de travail',  color: 'tealLight2' },
  { name: 'Sanitaire',        color: 'purpleLight2' },
  { name: 'Plan technique',   color: 'orangeLight2' },
  { name: 'Accessoires',      color: 'grayLight2' },
  { name: 'Autre',            color: 'grayLight1' },
];

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` }});
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

async function createField(tableId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

(async () => {
  console.log(`[setup-commande-type] mode=${APPLY?'APPLY':'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const cmdTable = schema.tables.find(t => t.id === COMMANDES_TABLE_ID);
  if (!cmdTable) {
    console.error(`Table Commandes ${COMMANDES_TABLE_ID} introuvable.`);
    process.exit(1);
  }
  const existing = cmdTable.fields.find(f => f.name === FIELD_NAME);
  if (existing) {
    console.log(`✓ Champ "${FIELD_NAME}" existe déjà sur Commandes (id=${existing.id}, type=${existing.type}). Rien à faire.`);
    if (existing.type === 'singleSelect') {
      const have = (existing.options?.choices || []).map(c => c.name);
      const missing = TYPES.map(t=>t.name).filter(n => !have.includes(n));
      if (missing.length) {
        console.log(`  ⚠ Options manquantes : ${missing.join(', ')} — à ajouter manuellement dans Airtable si besoin.`);
      } else {
        console.log(`  ✓ Toutes les options attendues sont présentes.`);
      }
    }
    process.exit(0);
  }
  const body = {
    name: FIELD_NAME,
    type: 'singleSelect',
    options: { choices: TYPES.map(t => ({ name: t.name, color: t.color })) }
  };
  if (!APPLY) {
    console.log(`[DRY-RUN] créerait le champ singleSelect "${FIELD_NAME}" avec ${TYPES.length} options : ${TYPES.map(t=>t.name).join(', ')}`);
    console.log(`Pour exécuter : node scripts/setup-commande-type.js --apply`);
    process.exit(0);
  }
  const created = await createField(COMMANDES_TABLE_ID, body);
  console.log(`✓ Créé champ "${FIELD_NAME}" id=${created.id} avec ${TYPES.length} options.`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
