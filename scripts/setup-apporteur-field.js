#!/usr/bin/env node
/**
 * Migration Airtable — ajout du champ "Apporteur" sur la table Clients (2026-06-09)
 *
 * Contexte (rétro apporteur d'affaires) : JMG veut tracer qui a APPORTÉ un client
 * (apporteur d'affaires, ex. Solène) afin de calculer une rétrocession de 3 % du
 * CA HT des dossiers signés rattachés à ce client.
 *
 *  - "Apporteur" : singleSelect, options proposées Virginie · Solène · Sébastien
 *    · Marine · Externe. ⚠️ La liste d'options est une DÉCISION DE MODÈLE à valider
 *    par JMG (voir le corps de la PR). Modifie le tableau APPORTEURS ci-dessous si besoin.
 *
 * Additif uniquement : ne change RIEN d'existant, ne supprime RIEN. Idempotent
 * (peut être relancé : skip si le champ existe déjà).
 *
 * Usage :
 *   node scripts/setup-apporteur-field.js          # dry-run
 *   node scripts/setup-apporteur-field.js --apply  # exécute
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

const CLIENTS_TABLE_ID = 'tbl2zmxpWWzbY1wT0';
const APPORTEUR = 'Apporteur';
// ⚠️ Décision de modèle à valider par JMG (cf. PR).
const APPORTEURS = [
  { name: 'Virginie', color: 'blueLight2' },
  { name: 'Solène', color: 'greenLight2' },
  { name: 'Sébastien', color: 'yellowLight2' },
  { name: 'Marine', color: 'pinkLight2' },
  { name: 'Externe', color: 'grayLight2' },
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
  console.log(`[setup-apporteur-field] mode=${APPLY?'APPLY':'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const clientsTable = schema.tables.find(t => t.id === CLIENTS_TABLE_ID);
  if (!clientsTable) {
    console.error(`Table Clients ${CLIENTS_TABLE_ID} introuvable.`);
    process.exit(1);
  }

  const existing = clientsTable.fields.find(f => f.name === APPORTEUR);
  if (existing) {
    console.log(`✓ Champ "${APPORTEUR}" existe déjà (id=${existing.id}, type=${existing.type}). Rien à faire.`);
    if (!APPLY) console.log('Idempotent : aucune action nécessaire.');
    return;
  }

  const body = {
    name: APPORTEUR,
    type: 'singleSelect',
    options: { choices: APPORTEURS },
  };

  if (!APPLY) {
    console.log(`[DRY-RUN] créerait le champ "${APPORTEUR}" type=singleSelect options=${APPORTEURS.map(c => c.name).join(', ')}`);
    console.log(`Pour exécuter : node scripts/setup-apporteur-field.js --apply`);
    return;
  }

  const created = await createField(CLIENTS_TABLE_ID, body);
  console.log(`✓ Créé champ "${APPORTEUR}" id=${created.id} type=singleSelect options=${APPORTEURS.map(c => c.name).join(', ')}.`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
