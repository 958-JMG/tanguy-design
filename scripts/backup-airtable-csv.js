#!/usr/bin/env node
/**
 * Backup CSV des tables critiques Airtable — snapshot pré-refonte v3
 *
 * Lecture seule. Écrit un dossier horodaté dans backups/ avec 1 CSV par table.
 *
 * Usage :
 *   node scripts/backup-airtable-csv.js                # toutes les tables critiques
 *   node scripts/backup-airtable-csv.js clients projets # tables spécifiques
 *
 * Sortie : backups/YYYY-MM-DD_HH-MM/<table>.csv
 *
 * À lancer obligatoirement avant tout `setup-*-fields-v3.js --apply` (cf. checklist Sprint 0).
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
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;
if (!B || !K) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const TABLES = {
  clients:        'tbl2zmxpWWzbY1wT0',
  projets:        'tbl9y74Gakhfwt6i1',
  devis:          'tblWklGEKMiBStXCs',
  'zones-devis':  'tbl6FmEIIR15NMsgZ',
  'lignes-devis': 'tblCxDvzQAqBzpCx2',
  echeances:      'tblML7D7MXeWnMcxy',
  commandes:      'tblDynhnhLXb4Ibs2',
  taches:         'tblDwUHL16LBVMSaz',
  sav:            'tbl8ErWw6zhXLfCII',
  fournisseurs:   'tblz1AZIKkn9VCbkR',
  artisans:       'tblWxbLpwHNagDKfJ',
  'devis-artisans': 'tblFxsJtEYpDOmQQj',
  plaud:          'tblWYGr3ETRWxrE63',
};

async function fetchAll(tid) {
  let records = [], offset = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, {
      headers: { Authorization: 'Bearer ' + K }
    });
    if (!r.ok) throw new Error(`fetch ${tid}: ${r.status}`);
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) value = value.join('|');
  if (typeof value === 'object') value = JSON.stringify(value);
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function recordsToCsv(records) {
  if (!records.length) return '_id,_createdTime\n';
  const fieldSet = new Set();
  records.forEach(r => Object.keys(r.fields || {}).forEach(k => fieldSet.add(k)));
  const fields = Array.from(fieldSet).sort();
  const header = ['_id', '_createdTime', ...fields];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of records) {
    const row = [r.id, r.createdTime, ...fields.map(f => csvEscape(r.fields?.[f]))];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

(async () => {
  const args = process.argv.slice(2);
  const tables = args.length ? args.filter(t => TABLES[t]) : Object.keys(TABLES);
  if (!tables.length) { console.error('Aucune table reconnue. Disponibles :', Object.keys(TABLES).join(', ')); process.exit(1); }

  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(':', '-').replace('T', '_');
  const dir = path.join(__dirname, '..', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`📦 Backup snapshot → ${dir}\n`);

  let totalRecords = 0;
  for (const t of tables) {
    process.stdout.write(`  ${t}…`);
    const records = await fetchAll(TABLES[t]);
    const csv = recordsToCsv(records);
    const file = path.join(dir, `${t}.csv`);
    fs.writeFileSync(file, csv);
    totalRecords += records.length;
    console.log(` ${records.length} records → ${file}`);
  }

  // Manifest (utile pour rollback : on connait la date exacte et la composition)
  const manifest = {
    timestamp: now.toISOString(),
    base_id: B,
    tables: tables.map(t => ({ key: t, table_id: TABLES[t] })),
    total_records: totalRecords,
    git_commit: require('child_process').execSync('git rev-parse HEAD').toString().trim(),
    git_branch: require('child_process').execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
  };
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n✅ Backup terminé : ${totalRecords} records dans ${tables.length} tables.`);
  console.log(`   Manifest : ${path.join(dir, '_manifest.json')}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
