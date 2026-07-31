#!/usr/bin/env node
/**
 * Migration Airtable — champs de liaison Pennylane (2026-07-31)
 *
 * Contexte : le cockpit crée un DEVIS BROUILLON dans Pennylane depuis un devis
 * Tanguy (bouton fiche devis). On stocke les identifiants Pennylane pour :
 *   - ne JAMAIS recréer un client déjà présent dans Pennylane (anti-doublon) ;
 *   - rendre l'action idempotente (un devis déjà poussé → lien, pas de doublon) ;
 *   - offrir le lien « ouvrir dans Pennylane ».
 *
 * Champs ajoutés (TECHNIQUES, alimentés auto par le serveur — ne rien saisir) :
 *   - Clients → « Pennylane customer ID » (singleLineText)
 *   - Devis   → « Pennylane quote ID »    (singleLineText)
 *   - Devis   → « Pennylane numéro »       (singleLineText)
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent (skip si présent).
 *
 * Usage :
 *   node scripts/setup-pennylane-fields.js          # dry-run
 *   node scripts/setup-pennylane-fields.js --apply  # exécute
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token scope schema.bases:write).
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

// Doit rester synchronisé avec TABLES.* dans server.js.
const CLIENTS_TABLE_ID = 'tbl2zmxpWWzbY1wT0';
const DEVIS_TABLE_ID   = 'tblWklGEKMiBStXCs';

const FIELDS = [
  { table: CLIENTS_TABLE_ID, tableName: 'Clients', name: 'Pennylane customer ID',
    description: 'Technique — id du client dans Pennylane (anti-doublon). Alimenté auto, ne pas éditer.' },
  { table: DEVIS_TABLE_ID, tableName: 'Devis', name: 'Pennylane quote ID',
    description: 'Technique — id du devis brouillon Pennylane (idempotence). Alimenté auto, ne pas éditer.' },
  { table: DEVIS_TABLE_ID, tableName: 'Devis', name: 'Pennylane numéro',
    description: 'Technique — numéro du devis Pennylane. Alimenté auto, ne pas éditer.' },
];

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function createField(tableId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}

(async () => {
  console.log(`[setup-pennylane-fields] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  for (const spec of FIELDS) {
    const table = schema.tables.find(t => t.id === spec.table);
    if (!table) { console.error(`✗ Table ${spec.tableName} (${spec.table}) introuvable.`); process.exit(1); }
    const existing = table.fields.find(f => f.name === spec.name);
    if (existing) { console.log(`✓ [${spec.tableName}] « ${spec.name} » existe déjà (id=${existing.id}). Skip.`); continue; }
    if (!APPLY) { console.log(`[DRY-RUN] [${spec.tableName}] créerait « ${spec.name} » (singleLineText).`); continue; }
    const created = await createField(spec.table, { name: spec.name, type: 'singleLineText', description: spec.description });
    console.log(`✓ [${spec.tableName}] créé « ${spec.name} » id=${created.id}.`);
  }
  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-pennylane-fields.js --apply`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
