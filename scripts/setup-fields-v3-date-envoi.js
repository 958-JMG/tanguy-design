#!/usr/bin/env node
/**
 * Migration v3.4 — ajoute le champ "Date envoi" à la table Commandes.
 *
 * Workflow JMG 2026-05-21 : "On part de la date prévisionnelle de pose et 3,5 mois
 * avant il faut faire toutes les commandes". Donc à la signature du devis,
 * pour chaque BC créé, on set "Date envoi" = date pose - 105 jours pour rappeler
 * à Virginie quand envoyer le BC au fournisseur.
 *
 * À ne pas confondre avec "Date livraison prévue" (= date à laquelle on attend
 * le matos chez Tanguy, ~J-7 à J-30 avant pose selon fournisseur).
 *
 * Usage :
 *   node scripts/setup-fields-v3-date-envoi.js          # dry-run
 *   node scripts/setup-fields-v3-date-envoi.js --apply  # exécute
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
const COMMANDES_TBL = 'tblDynhnhLXb4Ibs2';

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — aucune modification (relance avec --apply)\n');

  // Vérifier que le champ n'existe pas déjà
  const schemaR = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` },
  });
  if (!schemaR.ok) throw new Error(`schema fetch ${schemaR.status}`);
  const schema = await schemaR.json();
  const cmd = schema.tables.find(t => t.id === COMMANDES_TBL);
  if (!cmd) throw new Error('Table Commandes introuvable');

  const exists = cmd.fields.find(f => f.name === 'Date envoi');
  if (exists) {
    console.log('  ✅ Le champ "Date envoi" existe déjà (' + exists.type + ')');
    return;
  }

  console.log('  [create] "Date envoi" (date) — date d\'envoi du BC au fournisseur, calculée à date pose - 105 jours');

  if (!APPLY) {
    console.log('\n🧪 Dry-run — relance avec --apply pour créer le champ');
    return;
  }

  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${COMMANDES_TBL}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Date envoi',
      type: 'date',
      options: { dateFormat: { name: 'iso' } },
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`create Date envoi: ${r.status} ${e.error?.message || ''}`);
  }
  console.log('\n✅ Champ "Date envoi" créé');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
