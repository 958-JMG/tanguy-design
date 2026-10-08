#!/usr/bin/env node
/**
 * Migration Airtable — champ Éco-participation sur le devis (2026-10-08)
 *
 * Contexte : l'éco-participation (mobilier calculé à la dimension + électroménager
 * saisi par Virginie) doit apparaître sur la facture mais HORS CA, « comme la TVA ».
 * Au moment du brouillon Pennylane, le serveur sort ce montant du prix produit et
 * le pose sur une ligne dédiée (cf. services/pennylane.js carveEcoParticipation).
 * Ce champ porte le montant TTC (le « dont XX € » client).
 *
 * Champ ajouté :
 *   - Devis → « Éco-participation » (currency, EUR) — saisi par Virginie sur la
 *     fiche devis, pré-rempli possible par le calcul à la dimension.
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent (skip si présent).
 *
 * Usage :
 *   node scripts/setup-eco-participation-field.js          # dry-run
 *   node scripts/setup-eco-participation-field.js --apply  # exécute
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

// Doit rester synchronisé avec TABLES.devis.id dans server.js.
const DEVIS_TABLE_ID = 'tblWklGEKMiBStXCs';

const FIELD = {
  table: DEVIS_TABLE_ID, tableName: 'Devis', name: 'Éco-participation',
  type: 'currency',
  options: { precision: 2, symbol: '€' },
  description: 'Éco-participation TTC (mobilier + électroménager). Comprise dans le prix (« dont »), sortie du CA sur une ligne dédiée au brouillon Pennylane.',
};

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
  console.log(`[setup-eco-participation-field] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const table = schema.tables.find(t => t.id === FIELD.table);
  if (!table) { console.error(`✗ Table ${FIELD.tableName} (${FIELD.table}) introuvable.`); process.exit(1); }
  const existing = table.fields.find(f => f.name === FIELD.name);
  if (existing) { console.log(`✓ [${FIELD.tableName}] « ${FIELD.name} » existe déjà (id=${existing.id}). Skip.`); return; }
  if (!APPLY) { console.log(`[DRY-RUN] [${FIELD.tableName}] créerait « ${FIELD.name} » (${FIELD.type}).\nPour exécuter : node scripts/setup-eco-participation-field.js --apply`); return; }
  const created = await createField(FIELD.table, { name: FIELD.name, type: FIELD.type, options: FIELD.options, description: FIELD.description });
  console.log(`✓ [${FIELD.tableName}] créé « ${FIELD.name} » id=${created.id}.`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
