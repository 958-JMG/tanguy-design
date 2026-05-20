#!/usr/bin/env node
/**
 * Migration Airtable v2 — refonte fiche projet centrée projet (2026-04-28)
 *
 * Renomme les champs attachments existants pour clarifier la sémantique
 * et ajoute les champs manquants pour la nouvelle architecture.
 *
 * Idempotent : peut être relancé sans casse, chaque action vérifie l'état.
 *
 * Actions sur la table Projets :
 *   - "Plans devis"      → "Plan 3D"        (rename)
 *   - "Plans techniques" → "Plan technique" (rename)
 *   - "Images"           création si absent (multipleAttachments)
 *
 * Actions sur la table Devis :
 *   - "Type devis" création si absent (singleSelect: Principal | Additif)
 *   - Backfill : tous les records sans Type devis → "Principal"
 *
 * Actions sur la table Réunions Plaud :
 *   - "Niveau" création si absent (singleSelect: R1 | R2)
 *   - Backfill : tous les records sans Niveau → "R1"
 *
 * Usage :
 *   node scripts/setup-projet-fields-v2.js          # dry-run (lit + affiche le plan)
 *   node scripts/setup-projet-fields-v2.js --apply  # exécute
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
  projets: 'tbl9y74Gakhfwt6i1',
  devis: 'tblWklGEKMiBStXCs',
  plaud: 'tblWYGr3ETRWxrE63',
};

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` }});
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`);
  }
  return r.json();
}

async function renameField(tableId, fieldId, newName) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(`rename ${fieldId}→${newName}: ${r.status} ${e.error?.message || ''}`);
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

async function fetchAll(tableId) {
  let records = [], offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetchFn(u, { headers: { Authorization: `Bearer ${AT_KEY}` }});
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(`fetchAll ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}

async function patchBatch(tableId, records) {
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch, typecast: true })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(`patchBatch ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    results.push(...(d.records || []));
  }
  return results;
}

function findField(table, name) {
  return table.fields.find(f => f.name === name);
}

(async () => {
  console.log(APPLY ? '🚀 MODE APPLY — modifications réelles' : '🔍 DRY-RUN — aucune modification (relance avec --apply)');
  console.log('');

  const schema = await fetchSchema();
  const projets = schema.tables.find(t => t.id === TABLES.projets);
  const devis = schema.tables.find(t => t.id === TABLES.devis);
  const plaud = schema.tables.find(t => t.id === TABLES.plaud);
  if (!projets || !devis || !plaud) throw new Error('Une des tables est introuvable');

  const plan = [];
  const result = { renamed: [], created: [], backfilled: [] };

  // === 1. Table Projets : renames + Images ===
  console.log('=== Table Projets ===');

  const renames = [
    { from: 'Plans devis', to: 'Plan 3D' },
    { from: 'Plans techniques', to: 'Plan technique' },
  ];
  for (const { from, to } of renames) {
    const existingNew = findField(projets, to);
    const existingOld = findField(projets, from);
    if (existingNew) {
      console.log(`  ✓ "${to}" existe déjà → ${existingNew.id}`);
      result.renamed.push({ name: to, id: existingNew.id, action: 'noop' });
    } else if (existingOld) {
      console.log(`  → Rename "${from}" → "${to}" (${existingOld.id})`);
      plan.push({ kind: 'rename', tableId: TABLES.projets, fieldId: existingOld.id, newName: to });
      if (APPLY) {
        await renameField(TABLES.projets, existingOld.id, to);
        result.renamed.push({ name: to, id: existingOld.id, action: 'renamed' });
      } else {
        result.renamed.push({ name: to, id: existingOld.id, action: 'would-rename' });
      }
    } else {
      console.log(`  ⚠️  Ni "${from}" ni "${to}" — création de "${to}" comme attachment`);
      plan.push({ kind: 'create', tableId: TABLES.projets, body: { name: to, type: 'multipleAttachments' } });
      if (APPLY) {
        const c = await createField(TABLES.projets, {
          name: to,
          type: 'multipleAttachments',
          description: to === 'Plan 3D'
            ? 'Visualisations 3D Winner/Métron, plans d\'aménagement, dossiers de présentation client.'
            : 'Plans techniques avec cotes, plans archi, vues autocad, prise de cotes.'
        });
        result.created.push({ name: to, id: c.id });
      }
    }
  }

  // Images
  const imagesField = findField(projets, 'Images');
  if (imagesField) {
    console.log(`  ✓ "Images" existe déjà → ${imagesField.id}`);
    result.created.push({ name: 'Images', id: imagesField.id, action: 'noop' });
  } else {
    console.log(`  → Création "Images" (multipleAttachments)`);
    plan.push({ kind: 'create', tableId: TABLES.projets, body: { name: 'Images', type: 'multipleAttachments' } });
    if (APPLY) {
      const c = await createField(TABLES.projets, {
        name: 'Images',
        type: 'multipleAttachments',
        description: 'Photos chantier, références ambiance, moodboards. Tout visuel non technique.'
      });
      result.created.push({ name: 'Images', id: c.id });
    }
  }

  // === 2. Table Devis : Type devis ===
  console.log('');
  console.log('=== Table Devis ===');

  const typeDevisField = findField(devis, 'Type devis');
  if (typeDevisField) {
    console.log(`  ✓ "Type devis" existe déjà → ${typeDevisField.id}`);
  } else {
    console.log(`  → Création "Type devis" (singleSelect: Principal | Additif)`);
    plan.push({ kind: 'create', tableId: TABLES.devis, body: {
      name: 'Type devis',
      type: 'singleSelect',
      options: { choices: [{ name: 'Principal' }, { name: 'Additif' }] }
    }});
    if (APPLY) {
      const c = await createField(TABLES.devis, {
        name: 'Type devis',
        type: 'singleSelect',
        description: 'Principal = devis initial signé. Additif = ajout de prestations augmentant le projet.',
        options: { choices: [{ name: 'Principal' }, { name: 'Additif' }] }
      });
      result.created.push({ name: 'Type devis', id: c.id });

      // Backfill : tous les records existants sans Type devis → Principal
      console.log('    Backfill records sans "Type devis" → "Principal"…');
      const allDevis = await fetchAll(TABLES.devis);
      const toFix = allDevis.filter(r => !r.fields['Type devis']);
      if (toFix.length) {
        const patches = toFix.map(r => ({ id: r.id, fields: { 'Type devis': 'Principal' } }));
        await patchBatch(TABLES.devis, patches);
        console.log(`    ${toFix.length} devis backfillés en "Principal"`);
        result.backfilled.push({ table: 'devis', field: 'Type devis', count: toFix.length });
      } else {
        console.log('    aucun devis à backfiller');
      }
    }
  }

  // === 3. Table Réunions Plaud : Niveau ===
  console.log('');
  console.log('=== Table Réunions Plaud ===');

  const niveauField = findField(plaud, 'Niveau');
  if (niveauField) {
    console.log(`  ✓ "Niveau" existe déjà → ${niveauField.id}`);
  } else {
    console.log(`  → Création "Niveau" (singleSelect: R1 | R2)`);
    plan.push({ kind: 'create', tableId: TABLES.plaud, body: {
      name: 'Niveau',
      type: 'singleSelect',
      options: { choices: [{ name: 'R1' }, { name: 'R2' }] }
    }});
    if (APPLY) {
      const c = await createField(TABLES.plaud, {
        name: 'Niveau',
        type: 'singleSelect',
        description: 'R1 = découverte / avant chantier (découverte client, présentation devis). R2 = chantier / après pose (suivi chantier, SAV).',
        options: { choices: [{ name: 'R1' }, { name: 'R2' }] }
      });
      result.created.push({ name: 'Niveau', id: c.id });

      // Backfill : tous les records existants sans Niveau → R1
      console.log('    Backfill records sans "Niveau" → "R1"…');
      const allPlaud = await fetchAll(TABLES.plaud);
      const toFix = allPlaud.filter(r => !r.fields['Niveau']);
      if (toFix.length) {
        const patches = toFix.map(r => ({ id: r.id, fields: { 'Niveau': 'R1' } }));
        await patchBatch(TABLES.plaud, patches);
        console.log(`    ${toFix.length} réunions backfillées en "R1"`);
        result.backfilled.push({ table: 'plaud', field: 'Niveau', count: toFix.length });
      } else {
        console.log('    aucune réunion à backfiller');
      }
    }
  }

  // === Résumé ===
  console.log('');
  console.log('=== Résumé ===');
  if (!APPLY) {
    console.log(`Plan : ${plan.length} action(s) à exécuter (relance avec --apply)`);
    plan.forEach((p, i) => {
      if (p.kind === 'rename') console.log(`  ${i+1}. RENAME ${p.fieldId} → "${p.newName}"`);
      else if (p.kind === 'create') console.log(`  ${i+1}. CREATE field "${p.body.name}" (${p.body.type}) on ${p.tableId}`);
    });
  } else {
    console.log(`Renommés    : ${result.renamed.filter(r => r.action === 'renamed').length}`);
    console.log(`Créés       : ${result.created.length}`);
    console.log(`Backfillés  : ${result.backfilled.reduce((s,b)=>s+b.count, 0)} records`);
    console.log('');
    console.log('Prochaine étape : mettre à jour PROJET_ATTACHMENT_FIELDS dans server.js');
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
