#!/usr/bin/env node
/**
 * Purge des données legacy 2026-04-28/29.
 *
 * Suite à l'import massif WeTransfer (16 dossiers / 503 fichiers) et aux commandes/tâches
 * auto-générées par /api/devis/sign sur devis legacy, repartir d'une base saine.
 *
 * Modes :
 *   (défaut) : Tâches + Commandes + vidage des 4 zones attachments des projets
 *   --full   : ci-dessus + Devis (+ zones/lignes/échéances) + Devis Artisans + Réunions Plaud
 *              + Fiches découverte + Stock + Projets + SAV + Clients
 *
 * TOUJOURS préservé (référentiels) : Artisans · Fournisseurs.
 *
 * Idempotent : peut être relancé (PATCH sur attachments, DELETE par ID sur le reste).
 *
 * Usage :
 *   node scripts/purge-legacy-data.js                  # dry-run minimal
 *   node scripts/purge-legacy-data.js --apply          # apply minimal
 *   node scripts/purge-legacy-data.js --full           # dry-run tabula rasa
 *   node scripts/purge-legacy-data.js --full --apply   # APPLY tabula rasa
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY.
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
const fetchFn = globalThis.fetch || require('node-fetch');

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const FULL = process.argv.includes('--full');

const TABLES = {
  clients:               'tbl2zmxpWWzbY1wT0',
  projets:               'tbl9y74Gakhfwt6i1',
  artisans:              'tblWxbLpwHNagDKfJ', // PRÉSERVÉ
  fournisseurs:          'tblz1AZIKkn9VCbkR', // PRÉSERVÉ
  commandes:             'tblDynhnhLXb4Ibs2',
  taches:                'tblDwUHL16LBVMSaz',
  sav:                   'tbl8ErWw6zhXLfCII',
  'fiches-decouverte':   'tblU5trwFCofUQcQY',
  'reunions-plaud':      'tblWYGr3ETRWxrE63',
  devis:                 'tblWklGEKMiBStXCs',
  'zones-devis':         'tbl6FmEIIR15NMsgZ',
  'lignes-devis':        'tblCxDvzQAqBzpCx2',
  'echeances-devis':     'tblML7D7MXeWnMcxy',
  stock:                 'tblENw2eBplwUZ4nd',
  'devis-artisans':      'tblFxsJtEYpDOmQQj',
};

const ATTACHMENT_FIELDS = ['Plan 3D', 'Plan technique', 'Images', 'Documents projet'];

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

// Airtable DELETE batch : query ?records[]=id1&records[]=id2 (max 10)
async function deleteBatch(tableId, ids) {
  const deleted = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    batch.forEach(id => u.searchParams.append('records[]', id));
    const r = await fetchFn(u, { method: 'DELETE', headers: { Authorization: `Bearer ${AT_KEY}` }});
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(`deleteBatch ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    deleted.push(...(d.records || []));
  }
  return deleted;
}

async function patchBatch(tableId, records) {
  const out = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(`patchBatch ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    out.push(...(d.records || []));
  }
  return out;
}

// Tables à purger en mode minimal (delete all sauf projets : on vide juste les attachments)
const MINIMAL_DELETE = ['taches', 'commandes'];
// Tables à ajouter en mode --full (delete all records)
// Ordre : enfants avant parents (Airtable n'a pas de cascade, mais évite les liens orphelins visibles).
const FULL_DELETE = [
  'lignes-devis', 'zones-devis', 'echeances-devis',
  'devis', 'devis-artisans',
  'reunions-plaud', 'fiches-decouverte',
  'sav', 'stock',
  'projets',  // en dernier (clients = référentiel préservé)
];
// Référentiels préservés (carnet d'adresse + équipes externes).
const PRESERVED = ['artisans', 'fournisseurs', 'clients'];

(async () => {
  console.log(APPLY ? '🚨 MODE APPLY — SUPPRESSIONS RÉELLES' : '🔍 DRY-RUN — aucune modification (relance avec --apply)');
  console.log(FULL ? `🔥 MODE --full : tabula rasa sauf référentiels (${PRESERVED.join(', ')})` : '🧹 MODE minimal : tâches + commandes + attachments des projets');
  console.log('');

  const summary = { deleted: {}, attachments: 0, projetsCleared: 0 };

  // === 1. Suppressions de records (tables) ===
  const tablesToDelete = FULL ? [...MINIMAL_DELETE, ...FULL_DELETE] : MINIMAL_DELETE;
  for (const key of tablesToDelete) {
    const tableId = TABLES[key];
    const records = await fetchAll(tableId);
    summary.deleted[key] = records.length;
    console.log(`=== Table ${key} ===`);
    console.log(`  ${records.length} record(s) à supprimer`);
    if (records.length) {
      const sample = records.slice(0, 4).map(r => {
        const f = r.fields || {};
        return f['Numéro devis'] || f['Numéro'] || f.Titre || f.Référence || f.Nom || f['Type réunion'] || r.id;
      });
      console.log(`    ex : ${sample.join(' · ')}${records.length > 4 ? ` ... +${records.length - 4}` : ''}`);
    }
    if (APPLY && records.length) {
      await deleteBatch(tableId, records.map(r => r.id));
      console.log(`  ✓ ${records.length} record(s) supprimé(s)`);
    }
    console.log('');
  }

  // === 2. Attachments des projets — uniquement en mode minimal (en --full les projets sont supprimés) ===
  if (!FULL) {
    console.log('=== Attachments des projets ===');
    const projets = await fetchAll(TABLES.projets);
    let totalAttachments = 0;
    const patchesAttach = [];
    for (const p of projets) {
      const fieldsToClear = {};
      let count = 0;
      for (const fname of ATTACHMENT_FIELDS) {
        const arr = p.fields[fname];
        if (Array.isArray(arr) && arr.length) {
          count += arr.length;
          fieldsToClear[fname] = [];
        }
      }
      if (count > 0) {
        totalAttachments += count;
        patchesAttach.push({ id: p.id, fields: fieldsToClear, ref: p.fields.Référence || p.id });
      }
    }
    summary.attachments = totalAttachments;
    summary.projetsCleared = patchesAttach.length;
    console.log(`  ${patchesAttach.length} projet(s) avec attachments · total ${totalAttachments} fichier(s)`);
    patchesAttach.slice(0, 6).forEach(pp => {
      const proj = projets.find(p=>p.id===pp.id);
      const detail = ATTACHMENT_FIELDS.map(f => {
        const c = (proj.fields[f]||[]).length;
        return c > 0 ? `${f}=${c}` : null;
      }).filter(Boolean).join(', ');
      console.log(`    - ${pp.ref} (${detail})`);
    });
    if (patchesAttach.length > 6) console.log(`    ... + ${patchesAttach.length - 6} autres projets`);
    if (APPLY && patchesAttach.length) {
      await patchBatch(TABLES.projets, patchesAttach.map(({ id, fields }) => ({ id, fields })));
      console.log(`  ✓ ${patchesAttach.length} projets vidés (${totalAttachments} fichiers détachés)`);
    }
    console.log('');
  }

  // === Résumé ===
  console.log('=== Résumé ===');
  const total = Object.values(summary.deleted).reduce((s,n)=>s+n, 0);
  if (!APPLY) {
    console.log(`Plan : ${total} record(s) à supprimer dans ${Object.keys(summary.deleted).length} table(s)`);
    Object.entries(summary.deleted).forEach(([k,n]) => n > 0 && console.log(`  • ${k}: ${n}`));
    if (!FULL) console.log(`  + ${summary.attachments} fichiers attachés à détacher (${summary.projetsCleared} projets)`);
    console.log('');
    console.log(FULL
      ? 'Pour APPLIQUER : node scripts/purge-legacy-data.js --full --apply'
      : 'Pour APPLIQUER : node scripts/purge-legacy-data.js --apply');
  } else {
    console.log(`Supprimés : ${total} record(s)`);
    Object.entries(summary.deleted).forEach(([k,n]) => n > 0 && console.log(`  • ${k}: ${n}`));
    if (!FULL && summary.attachments) console.log(`Détachés  : ${summary.attachments} fichiers sur ${summary.projetsCleared} projets`);
    console.log('');
    console.log(`Préservés : ${PRESERVED.join(', ')} (référentiels).`);
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
