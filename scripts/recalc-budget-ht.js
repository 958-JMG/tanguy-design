#!/usr/bin/env node
/**
 * Recalcule Budget HT de chaque projet = somme des Total HT final des devis
 * (tout statut sauf "Annulé") liés au projet. One-shot, idempotent.
 *
 * Usage : node scripts/recalc-budget-ht.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

if (!process.env.AIRTABLE_KEY) {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const fetchFn = globalThis.fetch || require('node-fetch');
const DRY = process.argv.includes('--dry-run');
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;
const TABLES = { projets: 'tbl9y74Gakhfwt6i1', devis: 'tblWklGEKMiBStXCs' };

async function fetchAll(tid) {
  let r = [], o = null;
  do {
    const q = new URLSearchParams({ pageSize:'100' }); if (o) q.set('offset', o);
    const res = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, { headers:{Authorization:'Bearer '+K}});
    const d = await res.json(); r = r.concat(d.records||[]); o = d.offset || null;
  } while (o);
  return r;
}

(async () => {
  const [projets, devis] = await Promise.all([fetchAll(TABLES.projets), fetchAll(TABLES.devis)]);
  console.log(`${projets.length} projets · ${devis.length} devis\n`);

  for (const p of projets) {
    const liés = devis.filter(d => (d.fields?.Projet||[]).includes(p.id) && (d.fields?.Statut||'') !== 'Annulé');
    if (!liés.length) continue;
    const totalBudget = liés.reduce((s, d) => s + (Number(d.fields?.['Total HT final'] || d.fields?.['Total HT après remise'] || d.fields?.['Total HT articles']) || 0), 0);
    const currentBudget = Number(p.fields?.['Budget HT']) || 0;
    if (Math.abs(totalBudget - currentBudget) < 0.01) continue;

    console.log(`${p.fields?.['Référence']||p.id} · ${liés.length} devis · budget: ${currentBudget}€ → ${totalBudget}€`);
    if (!DRY) {
      await fetchFn(`https://api.airtable.com/v0/${B}/${TABLES.projets}/${p.id}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Budget HT': totalBudget } })
      });
    }
  }
  console.log(DRY ? '\n🧪 dry-run' : '\n✅ done');
})().catch(e => { console.error(e); process.exit(1); });
