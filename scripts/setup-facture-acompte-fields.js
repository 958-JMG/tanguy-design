#!/usr/bin/env node
/**
 * Migration Airtable — Facture d'acompte % libre (JMG 2026-09-14)
 *
 * Ajoute sur la table Devis les champs qui mémorisent la facture d'acompte
 * générée dans Pennylane (idempotence + PDF par devis) :
 *   - "Pennylane acompte ID" (singleLineText) — id de la facture brouillon
 *   - "Pennylane acompte %"  (number, 0 décimale par défaut) — pourcentage retenu
 *
 * Idempotent : relançable sans casse (chaque champ est créé seulement s'il manque).
 *
 * Usage :
 *   node scripts/setup-facture-acompte-fields.js          # dry-run
 *   node scripts/setup-facture-acompte-fields.js --apply  # exécute
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
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const DEVIS_TABLE = 'tblWklGEKMiBStXCs';

async function fetchSchema() {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) throw new Error(`schema fetch: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
  return r.json();
}
async function createField(tableId, body) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST', headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`create ${body.name}: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
  return r.json();
}

const CHAMPS = [
  { name: 'Pennylane acompte ID', type: 'singleLineText', description: 'Id de la facture d\'acompte brouillon créée dans Pennylane (idempotence + PDF).' },
  { name: 'Pennylane acompte %', type: 'number', options: { precision: 0 }, description: 'Pourcentage d\'acompte retenu à la dernière génération.' },
];

(async () => {
  console.log(APPLY ? '🚀 APPLY — modifications réelles' : '🔍 DRY-RUN — relance avec --apply');
  const schema = await fetchSchema();
  const devis = schema.tables.find(t => t.id === DEVIS_TABLE);
  if (!devis) throw new Error('Table Devis introuvable');
  for (const champ of CHAMPS) {
    const existing = devis.fields.find(f => f.name === champ.name);
    if (existing) { console.log(`  ✓ "${champ.name}" existe déjà (${existing.id})`); continue; }
    console.log(`  → Création "${champ.name}" (${champ.type})`);
    if (APPLY) { const c = await createField(DEVIS_TABLE, champ); console.log(`    créé → ${c.id}`); }
  }
  console.log(APPLY ? '✅ Terminé' : '(dry-run terminé)');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
