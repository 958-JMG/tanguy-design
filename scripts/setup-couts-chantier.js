#!/usr/bin/env node
/**
 * Migration Airtable — Coûts chantier & retenue client (paquet 1, 2026-08)
 *
 * Crée :
 *   1. Une table « Coûts chantier » (coûts additionnels non prévus au devis :
 *      SAV/reprise, transport, compléments, frais divers), avec les champs :
 *        - Libellé        (singleLineText, primaire)
 *        - Type           (singleSelect : SAV / reprise | Transport / livraison |
 *                          Complément commande | Frais divers)
 *        - Montant HT     (currency, options reprises de « Budget HT » sur Projets)
 *        - Payé par       (singleSelect : Tanguy (sur marge) | Refacturé client)
 *        - Statut         (singleSelect : Prévu | Engagé | Payé)
 *        - Date           (date)
 *        - Tiers          (singleLineText — fournisseur / artisan concerné)
 *        - Note           (multilineText)
 *   2. Un lien « Coûts chantier » sur la table Projets (→ symétrique « Projets »
 *      auto-créé sur la table Coûts chantier).
 *   3. Les champs de RETENUE client sur Projets :
 *        - Retenue montant        (currency)
 *        - Retenue type           (singleSelect : Retenue de garantie (loi 1971) |
 *                                  Retenue SAV / réserves | Autre)
 *        - Retenue motif          (singleLineText)
 *        - Retenue statut         (singleSelect : En cours | Levée / encaissée | Abandonnée)
 *        - Retenue date           (date)
 *        - Retenue levée prévue   (date)
 *
 * Idempotent : chaque création vérifie l'existence avant d'agir (par nom). Re-run safe.
 * Ne modifie JAMAIS un champ existant (règle dure).
 *
 * Usage :
 *   node scripts/setup-couts-chantier.js          # dry-run (lit + affiche le plan)
 *   node scripts/setup-couts-chantier.js --apply  # exécute
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token scope schema.bases:write).
 * À la fin, IMPRIME l'id de la table Coûts chantier → à coller dans server.js
 * (const TABLES → 'couts-chantier').
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
const PROJETS_TBL = 'tbl9y74Gakhfwt6i1';
const TABLE_NAME = 'Coûts chantier';

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

async function createTable(body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`create table ${body.name}: ${r.status} ${e.error?.message || ''}`);
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
    throw new Error(`create field ${body.name}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

const findField = (table, name) => table.fields.find(f => f.name === name);

async function main() {
  console.log(APPLY ? '🚀 MODE APPLY\n' : '🔍 DRY-RUN — aucune modification (relance avec --apply)\n');

  let schema = await fetchSchema();
  const projets = schema.tables.find(t => t.id === PROJETS_TBL);
  if (!projets) throw new Error('Table Projets introuvable');

  // Options devise reprises de « Budget HT » (précision + symbole cohérents).
  const budgetHt = findField(projets, 'Budget HT');
  const currencyType = budgetHt?.type === 'currency' ? 'currency' : 'currency';
  const currencyOptions = budgetHt?.options || { precision: 2, symbol: '€' };
  console.log(`Devise de référence (« Budget HT ») : type=${budgetHt?.type} options=${JSON.stringify(budgetHt?.options || {})}\n`);

  const dateOptions = { dateFormat: { name: 'european', format: 'D/M/YYYY' } };

  // ── 1. Table Coûts chantier ────────────────────────────────────────────────
  let coutsTable = schema.tables.find(t => t.name === TABLE_NAME);
  if (coutsTable) {
    console.log(`=== Table « ${TABLE_NAME} » ===\n  ✅ Existe déjà (id=${coutsTable.id})`);
  } else if (!APPLY) {
    console.log(`=== Table « ${TABLE_NAME} » ===\n  [DRY-RUN] créerait la table + 8 champs`);
  } else {
    console.log(`=== Table « ${TABLE_NAME} » ===\n  → création…`);
    const created = await createTable({
      name: TABLE_NAME,
      description: 'Coûts additionnels de chantier non prévus au devis (SAV, transport, compléments, frais divers).',
      fields: [
        { name: 'Libellé', type: 'singleLineText' },
        { name: 'Type', type: 'singleSelect', options: { choices: [
          { name: 'SAV / reprise', color: 'redLight2' },
          { name: 'Transport / livraison', color: 'blueLight2' },
          { name: 'Complément commande', color: 'yellowLight2' },
          { name: 'Frais divers', color: 'grayLight2' },
        ] } },
        { name: 'Montant HT', type: currencyType, options: currencyOptions },
        { name: 'Payé par', type: 'singleSelect', options: { choices: [
          { name: 'Tanguy (sur marge)', color: 'orangeLight2' },
          { name: 'Refacturé client', color: 'greenLight2' },
        ] } },
        { name: 'Statut', type: 'singleSelect', options: { choices: [
          { name: 'Prévu', color: 'grayLight2' },
          { name: 'Engagé', color: 'yellowLight2' },
          { name: 'Payé', color: 'greenLight2' },
        ] } },
        { name: 'Date', type: 'date', options: dateOptions },
        { name: 'Tiers', type: 'singleLineText' },
        { name: 'Note', type: 'multilineText' },
      ],
    });
    coutsTable = created;
    console.log(`  ✓ Table créée id=${created.id}`);
  }

  // ── 2. Lien Projets ↔ Coûts chantier ───────────────────────────────────────
  // On crée le lien DEPUIS Projets → « Coûts chantier » (le symétrique « Projets »
  // est auto-créé sur la table Coûts chantier). Nécessite l'id de la table cible.
  const coutsTblId = coutsTable?.id;
  if (!findField(projets, 'Coûts chantier')) {
    if (!APPLY) {
      console.log(`\n=== Lien Projets → « Coûts chantier » ===\n  [DRY-RUN] créerait le lien (nécessite la table créée)`);
    } else if (!coutsTblId) {
      console.log('\n⚠️  Table Coûts chantier absente — lien non créé (relance le script).');
    } else {
      const f = await createField(PROJETS_TBL, {
        name: 'Coûts chantier',
        type: 'multipleRecordLinks',
        options: { linkedTableId: coutsTblId },
      });
      console.log(`\n=== Lien Projets → « Coûts chantier » ===\n  ✓ Créé id=${f.id} (symétrique « Projets » auto-créé sur la table Coûts chantier)`);
    }
  } else {
    console.log(`\n=== Lien Projets → « Coûts chantier » ===\n  ✅ Existe déjà`);
  }

  // ── 3. Champs Retenue sur Projets ───────────────────────────────────────────
  const retenuePlan = [
    { name: 'Retenue montant', type: currencyType, options: currencyOptions },
    { name: 'Retenue type', type: 'singleSelect', options: { choices: [
      { name: 'Retenue de garantie (loi 1971)', color: 'purpleLight2' },
      { name: 'Retenue SAV / réserves', color: 'orangeLight2' },
      { name: 'Autre', color: 'grayLight2' },
    ] } },
    { name: 'Retenue motif', type: 'singleLineText' },
    { name: 'Retenue statut', type: 'singleSelect', options: { choices: [
      { name: 'En cours', color: 'yellowLight2' },
      { name: 'Levée / encaissée', color: 'greenLight2' },
      { name: 'Abandonnée', color: 'redLight2' },
    ] } },
    { name: 'Retenue date', type: 'date', options: dateOptions },
    { name: 'Retenue levée prévue', type: 'date', options: dateOptions },
  ];

  console.log('\n=== Champs Retenue sur Projets ===');
  for (const body of retenuePlan) {
    if (findField(projets, body.name)) {
      console.log(`  ✅ « ${body.name} » existe déjà`);
      continue;
    }
    if (!APPLY) {
      console.log(`  [DRY-RUN] créerait « ${body.name} » (${body.type})`);
      continue;
    }
    const created = await createField(PROJETS_TBL, body);
    console.log(`  ✓ Créé « ${body.name} » id=${created.id}`);
  }

  if (APPLY && coutsTblId) {
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`✅ Terminé. COLLE cet id dans server.js (const TABLES) :`);
    console.log(`   'couts-chantier': { id: '${coutsTblId}', name: '${TABLE_NAME}' },`);
    console.log('────────────────────────────────────────────────────────');
  } else if (!APPLY) {
    console.log('\n🧪 Dry-run terminé — relance avec --apply pour exécuter.');
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
