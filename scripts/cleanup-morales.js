#!/usr/bin/env node
/**
 * Cleanup MORALES — fusion des 3 projets MORALES en 1 + uniformisation référence
 *
 * Garde : recVFl0ZVEIRKXBXI ("Morales", créé par batch V2 — contient attachments + nouveaux devis/cmds)
 * Fusionne : recooo0jBsCqkkaZA + recyDzLP0wuCyaQSB ("MORALES · CUISINE" doublons pré-existants)
 *
 * Étapes :
 *   1. Re-lier toutes les commandes / devis / devis-artisans / tâches liées aux doublons → au projet principal
 *   2. Renommer le projet principal en "563 — Morales" (n° Winner déduit des cmds 563/1/12-*)
 *   3. Ajouter Notes "Auto-générée via signature devis 563/1/12" aux 8 commandes pré-existantes
 *   4. Supprimer les 2 projets doublons
 *
 * Usage :
 *   node scripts/cleanup-morales.js              # dry-run
 *   node scripts/cleanup-morales.js --execute    # live
 */
const fs = require('fs');
const path = require('path');
if (!process.env.AIRTABLE_KEY) {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach(l => { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
}
const fetchFn = globalThis.fetch || require('node-fetch');
const EXECUTE = process.argv.includes('--execute');
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;

const KEEP = 'recVFl0ZVEIRKXBXI';
const MERGE = ['recooo0jBsCqkkaZA', 'recyDzLP0wuCyaQSB'];
const NEW_REF = '563 — Morales';

const TABLES = {
  projets: 'tbl9y74Gakhfwt6i1',
  devis: 'tblWklGEKMiBStXCs',
  'devis-artisans': 'tblFxsJtEYpDOmQQj',
  commandes: 'tblDynhnhLXb4Ibs2',
  taches: 'tblDwUHL16LBVMSaz',
  sav: 'tbl8ErWw6zhXLfCII',
  'fiches-decouverte': 'tblU5trwFCofUQcQY',
  'reunions-plaud': 'tblWYGr3ETRWxrE63',
};

async function fetchAll(tid) {
  let r = [], o = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' }); if (o) q.set('offset', o);
    const res = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, { headers: { Authorization: 'Bearer ' + K } });
    const d = await res.json(); r = r.concat(d.records || []); o = d.offset || null;
  } while (o);
  return r;
}
async function patchRecord(tid, rid, fields) {
  const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}/${rid}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`patch ${tid}/${rid}: ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}
async function deleteRecord(tid, rid) {
  const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}/${rid}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + K } });
  if (!r.ok) throw new Error(`delete ${tid}/${rid}: ${r.status}`);
  return r.json();
}

(async () => {
  console.log(`Mode : ${EXECUTE ? '🚀 EXECUTE' : '🧪 DRY-RUN'}\n`);

  // 1. Re-link toutes les tables qui pointent vers MERGE → KEEP
  let totalRelinked = 0;
  for (const tableKey of ['commandes', 'devis', 'devis-artisans', 'taches', 'sav', 'fiches-decouverte', 'reunions-plaud']) {
    const tid = TABLES[tableKey];
    const records = await fetchAll(tid);
    const linkField = (tableKey === 'taches' || tableKey === 'sav' || tableKey === 'fiches-decouverte' || tableKey === 'reunions-plaud') ? 'Projet' : 'Projet';
    const affected = records.filter(r => {
      const arr = r.fields?.[linkField] || [];
      return Array.isArray(arr) && arr.some(id => MERGE.includes(id));
    });
    if (!affected.length) { console.log(`  ${tableKey}: 0 enregistrements à re-lier`); continue; }
    console.log(`  ${tableKey}: ${affected.length} enregistrements à re-lier`);
    for (const r of affected) {
      const old = r.fields[linkField] || [];
      const next = old.map(id => MERGE.includes(id) ? KEEP : id);
      const dedupped = Array.from(new Set(next));
      const isCmd = tableKey === 'commandes';
      // Pour les commandes pré-existantes : ajout de Notes traçabilité
      const fields = { [linkField]: dedupped };
      if (isCmd && !r.fields.Notes) {
        const num = r.fields['Numéro'] || '';
        const numDevis = (num.match(/^(\d+\/\d+\/\d+)/) || [])[1] || '563/1/12';
        fields.Notes = `Auto-générée via signature devis ${numDevis} (fusion projet pré-existant 2026-04-25)`;
      }
      console.log(`    ${tableKey}/${r.id} (${r.fields['Numéro']||r.fields['Numéro devis']||r.fields['Titre']||'?'}) : ${old} → ${dedupped}`);
      if (EXECUTE) {
        try { await patchRecord(tid, r.id, fields); totalRelinked++; }
        catch (e) { console.error(`    ✗ ${e.message}`); }
      }
    }
  }

  // 2. Renommer le projet principal
  console.log(`\n  → renommer ${KEEP} en "${NEW_REF}"`);
  if (EXECUTE) {
    await patchRecord(TABLES.projets, KEEP, { 'Référence': NEW_REF });
    console.log(`    ✓`);
  }

  // 3. Supprimer les doublons
  for (const id of MERGE) {
    console.log(`\n  → supprimer projet doublon ${id}`);
    if (EXECUTE) {
      try { await deleteRecord(TABLES.projets, id); console.log(`    ✓`); }
      catch (e) { console.error(`    ✗ ${e.message}`); }
    }
  }

  console.log(`\n${EXECUTE ? '✅ Cleanup terminé' : '🧪 Dry-run — relance avec --execute'}`);
  console.log(`Records re-liés: ${totalRelinked}`);
})().catch(e => { console.error('❌', e); process.exit(1); });
