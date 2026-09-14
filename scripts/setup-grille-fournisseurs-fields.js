#!/usr/bin/env node
/**
 * Migration Airtable — Grille fournisseurs (JMG 2026-09-14)
 *
 * Ajoute sur la table Fournisseurs le champ multi-sélection "Catégories" (les 6
 * familles de la grille), qui pilote le routage AUTOMATIQUE des commandes à la
 * signature du devis (services/fournisseur-grille.js). Un fournisseur peut en
 * cocher plusieurs (ex. Bradano/Franke = Évier + Robinetterie).
 *
 * Idempotent : si le champ existe, complète les options manquantes ; sinon le crée.
 *
 * Usage :
 *   node scripts/setup-grille-fournisseurs-fields.js          # dry-run
 *   node scripts/setup-grille-fournisseurs-fields.js --apply  # exécute
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
const FOURNISSEURS_TABLE = 'tblz1AZIKkn9VCbkR';
// Doit rester aligné sur CATEGORIES_GRILLE (services/fournisseur-grille.js).
const CATEGORIES = ['Meuble', 'Plan de travail', 'Électroménager', 'Évier', 'Robinetterie', 'Crédence'];

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
async function patchField(tableId, fieldId, body) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`patch ${fieldId}: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
  return r.json();
}

(async () => {
  console.log(APPLY ? '🚀 APPLY — modifications réelles' : '🔍 DRY-RUN — relance avec --apply');
  const schema = await fetchSchema();
  const table = schema.tables.find(t => t.id === FOURNISSEURS_TABLE);
  if (!table) throw new Error('Table Fournisseurs introuvable');
  const champ = table.fields.find(f => f.name === 'Catégories');
  const choices = CATEGORIES.map(name => ({ name }));

  if (!champ) {
    console.log('  → Création "Catégories" (multipleSelects) avec 6 options');
    if (APPLY) { const c = await createField(FOURNISSEURS_TABLE, { name: 'Catégories', type: 'multipleSelects', description: 'Familles de produits couvertes (routage des commandes à la signature).', options: { choices } }); console.log(`    créé → ${c.id}`); }
  } else {
    const present = new Set((champ.options?.choices || []).map(c => c.name));
    const manquantes = CATEGORIES.filter(c => !present.has(c));
    if (!manquantes.length) { console.log('  ✓ "Catégories" existe avec les 6 options'); }
    else {
      console.log(`  → Complète les options manquantes : ${manquantes.join(', ')}`);
      // PATCH options : on renvoie les choix EXISTANTS (avec leur id) + les nouveaux.
      const merged = [...(champ.options?.choices || []).map(c => ({ id: c.id, name: c.name })), ...manquantes.map(name => ({ name }))];
      if (APPLY) { await patchField(FOURNISSEURS_TABLE, champ.id, { options: { choices: merged } }); console.log('    options complétées'); }
    }
  }
  console.log(APPLY ? '✅ Terminé' : '(dry-run terminé)');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
