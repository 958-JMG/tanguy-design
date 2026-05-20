#!/usr/bin/env node
/**
 * Backfill des dates d'échéance manquantes — fix bug Morales rétroactif.
 *
 * Parcourt toutes les échéances en base, et pour celles qui n'ont pas de
 * `Date prévue`, dérive une date via deriveDateEcheance() à partir de :
 *   - Date du devis lié
 *   - Date pose prévue du projet lié au devis
 *
 * Idempotent : si une échéance a déjà une `Date prévue`, on ne l'écrase pas.
 *
 * Usage :
 *   node scripts/backfill-dates-echeances.js              # dry-run
 *   node scripts/backfill-dates-echeances.js --apply      # live
 */
const fs = require('fs');
const path = require('path');
if (!process.env.AIRTABLE_KEY) {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const fetchFn = globalThis.fetch;
const { deriveDateEcheance } = require('../services/echeances-helper');
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;
if (!B || !K) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

const TABLES = {
  projets:        'tbl9y74Gakhfwt6i1',
  devis:          'tblWklGEKMiBStXCs',
  echeances:      'tblML7D7MXeWnMcxy',
};

async function fetchAll(tid) {
  let r = [], o = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (o) q.set('offset', o);
    const res = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, { headers: { Authorization: 'Bearer ' + K } });
    if (!res.ok) throw new Error(`fetch ${tid}: ${res.status}`);
    const d = await res.json(); r = r.concat(d.records || []); o = d.offset || null;
  } while (o);
  return r;
}

async function patch(tid, rid, fields) {
  const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}/${rid}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`patch ${tid}/${rid}: ${r.status}`);
  return r.json();
}

(async () => {
  console.log(`Mode : ${APPLY ? '🚀 APPLY' : '🧪 DRY-RUN'}\n`);

  const [projets, devis, echeances] = await Promise.all([
    fetchAll(TABLES.projets),
    fetchAll(TABLES.devis),
    fetchAll(TABLES.echeances),
  ]);
  console.log(`Loaded : ${projets.length} projets, ${devis.length} devis, ${echeances.length} échéances\n`);

  const projetById = new Map(projets.map(p => [p.id, p]));
  const devisById = new Map(devis.map(d => [d.id, d]));

  // Filtrer les échéances sans date
  const sansDate = echeances.filter(e => !e.fields['Date prévue']);
  console.log(`Échéances sans Date prévue : ${sansDate.length}\n`);

  let calcOK = 0, calcKO = 0, applied = 0;
  for (const e of sansDate) {
    const libelle = e.fields['Libellé'] || '';
    const devisIds = e.fields['Devis'] || [];
    if (!devisIds.length) { calcKO++; console.log(`  [${e.id}] ⚠️ pas de devis lié — skip`); continue; }
    const d = devisById.get(devisIds[0]);
    if (!d) { calcKO++; console.log(`  [${e.id}] ⚠️ devis ${devisIds[0]} introuvable — skip`); continue; }

    const dateDevis = d.fields['Date devis'] || null;
    const projetIds = d.fields['Projet'] || [];
    const p = projetIds.length ? projetById.get(projetIds[0]) : null;
    const datePose = p?.fields['Date pose prévue'] || null;

    const derived = deriveDateEcheance(libelle, dateDevis, datePose);
    if (!derived) { calcKO++; console.log(`  [${e.id}] ⚠️ "${libelle}" : pas de date calculable (ni devis ni pose) — skip`); continue; }
    calcOK++;
    console.log(`  [${e.id}] "${libelle}" → ${derived}  (devis=${dateDevis || '—'}, pose=${datePose || '—'})`);

    if (APPLY) {
      try {
        await patch(TABLES.echeances, e.id, { 'Date prévue': derived });
        applied++;
      } catch (err) {
        console.error(`    ✗ patch failed: ${err.message}`);
      }
    }
  }

  console.log(`\n${APPLY ? '✅' : '🧪'} ${calcOK} dates calculées, ${calcKO} non calculables${APPLY ? `, ${applied} appliquées` : ' (dry-run, relance avec --apply)'}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
