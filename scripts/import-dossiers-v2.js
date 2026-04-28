#!/usr/bin/env node
/**
 * Import dossiers V2 — clients + projets + upload fichiers catégorisés.
 *
 * Idempotent :
 *   - Match client par nom normalisé (pas de doublon).
 *   - Match projet par "Référence" (pas de doublon).
 *   - Skip upload si un fichier du même nom est déjà attaché dans le champ cible.
 *
 * Catégorisation des fichiers par sous-dossier :
 *   - Plans techniques / Plan technique / Plan architecte / Prise de cotes → "Plans techniques"
 *   - Plans et dessins de présentation                                   → "Plans devis"
 *   - tout le reste (BC, AR, cahier des charges, notices, devis, etc.)   → "Documents projet"
 *
 * Limites :
 *   - Airtable content API : 5 MB par fichier → skip au-delà, log en sortie.
 *   - Formats ignorés : .drw, .ifc, .wrl, .pfi, .DS_Store, fichiers ~*.
 *
 * Usage :
 *   node scripts/import-dossiers-v2.js <dossier>              # dry-run
 *   node scripts/import-dossiers-v2.js <dossier> --execute    # live
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

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const FOLDER = args.find(a => !a.startsWith('--'));
if (!FOLDER) { console.error('Usage: node scripts/import-dossiers-v2.js <dossier> [--execute]'); process.exit(1); }
if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY  = process.env.AIRTABLE_KEY;
const TABLES  = { clients: 'tbl2zmxpWWzbY1wT0', projets: 'tbl9y74Gakhfwt6i1' };

// Field IDs (créés par setup-attachment-fields.js, renommés par setup-projet-fields-v2.js le 2026-04-28).
// Les fieldIds restent stables au rename Airtable. Le champ "Images" est résolu dynamiquement (cf server.js).
const PROJET_ATTACHMENT_FIELDS = {
  'Plan 3D':          'fldtX14UbA5j6UIwo', // ex "Plans devis"
  'Plan technique':   'fldatdZKmLEiVqfBY', // ex "Plans techniques"
  'Documents projet': 'fldT3Cg2oKTnNq0XT',
};

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // Airtable content API limit
const SKIP_EXT = new Set(['.drw','.ifc','.wrl','.pfi','.ds_store']);

// --- Parsing / normalisation ---
function parseFolderName(name) {
  let m;
  if ((m = name.match(/^\((\d+)\)\s*(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)\s*-\s*(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)-(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  if ((m = name.match(/^(\d+)\s+(.+)$/))) return { ref: m[1], raw: m[2].trim() };
  return { ref: null, raw: name.trim() };
}
function normalizeName(s) {
  const small = new Set(['et','de','du','des','le','la','les','l']);
  return s.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map((w, i) => {
    const lo = w.toLowerCase();
    if (i > 0 && small.has(lo)) return lo;
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  }).join(' ');
}

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

function categorizeFile(filePath, rootPath) {
  const rel = path.relative(rootPath, filePath).toLowerCase();
  if (/plans? techniques?|plan technique|prise de cotes/.test(rel)) return 'Plan technique';
  if (/plan architecte/.test(rel)) return 'Plan technique';
  if (/plans? et dessins de pr.sentation|plan et dessin de pr.sentation/.test(rel)) return 'Plan 3D';
  return 'Documents projet';
}

function guessContentType(name) {
  const ext = path.extname(name).toLowerCase();
  return {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
  }[ext] || 'application/octet-stream';
}

// --- Airtable ---
async function atFetchAll(tableId) {
  let recs = [], offset = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q.toString()}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` }});
    if (!r.ok) throw new Error(`fetch ${tableId}: ${r.status}`);
    const d = await r.json();
    recs = recs.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return recs;
}
async function atFetchOne(tableId, id) {
  const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${id}`,
    { headers: { Authorization: `Bearer ${AT_KEY}` }});
  if (!r.ok) throw new Error(`fetch ${tableId}/${id}: ${r.status}`);
  return r.json();
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
async function atUploadAttachment(recordId, fieldId, buffer, filename, contentType) {
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`too big (${buffer.length} bytes)`);
  const r = await fetchFn(`https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, filename, file: buffer.toString('base64') })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  return r.json();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- Main ---
(async () => {
  console.log(`Mode    : ${EXECUTE ? '🚀 EXECUTE' : '🧪 DRY-RUN'}`);
  console.log(`Dossier : ${FOLDER}\n`);

  const [clientsExistants, projetsExistants] = await Promise.all([
    atFetchAll(TABLES.clients),
    atFetchAll(TABLES.projets),
  ]);
  console.log(`Airtable : ${clientsExistants.length} clients, ${projetsExistants.length} projets existants\n`);

  const dossiers = fs.readdirSync(FOLDER, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name).sort();

  const stats = { clients_created: 0, projets_created: 0, uploads_ok: 0, uploads_skipped_size: 0, uploads_skipped_dup: 0, uploads_failed: 0, files_ignored: 0 };
  const failuresLog = [];
  const skippedTooBig = [];

  for (const d of dossiers) {
    const full = path.join(FOLDER, d);
    const parsed = parseFolderName(d);
    const clientNom = normalizeName(parsed.raw);
    const statut = deduceStatus(full);
    const projetRef = parsed.ref ? `${parsed.ref} — ${clientNom}` : clientNom;

    console.log(`\n━━━ ${d}`);
    console.log(`   → client=${clientNom} · ref=${projetRef} · statut=${statut}`);

    // match client
    const nomUp = clientNom.trim().toUpperCase();
    let clientId = clientsExistants.find(c => (c.fields?.Nom || '').trim().toUpperCase() === nomUp)?.id;
    if (!clientId) {
      if (EXECUTE) {
        const c = await atCreate(TABLES.clients, { Nom: clientNom, Type: 'Particulier', Notes: `Import dossier "${d}" (${new Date().toISOString().slice(0,10)})` });
        clientId = c.id;
        stats.clients_created++;
        console.log(`   ✓ client CRÉÉ ${clientId}`);
      } else {
        console.log(`   [dry-run] client à créer`);
      }
    } else {
      console.log(`   ✓ client match ${clientId}`);
    }

    // match projet
    let projetId = projetsExistants.find(p => (p.fields?.['Référence'] || '').trim() === projetRef)?.id;
    if (!projetId) {
      if (EXECUTE && clientId) {
        const files = collectFiles(full);
        const structure = {};
        files.forEach(f => { const d = path.relative(full, f.path).split(path.sep)[0] || '(racine)'; structure[d] = (structure[d]||0)+1; });
        const structStr = Object.entries(structure).sort().map(([k,v]) => `- ${k}: ${v}`).join('\n');
        const p = await atCreate(TABLES.projets, {
          'Référence': projetRef,
          'Client': [clientId],
          'Statut': statut,
          'Description': `Dossier source : ${d}\n\nStructure :\n${structStr}\n\nImport auto V2 (${new Date().toISOString().slice(0,10)}).`
        });
        projetId = p.id;
        stats.projets_created++;
        console.log(`   ✓ projet CRÉÉ ${projetId}`);
      } else {
        console.log(`   [dry-run] projet à créer`);
      }
    } else {
      console.log(`   ✓ projet match ${projetId}`);
    }

    if (!projetId) { console.log(`   — skip upload (pas de projet)`); continue; }

    // Fetch projet courant pour lister les attachments déjà présents (idempotence)
    let projetActuel = null;
    if (EXECUTE) {
      try { projetActuel = await atFetchOne(TABLES.projets, projetId); } catch (e) { console.warn(`   ⚠ fetch projet: ${e.message}`); }
    }
    const alreadyAttached = {}; // { fieldName: Set(filenames) }
    if (projetActuel) {
      for (const [fieldName] of Object.entries(PROJET_ATTACHMENT_FIELDS)) {
        const list = projetActuel.fields?.[fieldName] || [];
        alreadyAttached[fieldName] = new Set(list.map(a => a.filename));
      }
    }

    const files = collectFiles(full);
    let uploaded = 0;
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (SKIP_EXT.has(ext)) { stats.files_ignored++; continue; }
      const category = categorizeFile(f.path, full);
      const fieldId = PROJET_ATTACHMENT_FIELDS[category];
      if (!fieldId) { stats.files_ignored++; continue; }

      if (f.size > MAX_ATTACHMENT_BYTES) {
        console.log(`   ⚠ skip too big: ${f.name} (${(f.size/1024/1024).toFixed(1)} MB) → ${category}`);
        skippedTooBig.push({ dossier: d, file: path.relative(full, f.path), size: f.size, category });
        stats.uploads_skipped_size++;
        continue;
      }
      if (alreadyAttached[category]?.has(f.name)) {
        stats.uploads_skipped_dup++;
        continue;
      }

      if (!EXECUTE) continue;

      try {
        const buf = fs.readFileSync(f.path);
        await atUploadAttachment(projetId, fieldId, buf, f.name, guessContentType(f.name));
        stats.uploads_ok++;
        uploaded++;
        if (alreadyAttached[category]) alreadyAttached[category].add(f.name);
        await sleep(220); // throttle ~4.5 req/s
      } catch (e) {
        stats.uploads_failed++;
        failuresLog.push({ dossier: d, file: f.name, error: e.message });
        console.log(`   ✗ upload FAIL: ${f.name} → ${e.message}`);
      }
    }
    if (EXECUTE) console.log(`   📎 ${uploaded} fichier(s) uploadé(s)`);
  }

  console.log('\n=== BILAN ===');
  console.log(`Clients créés      : ${stats.clients_created}`);
  console.log(`Projets créés      : ${stats.projets_created}`);
  console.log(`Uploads OK         : ${stats.uploads_ok}`);
  console.log(`Uploads skip (dup) : ${stats.uploads_skipped_dup}`);
  console.log(`Uploads skip (>5M) : ${stats.uploads_skipped_size}`);
  console.log(`Uploads failed     : ${stats.uploads_failed}`);
  console.log(`Fichiers ignorés   : ${stats.files_ignored}`);

  if (skippedTooBig.length) {
    console.log('\n=== FICHIERS > 5 MB (à uploader manuellement via UI) ===');
    skippedTooBig.forEach(s => console.log(`  ${s.dossier} · ${s.file} (${(s.size/1024/1024).toFixed(1)} MB) → ${s.category}`));
  }
  if (failuresLog.length) {
    console.log('\n=== ÉCHECS ===');
    failuresLog.forEach(f => console.log(`  ${f.dossier} · ${f.file} : ${f.error}`));
  }
  if (!EXECUTE) console.log('\n🧪 Dry-run — relance avec --execute pour vraiment uploader.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
