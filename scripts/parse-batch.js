#!/usr/bin/env node
/**
 * Parse batch — Tanguy Design cockpit
 * ====================================
 *
 * Pour chaque sous-dossier d'un wetransfer client :
 *  - Parse les devis Tanguy Design (dossier "Devis tanguy design/") → table Devis + zones + lignes + échéances
 *    Règle : versions du même scope → parse la plus récente par mtime, les anciennes vont en Documents projet.
 *  - Parse les devis artisans (dossier "devis artisan(s)/") → table Devis Artisans + attach PDF
 *  - Parse les BC (dossier "Bon de commande/") → table Commandes avec origine traçable
 *  - Idempotent : skip si un record avec même numéro existe déjà pour ce projet.
 *
 * Usage :
 *   node scripts/parse-batch.js <folder>                  # dry-run
 *   node scripts/parse-batch.js <folder> --execute        # live
 *   node scripts/parse-batch.js <folder> --execute --only-tanguy    # filtre
 *   node scripts/parse-batch.js <folder> --execute --only-artisans
 *   node scripts/parse-batch.js <folder> --execute --only-bc
 *
 * Env requis : AIRTABLE_BASE_ID, AIRTABLE_KEY, ANTHROPIC_API_KEY.
 */
const fs = require('fs');
const path = require('path');

// Load .env si vars pas déjà set
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
const { parseDevisPdf } = require('../services/devis-parser');
const { parseArtisanDevisPdf } = require('../services/artisan-devis-parser');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const FILTER = args.includes('--only-tanguy') ? 'tanguy' : args.includes('--only-artisans') ? 'artisans' : args.includes('--only-bc') ? 'bc' : null;
const FOLDER = args.find(a => !a.startsWith('--'));

if (!FOLDER) { console.error('Usage: node scripts/parse-batch.js <dossier> [--execute] [--only-tanguy|--only-artisans|--only-bc]'); process.exit(1); }
for (const k of ['AIRTABLE_BASE_ID','AIRTABLE_KEY','ANTHROPIC_API_KEY']) {
  if (!process.env[k]) { console.error(`❌ ${k} manquant`); process.exit(1); }
}

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
const TABLES = {
  clients: 'tbl2zmxpWWzbY1wT0',
  projets: 'tbl9y74Gakhfwt6i1',
  devis: 'tblWklGEKMiBStXCs',
  'zones-devis': 'tbl6FmEIIR15NMsgZ',
  'lignes-devis': 'tblCxDvzQAqBzpCx2',
  'echeances-devis': 'tblML7D7MXeWnMcxy',
  'devis-artisans': 'tblFxsJtEYpDOmQQj',
  artisans: 'tblWxbLpwHNagDKfJ',
  commandes: 'tblDynhnhLXb4Ibs2',
};
// Field IDs
const DA_FIELDS = { pdfOriginal: 'fld92F9VmHpKSWSzE' };
const PROJET_FIELDS = {
  'Documents projet': 'fldT3Cg2oKTnNq0XT',
};

// ---------- Folder parsing ----------
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

function collectPdfs(root, filterFn) {
  const out = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('~')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && full.toLowerCase().endsWith('.pdf') && filterFn(full)) {
        out.push({ name: e.name, path: full, rel: path.relative(root, full), mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size });
      }
    }
  }
  walk(root);
  return out;
}

const IS_DEVIS_TANGUY = f => /devis tanguy design|devis tanguy/i.test(f);
const IS_DEVIS_ARTISAN = f => /devis artisans?|devis artisan/i.test(f);
const IS_BC = f => /bon de commande|bons de commande/i.test(f);

// PDFs qui ressemblent à des plans plutôt qu'à des devis → à ne pas parser
function isPlanNotDevis(filename) {
  const lo = filename.toLowerCase();
  return /^plan |plan vasque|plan-|^plan\.pdf$|^plans?.techniques|^elevation|^elevations/.test(lo);
}

// Versions explicitement obsolètes (connues via arbitrage JMG — archivage direct)
const ARCHIVE_BLACKLIST = new Set([
  'devis-juin 2025.pdf',        // HORLAVILLE : remplacé par MAJ 280825
  'preventivo_guerrier.pdf',    // GUERRIER : version brouillon
  'preventivo_guerrierstrat.pdf',
]);
function isArchivedByBlacklist(filename) {
  return ARCHIVE_BLACKLIST.has(filename.normalize('NFC').toLowerCase().trim());
}

// Dédoublonnage par nom (case-insensitive, NFC-normalized) : garde la copie la plus récente
function dedupByName(pdfs) {
  const seen = new Map();
  for (const p of pdfs) {
    const key = p.name.normalize('NFC').toLowerCase().trim();
    if (!seen.has(key) || seen.get(key).mtime < p.mtime) seen.set(key, p);
  }
  return Array.from(seen.values());
}

// ---------- Airtable helpers ----------
async function atFetchAll(tableId, params = '') {
  let records = [], offset = null;
  do {
    const q = new URLSearchParams(params); q.set('pageSize', '100');
    if (offset) q.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q.toString()}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) throw new Error(`fetch ${tableId}: ${r.status}`);
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
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create ${tableId}: ${e.error?.message || r.status}`); }
  return r.json();
}
async function atCreateBatch(tableId, recordsArray) {
  const results = [];
  for (let i = 0; i < recordsArray.length; i += 10) {
    const batch = recordsArray.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })), typecast: true })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`createBatch: ${e.error?.message || r.status}`); }
    const d = await r.json();
    results.push(...(d.records || []));
  }
  return results;
}
async function atUploadAttachment(recordId, fieldId, buffer, filename, contentType = 'application/pdf') {
  if (buffer.length > 5 * 1024 * 1024) throw new Error(`too big (${buffer.length} bytes)`);
  const r = await fetchFn(`https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, filename, file: buffer.toString('base64') })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`upload: ${e.error?.message || r.status}`); }
  return r.json();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Devis Tanguy Design ----------
// Copié/adapté de /api/devis/import (server.js)
async function importDevisTanguy(projetId, clientId, pdfPath, existingDevis) {
  const filename = path.basename(pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  if (buffer.length > 15 * 1024 * 1024) return { skip: 'too-big', filename };

  console.log(`    parsing "${filename}" (${(buffer.length/1024|0)}KB)…`);
  const parsed = await parseDevisPdf(buffer);
  const numero = parsed.metadata?.numero_devis || `AUTO-${Date.now()}`;

  // Idempotence : même numéro déjà lié au projet ?
  const existing = existingDevis.find(d => (d.fields?.['Numéro devis']||'') === numero && (d.fields?.Projet||[]).includes(projetId));
  if (existing) { return { skip: 'already-parsed', numero, devisId: existing.id }; }
  // Avant parsing : short-circuit "Numéro devis manquant" déjà connu ? N/A ici, on a toujours un numéro.

  const devisFields = {
    'Numéro devis': numero,
    'Milieu': parsed.metadata?.milieu || null,
    'Date devis': parsed.metadata?.date_devis || null,
    "Valable jusqu'au": parsed.metadata?.valable_jusquau || null,
    'Statut': 'Signé', // chantiers en cours = devis déjà signés (règle user 2026-04-25)
    'Adresse facturation': parsed.adresses?.facturation || '',
    'Adresse livraison': parsed.adresses?.livraison || '',
    'Total HT articles': parsed.totaux?.total_lignes_ht || null,
    'Remise pourcentage': parsed.totaux?.remise_pourcentage ? parsed.totaux.remise_pourcentage / 100 : null,
    'Montant remise': parsed.totaux?.montant_remise || null,
    'Total HT après remise': parsed.totaux?.total_apres_remise || null,
    'Livraison HT': parsed.totaux?.livraison_ht || null,
    'Pose HT': parsed.totaux?.pose_ht || null,
    'Eco-participation mobilier': parsed.totaux?.eco_participation_mobilier || null,
    'Eco-participation électroménager': parsed.totaux?.eco_participation_electromenager || null,
    'Total HT final': parsed.totaux?.total_ht_final || null,
    'Total TTC': parsed.totaux?.total_ttc || null,
    'Alertes parsing': parsed.alertes_parsing || '',
    'Projet': [projetId],
  };
  if (clientId) devisFields['Client'] = [clientId];
  Object.keys(devisFields).forEach(k => { if (devisFields[k] === null || devisFields[k] === '') delete devisFields[k]; });

  const devisRec = await atCreate(TABLES.devis, devisFields);
  const devisId = devisRec.id;

  // Zones
  const zoneIdByName = {};
  if (Array.isArray(parsed.zones)) {
    for (const z of parsed.zones) {
      const zf = { 'Nom zone': z.nom || `Zone ${z.ordre||''}`, 'Devis': [devisId], 'Ordre': z.ordre || null,
        'Marque': z.marque || '', 'Modèle': z.modele || '', 'Coloris façade': z.coloris_facade || '' };
      Object.keys(zf).forEach(k => { if (zf[k] === null || zf[k] === '') delete zf[k]; });
      const zr = await atCreate(TABLES['zones-devis'], zf);
      zoneIdByName[z.nom] = zr.id;
    }
  }

  // Lignes
  if (Array.isArray(parsed.lignes) && parsed.lignes.length) {
    const lignesBatch = parsed.lignes.map(l => {
      const f = { 'Position': String(l.position||''), 'Devis': [devisId], 'Catégorie': l.categorie || null,
        'Code produit': l.code_produit || '', 'Désignation': l.designation || '',
        'Quantité': l.quantite || null, 'Montant HT': l.montant_ht || null, 'Coût final': l.cout_final || null };
      if (l.zone_nom && zoneIdByName[l.zone_nom]) f['Zone'] = [zoneIdByName[l.zone_nom]];
      Object.keys(f).forEach(k => { if (f[k] === null || f[k] === '') delete f[k]; });
      return f;
    });
    await atCreateBatch(TABLES['lignes-devis'], lignesBatch);
  }

  // Échéances
  if (Array.isArray(parsed.echeances) && parsed.echeances.length) {
    const echeBatch = parsed.echeances.map(e => {
      const f = { 'Libellé': e.libelle || '', 'Devis': [devisId], 'Ordre': e.ordre || null,
        'Montant prévu': e.montant_prevu || null, 'Date prévue': e.date_prevue || null, 'Statut': 'À encaisser' };
      Object.keys(f).forEach(k => { if (f[k] === null || f[k] === '') delete f[k]; });
      return f;
    });
    await atCreateBatch(TABLES['echeances-devis'], echeBatch);
  }

  // Cumul Budget HT du projet = somme des Totaux HT final de tous les devis signés liés
  const totalHT = Number(parsed.totaux?.total_ht_final || parsed.totaux?.total_apres_remise || parsed.totaux?.total_lignes_ht) || 0;
  if (totalHT > 0) {
    try {
      const pr = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets}/${projetId}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
      const projetActuel = pr.ok ? (await pr.json()).fields : {};
      const currentBudget = Number(projetActuel['Budget HT']) || 0;
      const newBudget = currentBudget + totalHT;
      await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets}/${projetId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Budget HT': newBudget }, typecast: true })
      });
    } catch (e) { console.log(`    ⚠ patch budget projet échoué: ${e.message}`); }
  }

  return { ok: true, numero, devisId, lignes: parsed.lignes?.length || 0, ttc: parsed.totaux?.total_ttc, addedBudget: totalHT };
}

// ---------- Devis artisan ----------
async function importDevisArtisan(projetId, pdfPath, existingDA, allArtisans) {
  const filename = path.basename(pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  if (buffer.length > 15 * 1024 * 1024) return { skip: 'too-big', filename };

  console.log(`    parsing artisan "${filename}" (${(buffer.length/1024|0)}KB)…`);
  const parsed = await parseArtisanDevisPdf(buffer);
  const numero = parsed.metadata?.numero_devis || `AUTO-ART-${Date.now()}`;

  // Idempotence
  const existing = existingDA.find(d => (d.fields?.['Numéro devis']||'') === numero && (d.fields?.Projet||[]).includes(projetId));
  if (existing) return { skip: 'already-parsed', numero, recordId: existing.id };

  // Match artisan par nom
  let artisanId = null;
  if (parsed.artisan?.entreprise) {
    const up = String(parsed.artisan.entreprise).trim().toUpperCase();
    const m = allArtisans.find(a => (a.fields?.Nom||'').trim().toUpperCase().includes(up) || up.includes((a.fields?.Nom||'').trim().toUpperCase()));
    if (m) artisanId = m.id;
  }

  const montantHT = Number(parsed.totaux?.total_ht) || 0;
  const fields = {
    'Numéro devis': numero, 'Date devis': parsed.metadata?.date_devis || null,
    'Montant HT': montantHT || null, 'Montant TTC': Number(parsed.totaux?.total_ttc) || null,
    'Rétro-commission HT': Math.round(montantHT * 0.05 * 100) / 100 || null,
    'Statut': 'Validé', 'Description travaux': parsed.description_travaux || '', // chantiers en cours = devis artisans validés
    'Adresse chantier': parsed.chantier?.adresse || parsed.client?.adresse_facturation || '',
    'Projet': [projetId],
  };
  if (artisanId) fields['Artisan'] = [artisanId];
  Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === '') delete fields[k]; });

  const rec = await atCreate(TABLES['devis-artisans'], fields);
  try { await atUploadAttachment(rec.id, DA_FIELDS.pdfOriginal, buffer, filename); } catch (e) { /* noop */ }

  return { ok: true, numero, recordId: rec.id, artisanMatched: !!artisanId, artisanNom: parsed.artisan?.entreprise, ttc: parsed.totaux?.total_ttc };
}

// ---------- BC → Commande (parse light) ----------
async function importBCAsCommande(projetId, pdfPath, existingCmds) {
  const filename = path.basename(pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  if (buffer.length > 15 * 1024 * 1024) return { skip: 'too-big', filename };

  // Idempotence : déjà une commande avec cette source pour ce projet ?
  const existing = existingCmds.find(c => (c.fields?.Notes||'').includes(filename) && (c.fields?.Projet||[]).includes(projetId));
  if (existing) return { skip: 'already-imported', filename, recordId: existing.id };

  console.log(`    parsing BC "${filename}" (${(buffer.length/1024|0)}KB)…`);
  // Réutilise le parser devis (BC = devis signé côté Modulnova/Miton, même format Winner)
  const parsed = await parseDevisPdf(buffer);

  const fournisseur = (parsed.zones?.[0]?.marque) || 'Fournisseur inconnu';
  const totalHT = parsed.totaux?.total_ht_final || parsed.totaux?.total_apres_remise || parsed.totaux?.total_lignes_ht || null;
  const numero = `BC-${parsed.metadata?.numero_devis || path.basename(filename, '.pdf').slice(0, 20)}`;

  const fields = {
    'Numéro': numero,
    'Statut': 'Envoyée',
    'Date création': parsed.metadata?.date_devis || new Date().toISOString().slice(0, 10),
    'Montant HT': totalHT || null,
    'Projet': [projetId],
    'Notes': `Importé depuis PDF : ${filename}\nFournisseur détecté : ${fournisseur}\nN° devis/BC d'origine : ${parsed.metadata?.numero_devis || '—'}`,
  };
  Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === '') delete fields[k]; });

  const rec = await atCreate(TABLES.commandes, fields);
  return { ok: true, numero, recordId: rec.id, fournisseur, totalHT };
}

// ---------- Main ----------
(async () => {
  console.log(`Mode    : ${EXECUTE ? '🚀 EXECUTE' : '🧪 DRY-RUN'}`);
  console.log(`Filtre  : ${FILTER || 'all'}`);
  console.log(`Dossier : ${FOLDER}\n`);

  console.log('→ Fetch Airtable (projets, devis, devis-artisans, artisans, commandes)…');
  const [projets, allDevis, allDA, allArtisans, allCmds] = await Promise.all([
    atFetchAll(TABLES.projets),
    atFetchAll(TABLES.devis),
    atFetchAll(TABLES['devis-artisans']),
    atFetchAll(TABLES.artisans),
    atFetchAll(TABLES.commandes),
  ]);
  console.log(`  ${projets.length} projets · ${allDevis.length} devis · ${allDA.length} devis-artisans · ${allArtisans.length} artisans · ${allCmds.length} commandes\n`);

  const dossiers = fs.readdirSync(FOLDER, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();

  const stats = { tanguy_ok: 0, tanguy_skip: 0, tanguy_archived: 0, artisans_ok: 0, artisans_skip: 0, bc_ok: 0, bc_skip: 0, errors: [] };

  for (const d of dossiers) {
    const full = path.join(FOLDER, d);
    const parsedName = parseFolderName(d);
    const clientNom = normalizeName(parsedName.raw);
    const projetRef = parsedName.ref ? `${parsedName.ref} — ${clientNom}` : clientNom;
    const projet = projets.find(p => (p.fields?.['Référence']||'').trim() === projetRef);
    if (!projet) { console.log(`━━━ ${d}\n  ⚠ projet non trouvé (ref attendue: "${projetRef}") — skip\n`); continue; }
    const projetId = projet.id;
    const clientId = (projet.fields?.Client||[])[0];

    console.log(`━━━ ${d}  (projet ${projetId})`);

    // ─── Devis Tanguy : PARSE TOUT par défaut, archive uniquement la blacklist ───
    if (!FILTER || FILTER === 'tanguy') {
      const tanguyPdfs = dedupByName(collectPdfs(full, IS_DEVIS_TANGUY).filter(f => !isPlanNotDevis(f.name)));
      const active = tanguyPdfs.filter(f => !isArchivedByBlacklist(f.name));
      const archived = tanguyPdfs.filter(f => isArchivedByBlacklist(f.name));
      console.log(`  [Devis Tanguy] ${tanguyPdfs.length} PDFs → ${active.length} actifs, ${archived.length} archivés`);

      for (const f of active) {
        try {
          if (EXECUTE) {
            const r = await importDevisTanguy(projetId, clientId, f.path, allDevis);
            if (r.skip) { console.log(`    ⊘ ${f.rel} → skip (${r.skip})`); stats.tanguy_skip++; }
            else { console.log(`    ✓ ${f.rel} → ${r.numero} (${r.lignes} lignes, TTC ${r.ttc})`); stats.tanguy_ok++; }
          } else console.log(`    [dry] would parse ${f.rel}`);
          await sleep(500);
        } catch (e) { stats.errors.push({file: f.rel, error: e.message}); console.log(`    ✗ ${f.rel} → ${e.message}`); }
      }
      // Archiver les versions anciennes en Documents projet
      for (const f of archived) {
        if (f.size > 5 * 1024 * 1024) { console.log(`    ⊘ archive ${f.rel} > 5MB`); continue; }
        if (EXECUTE) {
          try {
            const buf = fs.readFileSync(f.path);
            await atUploadAttachment(projetId, PROJET_FIELDS['Documents projet'], buf, f.name);
            console.log(`    📎 archivé ${f.rel} → Documents projet`);
            stats.tanguy_archived++;
            await sleep(220);
          } catch (e) { console.log(`    ✗ archive ${f.rel} → ${e.message}`); }
        } else console.log(`    [dry] would archive ${f.rel}`);
      }
    }

    // ─── Devis artisans ───
    if (!FILTER || FILTER === 'artisans') {
      const artisanPdfs = dedupByName(collectPdfs(full, IS_DEVIS_ARTISAN));
      console.log(`  [Devis artisans] ${artisanPdfs.length} PDFs (dédupliqués)`);
      for (const f of artisanPdfs) {
        try {
          if (EXECUTE) {
            const r = await importDevisArtisan(projetId, f.path, allDA, allArtisans);
            if (r.skip) { console.log(`    ⊘ ${f.rel} → ${r.skip}`); stats.artisans_skip++; }
            else { console.log(`    ✓ ${f.rel} → ${r.numero} · ${r.artisanNom || '?'} ${r.artisanMatched?'(matché)':'(nouvel artisan)'}`); stats.artisans_ok++; }
          } else console.log(`    [dry] would parse ${f.rel}`);
          await sleep(500);
        } catch (e) { stats.errors.push({file: f.rel, error: e.message}); console.log(`    ✗ ${f.rel} → ${e.message}`); }
      }
    }

    // ─── BC → Commandes ───
    if (!FILTER || FILTER === 'bc') {
      // Normalize NFC car macOS encode les filenames en NFD (a + combining accent) → regex doit normaliser
      const bcPdfs = dedupByName(
        collectPdfs(full, IS_BC).filter(f => {
          const n = f.name.normalize('NFC');
          return !/modification|mise ?à? ?jour|^maj /i.test(n);
        })
      );
      console.log(`  [BC] ${bcPdfs.length} PDFs (dédupliqués, hors MAJ/modif)`);
      for (const f of bcPdfs) {
        try {
          if (EXECUTE) {
            const r = await importBCAsCommande(projetId, f.path, allCmds);
            if (r.skip) { console.log(`    ⊘ ${f.rel} → ${r.skip}`); stats.bc_skip++; }
            else { console.log(`    ✓ ${f.rel} → ${r.numero} · ${r.fournisseur} · HT ${r.totalHT}`); stats.bc_ok++; }
          } else console.log(`    [dry] would parse BC ${f.rel}`);
          await sleep(500);
        } catch (e) { stats.errors.push({file: f.rel, error: e.message}); console.log(`    ✗ ${f.rel} → ${e.message}`); }
      }
    }
    console.log('');
  }

  console.log('\n═══ BILAN ═══');
  console.log(`Devis Tanguy  : ${stats.tanguy_ok} OK · ${stats.tanguy_skip} déjà parsés · ${stats.tanguy_archived} archivés`);
  console.log(`Devis artisans: ${stats.artisans_ok} OK · ${stats.artisans_skip} déjà parsés`);
  console.log(`BC            : ${stats.bc_ok} OK · ${stats.bc_skip} déjà importés`);
  if (stats.errors.length) {
    console.log(`\nErreurs (${stats.errors.length}):`);
    stats.errors.slice(0, 20).forEach(e => console.log(`  · ${e.file} : ${e.error}`));
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
