#!/usr/bin/env node
/**
 * Migration Airtable — ajout des champs "Montant AR" + "Date AR" sur Commandes (2026-06-09)
 *
 * Contexte (P1a) : la card Fournisseurs et la marge de la fiche projet doivent
 * s'appuyer sur le montant RÉEL confirmé par le fournisseur (accusé de réception
 * de commande), pas sur le montant estimé depuis le devis à la signature.
 *  - "Montant AR" : montant HT confirmé par le fournisseur sur son AR.
 *    → cloné sur le type/options du champ existant "Montant HT" (cohérence devise).
 *  - "Date AR"    : date de réception de l'AR.
 * Le champ "Montant HT" existant reste : il devient le montant ESTIMÉ (devis).
 *
 * Idempotent : peut être relancé. N'écrase rien.
 *
 * Usage :
 *   node scripts/setup-commande-ar.js          # dry-run
 *   node scripts/setup-commande-ar.js --apply  # exécute
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

const COMMANDES_TABLE_ID = 'tblDynhnhLXb4Ibs2';
const MONTANT_AR = 'Montant AR';
const DATE_AR = 'Date AR';
const MONTANT_HT = 'Montant HT'; // champ modèle à cloner pour Montant AR

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
  console.log(`[setup-commande-ar] mode=${APPLY?'APPLY':'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const cmdTable = schema.tables.find(t => t.id === COMMANDES_TABLE_ID);
  if (!cmdTable) {
    console.error(`Table Commandes ${COMMANDES_TABLE_ID} introuvable.`);
    process.exit(1);
  }

  // Champ modèle "Montant HT" → on clone son type/options pour "Montant AR"
  const montantHt = cmdTable.fields.find(f => f.name === MONTANT_HT);
  if (!montantHt) {
    console.error(`Champ modèle "${MONTANT_HT}" introuvable sur Commandes — abandon (on ne devine pas le type devise).`);
    process.exit(1);
  }
  console.log(`Modèle "${MONTANT_HT}" : type=${montantHt.type}${montantHt.options ? ' options=' + JSON.stringify(montantHt.options) : ''}`);

  const plan = [
    {
      name: MONTANT_AR,
      type: montantHt.type,
      ...(montantHt.options ? { options: montantHt.options } : {}),
    },
    {
      name: DATE_AR,
      type: 'date',
      options: { dateFormat: { name: 'european', format: 'D/M/YYYY' } },
    },
  ];

  for (const body of plan) {
    const existing = cmdTable.fields.find(f => f.name === body.name);
    if (existing) {
      console.log(`✓ Champ "${body.name}" existe déjà (id=${existing.id}, type=${existing.type}). Rien à faire.`);
      continue;
    }
    if (!APPLY) {
      console.log(`[DRY-RUN] créerait le champ "${body.name}" type=${body.type}${body.options ? ' options=' + JSON.stringify(body.options) : ''}`);
      continue;
    }
    const created = await createField(COMMANDES_TABLE_ID, body);
    console.log(`✓ Créé champ "${body.name}" id=${created.id} type=${body.type}.`);
  }

  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-commande-ar.js --apply`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
