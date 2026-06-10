#!/usr/bin/env node
/**
 * Tâches — multi-assignation (modèle validé par JMG, 2026-06-10).
 *
 * Ajoute un champ ADDITIF « Assignées à » (multipleSelects) à la table Tâches, SANS toucher
 * au champ existant « Assignée à » (singleSelect — règle dure : on ne change jamais le type
 * d'un champ existant). « Assignée à » reste le responsable principal (rétro-compat dashboard
 * « Mes tâches ») et « Assignées à » liste tous les co-assignés.
 *
 * Le multi-assign est câblé dans la vue « Toutes les tâches » (éditeur + Kanban). Le champ a
 * été créé en base ; ce script reste pour reproductibilité / autres environnements (idempotent).
 *
 * Usage :
 *   node scripts/setup-taches-multiassign.js          # dry-run
 *   node scripts/setup-taches-multiassign.js --apply  # exécute
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
const TACHES_TBL = 'tblDwUHL16LBVMSaz';
const FIELD = 'Assignées à';
const PERSONNES = ['Virginie', 'Solène', 'Sébastien', 'Marine'];

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — relance avec --apply\n');

  const schemaR = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!schemaR.ok) throw new Error(`schema fetch ${schemaR.status}`);
  const schema = await schemaR.json();
  const tbl = schema.tables.find(t => t.id === TACHES_TBL);
  if (!tbl) throw new Error('Table Tâches introuvable');
  if (tbl.fields.some(f => f.name === FIELD)) {
    console.log(`  ✅ Champ « ${FIELD} » existe déjà`);
    return;
  }

  console.log(`  [create] Champ additif « ${FIELD} » (multipleSelects) sur Tâches`);
  if (!APPLY) { console.log('\n🧪 Dry-run — relance avec --apply'); return; }

  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TACHES_TBL}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FIELD,
      type: 'multipleSelects',
      options: { choices: PERSONNES.map(name => ({ name })) },
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`create field: ${r.status} ${e.error?.message || ''}`);
  }
  console.log(`\n✅ Champ « ${FIELD} » créé`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
