#!/usr/bin/env node
/**
 * Migration Airtable — prix d'achat et fournisseur sur les lignes de devis (2026-10-14)
 *
 * Contexte : Devis express électroménager (projets FINDIS). Chaque article porte
 * son PRIX D'ACHAT (promo FINDIS si présente) et son FOURNISSEUR :
 *   - le prix d'achat donne la marge de chaque partie (électroménager, meubles…) ;
 *   - le fournisseur envoie la ligne dans SON bon de commande à la signature
 *     (un seul BC Findis, même pour un mitigeur acheté chez FINDIS).
 *
 * Champs ajoutés (table « Lignes devis ») :
 *   - « Prix achat HT » (currency, EUR) — total de la ligne, hors éco-participation.
 *   - « Fournisseur » (lien vers « Fournisseurs ») — Airtable crée le lien inverse
 *     dans « Fournisseurs ».
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent (skip si présent).
 * Tant que la migration n'est pas passée, le cockpit crée les lignes SANS ces
 * champs et le DIT (avertissement à la création du devis).
 *
 * Usage :
 *   node scripts/setup-prix-achat-fields.js          # dry-run
 *   node scripts/setup-prix-achat-fields.js --apply  # exécute
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

// Doivent rester synchronisés avec TABLES dans server.js.
const LIGNES_TABLE_ID = 'tblCxDvzQAqBzpCx2';
const FOURNISSEURS_TABLE_ID = 'tblz1AZIKkn9VCbkR';

const FIELDS = [
  {
    name: 'Prix achat HT', type: 'currency', options: { precision: 2, symbol: '€' },
    description: 'Prix d\'achat HT de la ligne (quantité comprise), hors éco-participation. Devis express électroménager : promo FINDIS si présente.',
  },
  {
    name: 'Fournisseur', type: 'multipleRecordLinks', options: { linkedTableId: FOURNISSEURS_TABLE_ID },
    description: 'Fournisseur de la ligne. À la signature, les lignes d\'un même fournisseur partent dans SON bon de commande.',
  },
];

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function createField(tableId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}

(async () => {
  console.log(`[setup-prix-achat-fields] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const table = schema.tables.find(t => t.id === LIGNES_TABLE_ID);
  if (!table) { console.error(`✗ Table Lignes devis (${LIGNES_TABLE_ID}) introuvable.`); process.exit(1); }
  if (!schema.tables.some(t => t.id === FOURNISSEURS_TABLE_ID)) { console.error(`✗ Table Fournisseurs (${FOURNISSEURS_TABLE_ID}) introuvable.`); process.exit(1); }
  for (const f of FIELDS) {
    const existing = table.fields.find(x => x.name === f.name);
    if (existing) { console.log(`✓ [Lignes devis] « ${f.name} » existe déjà (id=${existing.id}, type=${existing.type}). Skip.`); continue; }
    if (!APPLY) { console.log(`[DRY-RUN] [Lignes devis] créerait « ${f.name} » (${f.type}).`); continue; }
    const created = await createField(LIGNES_TABLE_ID, f);
    console.log(`✓ [Lignes devis] créé « ${f.name} » id=${created.id}.`);
  }
  if (!APPLY) console.log('Pour exécuter : node scripts/setup-prix-achat-fields.js --apply');
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
