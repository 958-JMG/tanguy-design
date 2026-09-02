#!/usr/bin/env node
/**
 * Migration Airtable — heures de pose (2026-09-02)
 *
 * Contexte : l'onglet « Pose » est un planning horaire (glisser-déposer d'une
 * plage dans la journée, superposition de deux chantiers sur le même créneau).
 * Or `Date pose prévue` et `Date pose fin` sont des champs `date` SANS heure :
 * impossible de poser un créneau dans la journée avec ce seul matériel.
 *
 * Champs ajoutés sur Projets (saisis par l'équipe, pas techniques) :
 *   - « Heure début pose » (singleLineText, format HH:MM)
 *   - « Heure fin pose »   (singleLineText, format HH:MM)
 *
 * Pourquoi du texte et pas une durée : Airtable n'a pas de type « heure du
 * jour ». Un champ `duration` afficherait « 8:00 » sous un intitulé « durée »,
 * trompeur dans la grille. Le cockpit saisit ces heures avec un input `time`,
 * donc personne ne tape le format à la main ; le serveur et l'écran valident.
 *
 * Vide = pose sur la journée standard (cf. POSE_DEFAUT côté cockpit) : les 163
 * projets existants restent valides sans reprise de données.
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent (skip si présent).
 *
 * Usage :
 *   node scripts/setup-pose-heures.js          # dry-run
 *   node scripts/setup-pose-heures.js --apply  # exécute
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

// Doit rester synchronisé avec TABLES.projets dans server.js.
const PROJETS_TABLE_ID = 'tbl9y74Gakhfwt6i1';

const FIELDS = [
  { table: PROJETS_TABLE_ID, tableName: 'Projets', name: 'Heure début pose',
    description: 'Heure de début de la pose sur la journée, format HH:MM (ex. 08:00). Vide = journée standard. Saisi depuis l’onglet Pose du cockpit.' },
  { table: PROJETS_TABLE_ID, tableName: 'Projets', name: 'Heure fin pose',
    description: 'Heure de fin de la pose sur la journée, format HH:MM (ex. 17:00). Vide = journée standard. Saisi depuis l’onglet Pose du cockpit.' },
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
  console.log(`[setup-pose-heures] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
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
  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-pose-heures.js --apply`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
