#!/usr/bin/env node
/**
 * Migration Airtable v3 — Sprint 1 pivot client-centric (2026-05-20)
 *
 * Idempotent : peut être relancé sans casse, chaque action vérifie l'état.
 *
 * Actions sur la table Clients :
 *   - "Architecte référent" : création si absent (multipleRecordLinks → Clients)
 *   - "Date création" : création si absent (date)
 *   - Ajout valeur "Architecte" à l'enum "Type" (si pas déjà présente)
 *
 * Actions sur la table Projets :
 *   - "Phase commerciale" : création si absent
 *       singleSelect: Découverte | Dessin | Présentation devis | En attente décision | Signé
 *   - "Statut chantier" : création si absent
 *       singleSelect: Pré-pose | Pose en cours | Terminé | SAV | Archivé
 *   - "Date pose fin" : création si absent (date)
 *   - Backfill : mapping Statut legacy → Phase commerciale + Statut chantier
 *
 * Mapping Statut → (Phase commerciale, Statut chantier) :
 *   Découverte           → Découverte, (vide)
 *   Dessin               → Dessin, (vide)
 *   Présentation         → Dessin, (vide)
 *   Devis                → Présentation devis, (vide)
 *   Présentation devis   → Présentation devis, (vide)
 *   En attente décision  → En attente décision, (vide)
 *   Signé                → Signé, Pré-pose
 *   Pose / Pose en cours → Signé, Pose en cours
 *   Terminé              → Signé, Terminé
 *   SAV                  → Signé, SAV
 *   Archivé              → Signé, Archivé
 *   (inconnu / vide)     → Découverte, (vide)
 *
 * Usage :
 *   node scripts/setup-fields-v3.js          # dry-run (lit + affiche le plan)
 *   node scripts/setup-fields-v3.js --apply  # exécute
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

const TABLES = {
  clients: 'tbl2zmxpWWzbY1wT0',
  projets: 'tbl9y74Gakhfwt6i1',
};

// --- Helpers Airtable Meta API ---
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

async function patchField(tableId, fieldId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`patch field ${fieldId}: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

async function fetchAll(tableId) {
  let records = [], offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetchFn(u, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) throw new Error(`fetchAll ${tableId}: ${r.status}`);
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}

async function patchBatch(tableId, records) {
  if (!records.length) return [];
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(`patchBatch ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    results.push(...(d.records || []));
  }
  return results;
}

const findField = (table, name) => table.fields.find(f => f.name === name);

// --- Mapping Statut legacy → (Phase commerciale, Statut chantier) ---
function mapStatutLegacy(s) {
  const lo = (s || '').toLowerCase().trim();
  if (!lo)                                            return { phase: 'Découverte', chantier: null };
  if (/(découverte|decouverte)/.test(lo))             return { phase: 'Découverte', chantier: null };
  if (/(dessin|présentation projet)/.test(lo))        return { phase: 'Dessin', chantier: null };
  if (/(présentation devis|presentation devis)/.test(lo))         return { phase: 'Présentation devis', chantier: null };
  if (lo === 'devis')                                 return { phase: 'Présentation devis', chantier: null };
  if (/attente/.test(lo))                             return { phase: 'En attente décision', chantier: null };
  if (/(pose en cours|pose)/.test(lo) && !/sav/.test(lo)) return { phase: 'Signé', chantier: 'Pose en cours' };
  if (/(terminé|termine)/.test(lo))                   return { phase: 'Signé', chantier: 'Terminé' };
  if (/sav/.test(lo))                                 return { phase: 'Signé', chantier: 'SAV' };
  if (/archiv/.test(lo))                              return { phase: 'Signé', chantier: 'Archivé' };
  if (/(signé|signe)/.test(lo))                       return { phase: 'Signé', chantier: 'Pré-pose' };
  // Inconnu : fallback prudent (Découverte, vide)
  return { phase: 'Découverte', chantier: null, unknown: s };
}

// --- Plan d'actions sur les 2 tables ---
async function planClients(schema) {
  const t = schema.tables.find(x => x.id === TABLES.clients);
  if (!t) throw new Error('Table Clients introuvable');
  const actions = [];

  // 1. Type enum : ajouter "Architecte" si absent
  const typeField = findField(t, 'Type');
  if (typeField) {
    const choices = typeField.options?.choices || [];
    if (!choices.find(c => c.name === 'Architecte')) {
      actions.push({
        kind: 'patch-enum',
        label: 'Type → +Architecte',
        run: () => patchField(TABLES.clients, typeField.id, {
          options: { choices: [...choices.map(c => ({ name: c.name })), { name: 'Architecte' }] }
        }),
      });
    }
  } else {
    console.warn('⚠️  Table Clients sans champ "Type" — création non prévue dans ce script');
  }

  // 2. Champ "Architecte référent" (linked Clients, multi)
  if (!findField(t, 'Architecte référent')) {
    actions.push({
      kind: 'create',
      label: 'Architecte référent (linked Clients, multi)',
      run: () => createField(TABLES.clients, {
        name: 'Architecte référent',
        type: 'multipleRecordLinks',
        options: { linkedTableId: TABLES.clients },
      }),
    });
  }

  // 3. Champ "Date création" (date)
  if (!findField(t, 'Date création')) {
    actions.push({
      kind: 'create',
      label: 'Date création (date)',
      run: () => createField(TABLES.clients, {
        name: 'Date création',
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
      }),
    });
  }

  return actions;
}

async function planProjets(schema) {
  const t = schema.tables.find(x => x.id === TABLES.projets);
  if (!t) throw new Error('Table Projets introuvable');
  const actions = [];

  // 1. Phase commerciale (singleSelect)
  if (!findField(t, 'Phase commerciale')) {
    actions.push({
      kind: 'create',
      label: 'Phase commerciale (singleSelect)',
      run: () => createField(TABLES.projets, {
        name: 'Phase commerciale',
        type: 'singleSelect',
        options: { choices: [
          { name: 'Découverte', color: 'grayLight2' },
          { name: 'Dessin', color: 'blueLight2' },
          { name: 'Présentation devis', color: 'cyanLight2' },
          { name: 'En attente décision', color: 'yellowLight2' },
          { name: 'Signé', color: 'greenLight2' },
        ]},
      }),
    });
  }

  // 2. Statut chantier (singleSelect)
  if (!findField(t, 'Statut chantier')) {
    actions.push({
      kind: 'create',
      label: 'Statut chantier (singleSelect)',
      run: () => createField(TABLES.projets, {
        name: 'Statut chantier',
        type: 'singleSelect',
        options: { choices: [
          { name: 'Pré-pose', color: 'blueLight2' },
          { name: 'Pose en cours', color: 'orangeLight2' },
          { name: 'Terminé', color: 'greenLight2' },
          { name: 'SAV', color: 'redLight2' },
          { name: 'Archivé', color: 'grayLight2' },
        ]},
      }),
    });
  }

  // 3. Date pose fin (date)
  if (!findField(t, 'Date pose fin')) {
    actions.push({
      kind: 'create',
      label: 'Date pose fin (date)',
      run: () => createField(TABLES.projets, {
        name: 'Date pose fin',
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
      }),
    });
  }

  return actions;
}

// --- Backfill mapping Statut legacy → Phase + Chantier ---
async function backfillProjets() {
  console.log('\n=== Backfill Projets ===');
  const projets = await fetchAll(TABLES.projets);
  console.log(`  ${projets.length} projets à analyser`);

  const updates = [];
  const unknowns = [];
  for (const p of projets) {
    const f = p.fields;
    // Skip si déjà set (idempotent)
    if (f['Phase commerciale']) continue;
    const { phase, chantier, unknown } = mapStatutLegacy(f['Statut']);
    const fields = { 'Phase commerciale': phase };
    if (chantier) fields['Statut chantier'] = chantier;
    updates.push({ id: p.id, fields });
    if (unknown) unknowns.push({ id: p.id, ref: f['Référence'], statutInconnu: unknown });
  }

  console.log(`  ${updates.length} projets à updater`);
  if (unknowns.length) {
    console.log(`  ⚠️  ${unknowns.length} statuts inconnus (mappés en Découverte par défaut) :`);
    unknowns.forEach(u => console.log(`     - ${u.ref || u.id} : Statut="${u.statutInconnu}"`));
  }

  if (!updates.length) {
    console.log('  ✅ Aucun backfill nécessaire (tous les projets ont déjà Phase commerciale)');
    return 0;
  }

  // Preview des 5 premiers updates
  console.log('\n  Preview des 5 premiers updates :');
  updates.slice(0, 5).forEach(u => {
    const p = projets.find(x => x.id === u.id);
    console.log(`     - ${p.fields['Référence'] || u.id} : Statut="${p.fields['Statut']}" → Phase="${u.fields['Phase commerciale']}", Chantier="${u.fields['Statut chantier'] || '(vide)'}"`);
  });

  if (APPLY) {
    console.log('\n  🚀 Application en cours…');
    await patchBatch(TABLES.projets, updates);
    console.log(`  ✓ ${updates.length} projets updatés`);
    return updates.length;
  } else {
    console.log('\n  🧪 Dry-run — relance avec --apply pour exécuter');
    return 0;
  }
}

(async () => {
  console.log(APPLY ? '🚀 MODE APPLY' : '🔍 DRY-RUN — aucune modification (relance avec --apply)\n');

  const schema = await fetchSchema();

  // === Plan ===
  const clientsActions = await planClients(schema);
  const projetsActions = await planProjets(schema);

  console.log('=== Table Clients ===');
  if (clientsActions.length === 0) console.log('  ✅ Aucun changement nécessaire');
  else clientsActions.forEach(a => console.log(`  [${a.kind}] ${a.label}`));

  console.log('\n=== Table Projets ===');
  if (projetsActions.length === 0) console.log('  ✅ Aucun changement nécessaire');
  else projetsActions.forEach(a => console.log(`  [${a.kind}] ${a.label}`));

  // === Apply ===
  if (APPLY && (clientsActions.length || projetsActions.length)) {
    console.log('\n🚀 Application des changements de schéma…');
    for (const a of [...clientsActions, ...projetsActions]) {
      console.log(`  → ${a.label}`);
      await a.run();
      console.log(`    ✓`);
    }
  }

  // Re-fetch schema après création des champs (sinon le backfill peut échouer)
  if (APPLY && projetsActions.some(a => a.kind === 'create')) {
    console.log('\n  ⏱  Pause 2s pour propagation schéma…');
    await new Promise(r => setTimeout(r, 2000));
  }

  // === Backfill ===
  const backfillCount = await backfillProjets();

  console.log('\n' + (APPLY ? '✅ Terminé' : '🧪 Dry-run terminé — relance avec --apply'));
  console.log(`  Champs Clients à créer : ${clientsActions.length}`);
  console.log(`  Champs Projets à créer : ${projetsActions.length}`);
  console.log(`  Projets à backfiller    : ${backfillCount || '0'}`);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
