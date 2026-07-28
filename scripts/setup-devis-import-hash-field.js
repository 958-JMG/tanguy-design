#!/usr/bin/env node
/**
 * Migration Airtable — ajout du champ « Empreinte import » sur la table Devis (2026-07-28)
 *
 * Contexte (anti-doublon import devis) : /api/devis/import parse le PDF via Claude
 * (60-120s) puis crée le Devis + Zones + Lignes + Échéances. Sans protection, une
 * annulation + relance recrée un devis complet en double. Le fix stocke une
 * empreinte sha256 du PDF importé dans ce champ pour retrouver un import déjà fait.
 *
 *  - « Empreinte import » : singleLineText (64 caractères hex). Champ TECHNIQUE,
 *    non métier, alimenté automatiquement par le serveur. Ne rien y saisir à la main.
 *
 * Additif uniquement : ne change RIEN d'existant, ne supprime RIEN. Idempotent
 * (peut être relancé : skip si le champ existe déjà).
 *
 * Usage :
 *   node scripts/setup-devis-import-hash-field.js          # dry-run
 *   node scripts/setup-devis-import-hash-field.js --apply  # exécute
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

// Doit rester synchronisé avec services/devis-idempotency.js (DEVIS_IMPORT_HASH_FIELD)
// et TABLES.devis.id dans server.js.
const DEVIS_TABLE_ID = 'tblWklGEKMiBStXCs';
const FIELD_NAME = 'Empreinte import';

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
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
    const e = await r.json().catch(() => ({}));
    throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

(async () => {
  console.log(`[setup-devis-import-hash-field] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const devisTable = schema.tables.find(t => t.id === DEVIS_TABLE_ID);
  if (!devisTable) {
    console.error(`Table Devis ${DEVIS_TABLE_ID} introuvable.`);
    process.exit(1);
  }

  const existing = devisTable.fields.find(f => f.name === FIELD_NAME);
  if (existing) {
    console.log(`✓ Champ « ${FIELD_NAME} » existe déjà (id=${existing.id}, type=${existing.type}). Rien à faire.`);
    return;
  }

  const body = {
    name: FIELD_NAME,
    type: 'singleLineText',
    description: 'Technique — empreinte sha256 du PDF importé (anti-doublon). Alimenté auto par le serveur, ne pas éditer.',
  };

  if (!APPLY) {
    console.log(`[DRY-RUN] créerait le champ « ${FIELD_NAME} » (singleLineText) sur la table Devis.`);
    console.log(`Pour exécuter : node scripts/setup-devis-import-hash-field.js --apply`);
    return;
  }

  const created = await createField(DEVIS_TABLE_ID, body);
  console.log(`✓ Créé champ « ${FIELD_NAME} » id=${created.id} type=singleLineText.`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
