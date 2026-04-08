const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const { parseDevisPdf, parsePlaudTranscript } = require('./services/devis-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Airtable config ---
const BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AT_KEY = process.env.AIRTABLE_KEY || '';

const TABLES = {
  clients:         { id: 'tbl2zmxpWWzbY1wT0', name: 'Clients' },
  projets:         { id: 'tbl9y74Gakhfwt6i1', name: 'Projets' },
  artisans:        { id: 'tblWxbLpwHNagDKfJ', name: 'Artisans' },
  fournisseurs:    { id: 'tblz1AZIKkn9VCbkR', name: 'Fournisseurs' },
  commandes:       { id: 'tblDynhnhLXb4Ibs2', name: 'Commandes' },
  taches:          { id: 'tblDwUHL16LBVMSaz', name: 'Tâches' },
  sav:             { id: 'tbl8ErWw6zhXLfCII', name: 'SAV' },
  'fiches-decouverte': { id: 'tblU5trwFCofUQcQY', name: 'Fiches découverte' },
  'reunions-plaud':    { id: 'tblWYGr3ETRWxrE63', name: 'Réunions Plaud' },
  devis:           { id: 'tblWklGEKMiBStXCs', name: 'Devis' },
  'zones-devis':   { id: 'tbl6FmEIIR15NMsgZ', name: 'Zones devis' },
  'lignes-devis':  { id: 'tblCxDvzQAqBzpCx2', name: 'Lignes devis' },
  'echeances-devis': { id: 'tblML7D7MXeWnMcxy', name: 'Échéances devis' }
};

// --- Users ---
function parseUsers(str) {
  const map = {};
  if (!str) return map;
  for (const part of str.split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const login = part.slice(0, idx).trim();
    const hash = part.slice(idx + 1).trim();
    if (login && hash) map[login] = hash;
  }
  return map;
}
let USERS_RAW = process.env.USERS_HASHES || '';
if (process.env.USERS_HASHES_B64) {
  try { USERS_RAW = Buffer.from(process.env.USERS_HASHES_B64, 'base64').toString('utf8'); }
  catch (e) { console.error('USERS_HASHES_B64 decode failed:', e.message); }
}
const USERS = parseUsers(USERS_RAW);

// --- Middleware ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
  name: 'tanguy.sid',
  keys: [process.env.SESSION_SECRET || 'dev-only-change-me'],
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 30
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not authenticated' });
  return res.redirect('/login');
}

// Multer pour upload PDF (stockage mémoire, 15MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  }
});

// --- Airtable helpers ---
async function atFetchAll(tableId, params = '') {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable not configured');
  let records = [], offset = null;
  do {
    const q = new URLSearchParams(params);
    q.set('pageSize', '100');
    if (offset) q.set('offset', offset);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q.toString()}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}

async function atFetchFiltered(tableId, filterFormula) {
  const q = new URLSearchParams();
  q.set('filterByFormula', filterFormula);
  return atFetchAll(tableId, q.toString());
}

async function atCreate(tableId, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  return r.json();
}

async function atCreateBatch(tableId, recordsArray) {
  const results = [];
  for (let i = 0; i < recordsArray.length; i += 10) {
    const batch = recordsArray.slice(i, i + 10);
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })), typecast: true })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
    const d = await r.json();
    results.push(...(d.records || []));
  }
  return results;
}

async function atPatch(tableId, recordId, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  return r.json();
}

async function atDelete(tableId, recordId) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${AT_KEY}` }
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  return r.json();
}

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'tanguy-design',
    version: '0.2.0',
    airtable_configured: !!AT_KEY && !!BASE_ID,
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
    users_count: Object.keys(USERS).length,
    tables: Object.keys(TABLES)
  });
});

// --- Auth ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login + password requis' });
  const hash = USERS[login.toLowerCase()];
  if (!hash) return res.status(401).json({ error: 'identifiants invalides' });
  const ok = await bcrypt.compare(password, hash);
  if (!ok) return res.status(401).json({ error: 'identifiants invalides' });
  req.session.user = login.toLowerCase();
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: req.session.user });
});

// --- Data API générique ---
app.get('/api/data/:table', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const records = await atFetchAll(t.id);
    res.json({ ok: true, records });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data/:table', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const rec = await atCreate(t.id, req.body.fields || {});
    res.json({ ok: true, record: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const rec = await atPatch(t.id, req.params.id, req.body.fields || {});
    res.json({ ok: true, record: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const d = await atDelete(t.id, req.params.id);
    res.json({ ok: true, deleted: d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- DEVIS : détail complet (devis + zones + lignes + échéances) ---
app.get('/api/devis/:id/detail', requireAuth, async (req, res) => {
  const devisId = req.params.id;
  try {
    // Récupération du devis
    const devisUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLES.devis.id}/${devisId}`;
    const dr = await fetch(devisUrl, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!dr.ok) throw new Error('Devis introuvable');
    const devis = await dr.json();

    // Zones / lignes / échéances : on fetch tout et on filtre par l'ID du devis lié
    // (ARRAYJOIN sur un linked field renvoie la valeur primaire, pas les IDs)
    const linkedToDevis = (rec) => Array.isArray(rec.fields?.Devis) && rec.fields.Devis.includes(devisId);
    const [allZones, allLignes, allEcheances] = await Promise.all([
      atFetchAll(TABLES['zones-devis'].id),
      atFetchAll(TABLES['lignes-devis'].id),
      atFetchAll(TABLES['echeances-devis'].id)
    ]);
    const zones = allZones.filter(linkedToDevis);
    const lignes = allLignes.filter(linkedToDevis);
    const echeances = allEcheances.filter(linkedToDevis);

    res.json({ ok: true, devis, zones, lignes, echeances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- DEVIS : import PDF + parsing Claude + création complète ---
app.post('/api/devis/import', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  const projetId = req.body.projetId || null;
  const clientId = req.body.clientId || null;

  try {
    console.log(`[devis/import] parsing ${req.file.originalname} (${req.file.size} bytes)`);
    const parsed = await parseDevisPdf(req.file.buffer);
    console.log(`[devis/import] ✓ parsed: ${parsed.lignes?.length || 0} lignes, ${parsed.zones?.length || 0} zones`);

    // 1. Création du Devis (header)
    const devisFields = {
      'Numéro devis': parsed.metadata?.numero_devis || `AUTO-${Date.now()}`,
      'Milieu': parsed.metadata?.milieu || null,
      'Date devis': parsed.metadata?.date_devis || null,
      "Valable jusqu'au": parsed.metadata?.valable_jusquau || null,
      'Statut': 'Brouillon',
      'Adresse facturation': parsed.adresses?.facturation || '',
      'Adresse livraison': parsed.adresses?.livraison || '',
      'Total HT articles': parsed.totaux?.total_lignes_ht || null,
      'Remise pourcentage': parsed.totaux?.remise_pourcentage ? parsed.totaux.remise_pourcentage / 100 : null,
      'Montant remise': parsed.totaux?.montant_remise || null,
      'Total HT après remise': parsed.totaux?.total_apres_remise || null,
      'Livraison HT': parsed.totaux?.livraison_ht || null,
      'Livraison TVA taux': parsed.totaux?.livraison_tva_taux || null,
      'Pose HT': parsed.totaux?.pose_ht || null,
      'Pose TVA taux': parsed.totaux?.pose_tva_taux || null,
      'Eco-participation mobilier': parsed.totaux?.eco_participation_mobilier || null,
      'Eco-participation électroménager': parsed.totaux?.eco_participation_electromenager || null,
      'Total HT final': parsed.totaux?.total_ht_final || null,
      'TVA taux 1 pourcentage': parsed.totaux?.tva_taux_1_pourcentage || null,
      'TVA taux 1 base': parsed.totaux?.tva_taux_1_base || null,
      'TVA taux 1 montant': parsed.totaux?.tva_taux_1_montant || null,
      'TVA taux 2 pourcentage': parsed.totaux?.tva_taux_2_pourcentage || null,
      'TVA taux 2 base': parsed.totaux?.tva_taux_2_base || null,
      'TVA taux 2 montant': parsed.totaux?.tva_taux_2_montant || null,
      'Total TTC': parsed.totaux?.total_ttc || null,
      'Alertes parsing': parsed.alertes_parsing || ''
    };
    if (projetId) devisFields['Projet'] = [projetId];
    if (clientId) devisFields['Client'] = [clientId];

    // Nettoyage des null
    Object.keys(devisFields).forEach(k => { if (devisFields[k] === null || devisFields[k] === '') delete devisFields[k]; });

    const devisRec = await atCreate(TABLES.devis.id, devisFields);
    const devisId = devisRec.id;

    // 2. Création des Zones
    const zoneIdByName = {};
    if (Array.isArray(parsed.zones)) {
      for (const z of parsed.zones) {
        const zoneFields = {
          'Nom zone': z.nom || `Zone ${z.ordre || ''}`,
          'Devis': [devisId],
          'Ordre': z.ordre || null,
          'Marque': z.marque || '',
          'Modèle': z.modele || '',
          'Porte épaisseur': z.porte_epaisseur || '',
          'Modularité': z.modularite || '',
          'Exécution façade': z.execution_facade || '',
          'Coloris façade': z.coloris_facade || '',
          'Chant façade': z.chant_facade || '',
          'Coloris caisson': z.coloris_caisson || '',
          'Exécution côté finition': z.execution_cote_finition || '',
          'Coloris côté finition': z.coloris_cote_finition || '',
          'Type de gorge': z.type_gorge || '',
          'Exécution gorges': z.execution_gorges || '',
          'Finition gorges': z.finition_gorges || '',
          'Profondeur': z.profondeur || '',
          'Option ouverture': z.option_ouverture || '',
          'Profondeur élément bas angle': z.profondeur_element_bas_angle || '',
          'Finition socle': z.finition_socle || '',
          'Coloris joues panneaux': z.coloris_joues_panneaux || '',
          'Finition étagères': z.finition_etageres || ''
        };
        Object.keys(zoneFields).forEach(k => { if (zoneFields[k] === null || zoneFields[k] === '') delete zoneFields[k]; });
        const zr = await atCreate(TABLES['zones-devis'].id, zoneFields);
        zoneIdByName[z.nom] = zr.id;
      }
    }

    // 3. Création des Lignes (en batch 10)
    if (Array.isArray(parsed.lignes)) {
      const lignesBatch = parsed.lignes.map(l => {
        const f = {
          'Position': String(l.position || ''),
          'Devis': [devisId],
          'Position parent': l.position_parent || '',
          'Catégorie': l.categorie || null,
          'Code produit': l.code_produit || '',
          'Désignation': l.designation || '',
          'Largeur mm': l.largeur_mm || null,
          'Hauteur mm': l.hauteur_mm || null,
          'Profondeur mm': l.profondeur_mm || null,
          'Sens': l.sens || null,
          'Côté visible': l.cote_visible || null,
          'Quantité': l.quantite || null,
          'Unité': l.unite || null,
          'TVA pourcentage': l.tva_pourcentage || null,
          'Montant HT': l.montant_ht || null,
          'Eco-participation': l.eco_participation || null,
          'Coût final': l.cout_final || null,
          'Modèle override': l.modele_override || '',
          'Exécution façade override': l.execution_facade_override || '',
          'Coloris façade override': l.coloris_facade_override || '',
          'Coloris côté finition override': l.coloris_cote_finition_override || '',
          'Alertes': l.alertes || '',
          'Notes': l.notes || ''
        };
        if (l.zone_nom && zoneIdByName[l.zone_nom]) f['Zone'] = [zoneIdByName[l.zone_nom]];
        Object.keys(f).forEach(k => { if (f[k] === null || f[k] === '') delete f[k]; });
        return f;
      });
      await atCreateBatch(TABLES['lignes-devis'].id, lignesBatch);
    }

    // 4. Création des Échéances
    if (Array.isArray(parsed.echeances)) {
      const echeancesBatch = parsed.echeances.map(e => {
        const f = {
          'Libellé': e.libelle || '',
          'Devis': [devisId],
          'Ordre': e.ordre || null,
          'Montant prévu': e.montant_prevu || null,
          'Date prévue': e.date_prevue || null,
          'Statut': 'À encaisser'
        };
        Object.keys(f).forEach(k => { if (f[k] === null || f[k] === '') delete f[k]; });
        return f;
      });
      if (echeancesBatch.length) await atCreateBatch(TABLES['echeances-devis'].id, echeancesBatch);
    }

    res.json({
      ok: true,
      devisId,
      parsed_summary: {
        numero: parsed.metadata?.numero_devis,
        total_ttc: parsed.totaux?.total_ttc,
        lignes: parsed.lignes?.length || 0,
        zones: parsed.zones?.length || 0,
        echeances: parsed.echeances?.length || 0
      }
    });
  } catch (e) {
    console.error('[devis/import] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- PLAUD : parsing d'une transcription ---
app.post('/api/plaud/parse', requireAuth, async (req, res) => {
  const { transcript, projetId, clientId, type_reunion } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'transcript requis' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  try {
    const parsed = await parsePlaudTranscript(transcript);
    const fields = {
      'Titre': parsed.titre || 'Réunion Plaud',
      'Type réunion': type_reunion || 'Découverte',
      'Date heure': parsed.date_heure || null,
      'Lieu': parsed.lieu || '',
      'Transcription brute': transcript,
      'Synthèse': parsed.synthese || '',
      'Contexte': parsed.contexte || '',
      'Points de douleur': parsed.points_douleur || '',
      'Attentes': parsed.attentes || '',
      'Autres informations': parsed.autres_informations || '',
      'Tâches identifiées': parsed.taches_identifiees || '',
      'Statut traitement': 'Structuré'
    };
    if (projetId) fields['Projet'] = [projetId];
    if (clientId) fields['Client'] = [clientId];
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === '') delete fields[k]; });

    const rec = await atCreate(TABLES['reunions-plaud'].id, fields);
    res.json({ ok: true, record: rec, parsed });
  } catch (e) {
    console.error('[plaud/parse] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- Static ---
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

app.listen(PORT, () => {
  console.log(`✅ Tanguy Design — Cockpit v0.2.0 on port ${PORT}`);
  console.log(`   Users: ${Object.keys(USERS).length} | Airtable: ${BASE_ID ? 'OK' : 'MISSING'} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'}`);
});
