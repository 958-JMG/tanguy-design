#!/usr/bin/env node
/**
 * Migration Airtable — paramètres de congés par salarié (2026-09-02)
 *
 * Contexte : les compteurs de congés livrés le 02/09 ne calculaient AUCUN droit
 * RTT, faute de connaître le régime horaire de Tanguy. Plutôt que de figer une
 * règle unique dans le code, on donne les manettes à Virginie, salarié par
 * salarié — Marine est alternante, les trois autres sont en CDI, rien ne dit
 * qu'ils ont les mêmes droits.
 *
 * Champs ajoutés sur Salariés (saisis par Virginie, jamais par le serveur) :
 *   - « Jours CP par an »  (number, 1 décimale) — vide = 30 jours ouvrables,
 *     le minimum légal. À augmenter si une convention collective donne plus.
 *   - « Jours RTT par an » (number, 1 décimale) — vide = PAS de RTT. Dès qu'un
 *     nombre est saisi, le compteur RTT du salarié s'affiche.
 *   - « Report CP »        (number, 1 décimale) — reliquat de l'année
 *     précédente, repris du bulletin de paie. Vide = 0.
 *
 * Vide partout = comportement d'aujourd'hui, à l'identique. Les 4 salariés
 * existants restent valides sans reprise de données.
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent (skip si présent).
 *
 * Usage :
 *   node scripts/setup-conges-parametres.js          # dry-run
 *   node scripts/setup-conges-parametres.js --apply  # exécute
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

// Doit rester synchronisé avec TABLES.salaries dans server.js.
const SALARIES_TABLE_ID = 'tblm0VR0eriWBkvs4';

const NUMBER = { precision: 1 };

const FIELDS = [
  { name: 'Jours CP par an', options: NUMBER,
    description: 'Congés payés acquis sur une année pleine, en jours OUVRABLES (samedi compris). Vide = 30, le minimum légal. À augmenter si la convention collective donne plus.' },
  { name: 'Jours RTT par an', options: NUMBER,
    description: 'Droits RTT sur une année pleine, en jours ouvrés. VIDE = pas de RTT pour ce salarié. Dès qu’un nombre est saisi, son compteur RTT apparaît dans l’écran RH.' },
  { name: 'Report CP', options: NUMBER,
    description: 'Reliquat de congés payés reporté de l’année précédente, repris du bulletin de paie. S’ajoute aux droits ouverts. Vide = 0.' },
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
  console.log(`[setup-conges-parametres] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const table = schema.tables.find(t => t.id === SALARIES_TABLE_ID);
  if (!table) { console.error(`✗ Table Salariés (${SALARIES_TABLE_ID}) introuvable.`); process.exit(1); }
  for (const spec of FIELDS) {
    const existing = table.fields.find(f => f.name === spec.name);
    if (existing) { console.log(`✓ [Salariés] « ${spec.name} » existe déjà (id=${existing.id}). Skip.`); continue; }
    if (!APPLY) { console.log(`[DRY-RUN] [Salariés] créerait « ${spec.name} » (number, 1 décimale).`); continue; }
    const created = await createField(SALARIES_TABLE_ID,
      { name: spec.name, type: 'number', options: spec.options, description: spec.description });
    console.log(`✓ [Salariés] créé « ${spec.name} » id=${created.id}.`);
  }
  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-conges-parametres.js --apply`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
