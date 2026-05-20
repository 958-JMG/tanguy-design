#!/usr/bin/env node
/**
 * Crée sur la table Projets d'Airtable les 3 champs attachments nécessaires
 * pour l'import de dossiers : Plans devis, Plans techniques, Documents projet.
 *
 * Idempotent : si le champ existe déjà, ne fait rien.
 * Affiche les Field IDs (à noter pour le script d'import).
 *
 * Usage :
 *   node scripts/setup-attachment-fields.js
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

const PROJETS_TABLE_ID = 'tbl9y74Gakhfwt6i1';
const FIELDS_WANTED = [
  { name: 'Plans devis',       type: 'multipleAttachments', description: 'Dossiers de présentation, plans d\'aménagement, visualisations client.' },
  { name: 'Plans techniques',  type: 'multipleAttachments', description: 'Plans archi, plans techniques, prise de cotes, vues autocad.' },
  { name: 'Documents projet',  type: 'multipleAttachments', description: 'BC, AR, cahier des charges, notices électro, comptes rendus, feuilles de choix.' },
  { name: 'Journal chantier',  type: 'multilineText',       description: 'Remarques datées (format [YYYY-MM-DD HH:MM — Auteur] texte). Historique chronologique du chantier.' },
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

async function createField(tableId, field) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: field.name,
      type: field.type || 'multipleAttachments',
      description: field.description
    })
  });
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(`create ${field.name}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

(async () => {
  const schema = await fetchSchema();
  const projets = schema.tables.find(t => t.id === PROJETS_TABLE_ID);
  if (!projets) throw new Error('Table Projets introuvable');

  console.log(`Table Projets : ${projets.fields.length} champs existants\n`);

  const result = {};
  for (const want of FIELDS_WANTED) {
    const existing = projets.fields.find(f => f.name === want.name);
    if (existing) {
      console.log(`✓ "${want.name}" existe déjà → ${existing.id} (type: ${existing.type})`);
      result[want.name] = existing.id;
    } else {
      console.log(`→ Création "${want.name}"…`);
      const created = await createField(PROJETS_TABLE_ID, want);
      console.log(`  CRÉÉ ${created.id}`);
      result[want.name] = created.id;
    }
  }

  console.log('\n=== FIELD IDS (à utiliser dans le script d\'import) ===');
  for (const [name, id] of Object.entries(result)) {
    console.log(`  ${name.padEnd(25)} : ${id}`);
  }

  const constBlock = [
    'const PROJET_ATTACHMENT_FIELDS = {',
    ...Object.entries(result).map(([n, id]) => `  '${n}': '${id}',`),
    '};'
  ].join('\n');
  console.log('\n--- à copier dans le script import-dossiers-v2.js ---');
  console.log(constBlock);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
