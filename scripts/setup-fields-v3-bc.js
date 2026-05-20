#!/usr/bin/env node
/**
 * Migration v3.1 — enrichissement table Commandes pour générer de vrais Bons de Commande
 * imprimables et modifiables (format calé sur les BC type Tanguy).
 *
 * Ajouts sur Commandes :
 *   - Fournisseur (multipleRecordLinks → Fournisseurs, single)
 *   - Contremarque (singleLineText) — nom client visible sur le BC ("MORALES")
 *   - Contact Tanguy (singleSelect) — qui suit la commande (Solène / Virginie / Sébastien / Marine)
 *   - Référence courte (singleLineText) — code court fournisseur sur le BC ("NOVA_CUC", "BORA")
 *   - Livraison semaine (singleLineText) — "Semaine 04/2025"
 *   - Modèle choisi (multilineText) — pour BC meubles, header décrivant le modèle (Smart Nova Cucina + Porte 22mm)
 *   - Détails modèle (multilineText) — finitions détaillées (façade, coloris, gorges, profondeur…)
 *   - Lignes BC (multilineText) — JSON structuré des lignes éditables [{pos,code,description,sens,coteVisible,quantite,unite}]
 *
 * Usage :
 *   node scripts/setup-fields-v3-bc.js          # dry-run
 *   node scripts/setup-fields-v3-bc.js --apply  # exécute
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

const TABLES = {
  commandes:    'tblDynhnhLXb4Ibs2',
  fournisseurs: 'tblz1AZIKkn9VCbkR',
};

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` }
  });
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
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

const findField = (table, name) => table.fields.find(f => f.name === name);

(async () => {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — aucune modification (relance avec --apply)\n');

  const schema = await fetchSchema();
  const cmd = schema.tables.find(t => t.id === TABLES.commandes);
  if (!cmd) throw new Error('Table Commandes introuvable');

  const actions = [];

  if (!findField(cmd, 'Fournisseur')) {
    actions.push({
      label: 'Fournisseur (linked Fournisseurs)',
      run: () => createField(TABLES.commandes, {
        name: 'Fournisseur',
        type: 'multipleRecordLinks',
        options: { linkedTableId: TABLES.fournisseurs },
      }),
    });
  }

  if (!findField(cmd, 'Contremarque')) {
    actions.push({
      label: 'Contremarque (texte)',
      run: () => createField(TABLES.commandes, { name: 'Contremarque', type: 'singleLineText' }),
    });
  }

  if (!findField(cmd, 'Contact Tanguy')) {
    actions.push({
      label: 'Contact Tanguy (singleSelect)',
      run: () => createField(TABLES.commandes, {
        name: 'Contact Tanguy', type: 'singleSelect',
        options: { choices: [
          { name: 'Solène', color: 'blueLight2' },
          { name: 'Virginie', color: 'greenLight2' },
          { name: 'Sébastien', color: 'orangeLight2' },
          { name: 'Marine', color: 'pinkLight2' },
        ]},
      }),
    });
  }

  if (!findField(cmd, 'Référence courte')) {
    actions.push({
      label: 'Référence courte (texte) — ex: NOVA_CUC, BORA',
      run: () => createField(TABLES.commandes, { name: 'Référence courte', type: 'singleLineText' }),
    });
  }

  if (!findField(cmd, 'Livraison semaine')) {
    actions.push({
      label: 'Livraison semaine (texte) — "Semaine 04/2025"',
      run: () => createField(TABLES.commandes, { name: 'Livraison semaine', type: 'singleLineText' }),
    });
  }

  if (!findField(cmd, 'Modèle choisi')) {
    actions.push({
      label: 'Modèle choisi (multiline) — header "Choix du modèle" BC',
      run: () => createField(TABLES.commandes, { name: 'Modèle choisi', type: 'multilineText' }),
    });
  }

  if (!findField(cmd, 'Détails modèle')) {
    actions.push({
      label: 'Détails modèle (multiline) — finitions exhaustives',
      run: () => createField(TABLES.commandes, { name: 'Détails modèle', type: 'multilineText' }),
    });
  }

  if (!findField(cmd, 'Lignes BC')) {
    actions.push({
      label: 'Lignes BC (multiline JSON) — éditable structuré',
      run: () => createField(TABLES.commandes, { name: 'Lignes BC', type: 'multilineText' }),
    });
  }

  console.log('=== Table Commandes ===');
  if (actions.length === 0) console.log('  ✅ Aucun champ à créer (tous présents)');
  else actions.forEach(a => console.log(`  [create] ${a.label}`));

  if (APPLY && actions.length) {
    console.log('\n🚀 Application…');
    for (const a of actions) {
      console.log(`  → ${a.label}`);
      await a.run();
      console.log(`    ✓`);
    }
  }

  console.log('\n' + (APPLY ? '✅ Terminé' : '🧪 Dry-run — relance avec --apply'));
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
