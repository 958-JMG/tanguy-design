#!/usr/bin/env node
/**
 * Migration Airtable — onglet SAV local (2026-06-09)
 *
 * Ajoute deux champs ADDITIFS (singleSelect) à la table SAV pour piloter
 * un tableau SAV avec colonnes Date / Client / Ville / Type / Statut :
 *
 *   - "Statut"   : singleSelect — Nouveau | En cours | En attente pièce | Résolu | Annulé
 *   - "Type SAV" : singleSelect — Réglage | Pièce à remplacer | Reprise | Autre
 *
 * Pourquoi "Type SAV" et pas "Type" :
 *   La table SAV possède DÉJÀ un champ "Type" de type multilineText. On ne change
 *   JAMAIS le type d'un champ existant (règle dure). On crée donc un champ additif
 *   distinct "Type SAV" en singleSelect, sans toucher au "Type" texte historique.
 *
 * La VILLE n'est pas un champ : elle est dérivée du client lié (table Clients a
 * déjà "Ville"/"CP"). Aucun champ Ville n'est créé ici.
 *
 * Idempotent : chaque création vérifie l'existence avant d'agir. Re-run safe.
 *
 * Usage :
 *   node scripts/setup-sav-fields.js          # dry-run (lit + affiche le plan)
 *   node scripts/setup-sav-fields.js --apply  # exécute
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
const SAV_TBL = 'tbl8ErWw6zhXLfCII';

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
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

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — aucune modification (relance avec --apply)\n');

  const schema = await fetchSchema();
  const sav = schema.tables.find(t => t.id === SAV_TBL);
  if (!sav) throw new Error('Table SAV introuvable');

  const actions = [];

  // 1. Statut (singleSelect) — n'existe pas encore sur SAV
  if (!findField(sav, 'Statut')) {
    actions.push({
      label: 'Statut (singleSelect : Nouveau | En cours | En attente pièce | Résolu | Annulé)',
      run: () => createField(SAV_TBL, {
        name: 'Statut',
        type: 'singleSelect',
        options: { choices: [
          { name: 'Nouveau', color: 'blueLight2' },
          { name: 'En cours', color: 'yellowLight2' },
          { name: 'En attente pièce', color: 'orangeLight2' },
          { name: 'Résolu', color: 'greenLight2' },
          { name: 'Annulé', color: 'grayLight2' },
        ] },
      }),
    });
  }

  // 2. Type SAV (singleSelect) — "Type" existe déjà en multilineText, on ne le convertit pas.
  if (!findField(sav, 'Type SAV')) {
    actions.push({
      label: 'Type SAV (singleSelect : Réglage | Pièce à remplacer | Reprise | Autre)',
      run: () => createField(SAV_TBL, {
        name: 'Type SAV',
        type: 'singleSelect',
        options: { choices: [
          { name: 'Réglage', color: 'cyanLight2' },
          { name: 'Pièce à remplacer', color: 'redLight2' },
          { name: 'Reprise', color: 'purpleLight2' },
          { name: 'Autre', color: 'grayLight2' },
        ] },
      }),
    });
  }

  console.log('=== Table SAV ===');
  if (!actions.length) {
    console.log('  ✅ Aucun changement nécessaire (champs déjà présents)');
    return;
  }
  actions.forEach(a => console.log(`  [create] ${a.label}`));

  if (!APPLY) {
    console.log('\n🧪 Dry-run — relance avec --apply pour exécuter');
    return;
  }

  console.log('\n🚀 Création des champs…');
  for (const a of actions) {
    console.log(`  → ${a.label}`);
    await a.run();
    console.log('    ✓');
  }
  console.log('\n✅ Terminé');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
