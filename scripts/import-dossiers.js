#!/usr/bin/env node
/**
 * Import dossiers clients vers Airtable Tanguy Design (V1).
 *
 * V1 = crée clients + projets (1 par sous-dossier), déduit le Statut.
 *      PAS d'upload de fichiers, PAS de parsing PDF.
 *
 * Usage :
 *   node scripts/import-dossiers.js <dossier>              # dry-run (défaut)
 *   node scripts/import-dossiers.js <dossier> --execute    # crée les records
 *
 * Env requis : AIRTABLE_BASE_ID, AIRTABLE_KEY
 * (lus depuis shell ou fichier .env à la racine)
 */
const fs = require('fs');
const path = require('path');

// Load .env si vars pas déjà set (parser minimal, pas de dep)
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

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const FOLDER = args.find(a => !a.startsWith('--'));

if (!FOLDER) {
  console.error('Usage: node scripts/import-dossiers.js <dossier> [--execute]');
  process.exit(1);
}
if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_KEY) {
  console.error('❌ AIRTABLE_BASE_ID + AIRTABLE_KEY requis (env ou .env)');
  process.exit(1);
}

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
const TABLES = {
  clients: 'tbl2zmxpWWzbY1wT0',
  projets: 'tbl9y74Gakhfwt6i1',
};

// ---------- parsing nom de dossier ----------
function parseFolderName(name) {
  let m;
  if ((m = name.match(/^\((\d+)\)\s*(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)\s*-\s*(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)-(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)\s+(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  return { ref: null, raw: name.trim() };
}

// ---------- normalisation nom client ----------
function normalizeName(s) {
  const small = new Set(['et','de','du','des','le','la','les','l']);
  return s.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map((w, i) => {
    const lo = w.toLowerCase();
    if (i > 0 && small.has(lo)) return lo;
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  }).join(' ');
}

// ---------- détection statut projet ----------
function deduceStatus(folderPath) {
  const dirs = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name.toLowerCase());
  const allFiles = collectFiles(folderPath).map(f => f.name.toLowerCase());

  if (allFiles.some(f => /attestation.*pose/i.test(f))) return 'Terminé';
  if (dirs.some(d => /confirmation de commande/i.test(d))) return 'Commandes';
  if (dirs.some(d => /bon de commande/i.test(d))) return 'Commandes';
  if (dirs.some(d => /devis.*tanguy/i.test(d))) return 'Devis';
  if (dirs.some(d => /plans? et dessins de pr.sentation/i.test(d))) return 'Dessin';
  if (dirs.some(d => /cahier des charges/i.test(d))) return 'Découverte';
  return 'Découverte';
}

function collectFiles(dir) {
  const out = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ name: entry.name, path: full, size: fs.statSync(full).size });
    }
  }
  walk(dir);
  return out;
}

function summarizeStructure(files, rootPath) {
  const byDir = {};
  for (const f of files) {
    const rel = path.relative(rootPath, f.path);
    const parts = rel.split(path.sep);
    const d = parts.length > 1 ? parts[0] : '(racine)';
    byDir[d] = (byDir[d] || 0) + 1;
  }
  return Object.entries(byDir).sort().map(([k,v]) => `- ${k}: ${v} fichier${v>1?'s':''}`).join('\n');
}

// ---------- Airtable helpers ----------
async function atFetchAll(tableId) {
  let records = [], offset = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q.toString()}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) throw new Error(`fetch ${tableId} HTTP ${r.status}`);
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}
async function atCreate(tableId, fields) {
  const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(`create ${tableId}: ${e.error?.message || r.status}`); }
  return r.json();
}

// ---------- main ----------
(async () => {
  console.log(`Mode    : ${EXECUTE ? '🚀 EXECUTE (écritures)' : '🧪 DRY-RUN (lecture seule)'}`);
  console.log(`Dossier : ${FOLDER}\n`);

  const [clientsExistants, projetsExistants] = await Promise.all([
    atFetchAll(TABLES.clients),
    atFetchAll(TABLES.projets),
  ]);
  console.log(`Airtable : ${clientsExistants.length} clients, ${projetsExistants.length} projets existants\n`);

  const dossiers = fs.readdirSync(FOLDER, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name).sort();

  const rapport = [];
  let clientsCrees = 0, projetsCrees = 0, clientsMatches = 0, projetsMatches = 0;

  for (const d of dossiers) {
    const full = path.join(FOLDER, d);
    const parsed = parseFolderName(d);
    const clientNom = normalizeName(parsed.raw);
    const statut = deduceStatus(full);
    const files = collectFiles(full);
    const structure = summarizeStructure(files, full);

    const nomUpper = clientNom.trim().toUpperCase();
    const clientMatch = clientsExistants.find(c =>
      (c.fields?.Nom || '').trim().toUpperCase() === nomUpper
    );
    const projetRef = parsed.ref ? `${parsed.ref} — ${clientNom}` : clientNom;
    const projetMatch = projetsExistants.find(p =>
      (p.fields?.['Référence'] || '').trim() === projetRef
    );

    let clientAction = clientMatch ? `match ${clientMatch.id}` : 'CRÉER';
    let projetAction = projetMatch ? `match ${projetMatch.id}` : 'CRÉER';
    if (clientMatch) clientsMatches++; else if (EXECUTE) clientsCrees++;
    if (projetMatch) projetsMatches++; else if (EXECUTE) projetsCrees++;
    let clientId = clientMatch?.id;
    let projetId = projetMatch?.id;

    if (EXECUTE) {
      if (!clientId) {
        const c = await atCreate(TABLES.clients, {
          Nom: clientNom,
          Type: 'Particulier',
          Notes: `Import auto dossier "${d}" le ${new Date().toISOString().slice(0,10)}`
        });
        clientId = c.id;
        clientAction = `CRÉÉ ${clientId}`;
      }
      if (!projetId) {
        const p = await atCreate(TABLES.projets, {
          'Référence': projetRef,
          'Client': [clientId],
          'Statut': statut,
          'Description': `Dossier source : ${d}\n\nStructure :\n${structure}\n\nImport auto (${new Date().toISOString().slice(0,10)}). Les fichiers restent à uploader manuellement dans les zones Plans devis / Plans techniques / Documents.`
        });
        projetId = p.id;
        projetAction = `CRÉÉ ${projetId}`;
      }
    }

    rapport.push({ d, parsed, clientNom, statut, files: files.length, clientAction, projetAction, structure });
  }

  console.log('\n=== RAPPORT ===\n');
  for (const r of rapport) {
    const ref = r.parsed.ref ? `#${r.parsed.ref}` : '—';
    console.log(`${ref.padEnd(6)} ${r.clientNom.padEnd(36)} ${r.statut.padEnd(10)} ${String(r.files).padStart(3)} fichiers`);
    console.log(`       client: ${r.clientAction}   projet: ${r.projetAction}`);
  }

  console.log('\n=== BILAN ===');
  console.log(`Dossiers traités : ${rapport.length}`);
  console.log(`Clients matchés  : ${clientsMatches}`);
  console.log(`Projets matchés  : ${projetsMatches}`);
  if (EXECUTE) {
    console.log(`Clients créés    : ${clientsCrees}`);
    console.log(`Projets créés    : ${projetsCrees}`);
  } else {
    const aCreer = rapport.filter(r => r.clientAction === 'CRÉER').length;
    const pCreer = rapport.filter(r => r.projetAction === 'CRÉER').length;
    console.log(`Clients à créer  : ${aCreer}`);
    console.log(`Projets à créer  : ${pCreer}`);
    console.log('\n🧪 Dry-run terminé — relance avec --execute pour créer.');
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
