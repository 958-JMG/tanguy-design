const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
// fetch est natif depuis Node 18, requis Node 20+ (cf. package.json engines).
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const { parseDevisPdf, parsePlaudTranscript } = require('./services/devis-parser');
const { parseArtisanDevisPdf } = require('./services/artisan-devis-parser');
const { generateFicheMission } = require('./services/fiche-mission-generator');
const { enrichEcheancesAvecDates } = require('./services/echeances-helper');
const { canAccess, pickAllowedFields } = require('./services/acl');
const logger = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// --- Session secret : refus de démarrer en prod sans secret robuste ---
const SESSION_SECRET_FALLBACK = 'dev-only-change-me';
if (IS_PROD) {
  const s = process.env.SESSION_SECRET || '';
  if (!s || s === SESSION_SECRET_FALLBACK || s.length < 32) {
    logger.fatal('SESSION_SECRET manquant ou trop court (min 32 chars). En prod, génère avec: openssl rand -hex 32');
    process.exit(1);
  }
}

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
  'echeances-devis': { id: 'tblML7D7MXeWnMcxy', name: 'Échéances devis' },
  stock:           { id: 'tblENw2eBplwUZ4nd', name: 'Stock' },
  'devis-artisans': { id: 'tblFxsJtEYpDOmQQj', name: 'Devis Artisans' }
};

// Field IDs des champs attachments de Devis Artisans (upload direct)
const DA_FIELDS = {
  pdfOriginal: 'fld92F9VmHpKSWSzE',
  ficheMission: 'fld78s6hfTTexIjUC'
};

// Field IDs des zones attachments de Projets.
// 2026-04-28 : rename "Plans devis"→"Plan 3D", "Plans techniques"→"Plan technique", + ajout "Images".
// Les fieldIds restent stables au rename. "Images" est résolu dynamiquement (créé par setup-projet-fields-v2.js).
const PROJET_ATTACHMENT_FIELDS = {
  'Plan 3D':           'fldtX14UbA5j6UIwo', // ex "Plans devis"
  'Plan technique':    'fldatdZKmLEiVqfBY', // ex "Plans techniques"
  'Images':            null,                // résolu via Airtable Meta API au premier upload
  'Documents projet':  'fldT3Cg2oKTnNq0XT',
};

// Cache lazy des fieldIds résolus dynamiquement (pour les champs créés post-déploiement).
const fieldIdCache = {};
async function resolveProjetFieldId(name) {
  const hardcoded = PROJET_ATTACHMENT_FIELDS[name];
  if (hardcoded) return hardcoded;
  if (fieldIdCache[name]) return fieldIdCache[name];
  if (!(name in PROJET_ATTACHMENT_FIELDS)) {
    throw new Error(`Champ "${name}" inconnu (attendus : ${Object.keys(PROJET_ATTACHMENT_FIELDS).join(', ')})`);
  }
  // Lookup via Meta API
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AT_KEY}` }
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`Lookup field "${name}" failed: ${e.error?.message || r.status}`);
  }
  const data = await r.json();
  const projetsTable = data.tables.find(t => t.id === TABLES.projets.id);
  const field = projetsTable?.fields.find(f => f.name === name);
  if (!field) throw new Error(`Champ "${name}" introuvable sur la table Projets — lance scripts/setup-projet-fields-v2.js`);
  fieldIdCache[name] = field.id;
  return field.id;
}

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
  catch (e) { logger.error('USERS_HASHES_B64 decode failed:', e.message); }
}
const USERS = parseUsers(USERS_RAW);

// --- Rôles (admin = accès menu Admin / Marges / Stock) ---
// Override via env ADMIN_LOGINS="virginie,sebastien" (CSV, lowercase)
const ADMIN_LOGINS = new Set(
  (process.env.ADMIN_LOGINS || 'virginie')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

// --- Middleware ---
// Scaleway en front, Cloudflare en amont (Proxied).
// trust proxy = 2 (Cloudflare + Scaleway LB) pour que req.ip/secure cookies fonctionnent.
app.set('trust proxy', 2);

// Récupère la vraie IP client : priorise CF-Connecting-IP (Cloudflare Proxied),
// fallback X-Real-IP / req.ip (direct Scaleway).
function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.ip
    || req.connection?.remoteAddress
    || 'unknown';
}

// pino-http : 1 log JSON par requête (id, méthode, url, status, durée).
// Niveau adaptatif : info pour 2xx/3xx, warn pour 4xx, error pour 5xx.
// Headers sensibles redactés (cf. services/logger.js).
app.use(pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode} ${err?.message || ''}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: clientIp(req) }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// Helmet : headers de sécurité standards (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy…)
// CSP : depuis Sprint 0.7 (extraction <script> → /assets/js/main.js), script-src n'a plus besoin
// de 'unsafe-inline'. script-src-attr reste sur 'unsafe-inline' tant que les onclick="..." inline
// persistent dans index.html (refacto progressif des handlers à venir dans le découpage ES modules).
// style-src garde 'unsafe-inline' pour les 48 style="..." inline encore présents.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https://api.airtable.com', 'https://content.airtable.com', 'https://dl.airtable.com', 'https://v5.airtableusercontent.com'],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // pas d'embed cross-origin complexe
  strictTransportSecurity: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// sameSite=strict : mitigation CSRF (cf. ADR-002).
// L'app n'est jamais accédée via lien externe — un user qui arrive via mail/signet doit re-login.
// Le webhook SAV sortant (proxy /api/sav-webhook) n'est pas affecté (appel serveur→n8n, pas inverse).
app.use(session({
  name: 'tanguy.sid',
  keys: [process.env.SESSION_SECRET || SESSION_SECRET_FALLBACK],
  httpOnly: true,
  sameSite: 'strict',
  secure: IS_PROD, // HTTPS only en prod
  maxAge: 1000 * 60 * 60 * 24 * 30
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not authenticated' });
  return res.redirect('/login');
}

// keyGenerator commun aux rate-limiters : utilise la vraie IP client (CF-Connecting-IP prioritaire)
// sinon tous les users seraient groupés derrière l'IP Cloudflare unique → rate-limit inutile.
const ipKeyGen = (req) => clientIp(req);

// Rate-limit global API (protection contre DoS basique) : 300 req/min par IP client
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGen,
  message: { error: 'Trop de requêtes, réessayez dans 1 minute' },
});
app.use('/api/', apiLimiter);

// Rate-limit strict sur login : 10 tentatives par IP par 15 min (bruteforce protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGen,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true, // ne compte pas les logins réussis
});

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

// Récupère des records par leurs IDs (chunké par 50 pour respecter la limite URL Airtable).
// Évite les atFetchAll() complets quand on connait déjà les IDs (typiquement depuis un linked field).
async function atFetchByIds(tableId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const results = await Promise.all(chunks.map(c => {
    const formula = `OR(${c.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    return atFetchFiltered(tableId, formula);
  }));
  return results.flat();
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

/**
 * Upload un fichier dans un champ attachment Airtable (endpoint content API).
 * Limite 5 MB par fichier. Retourne le JSON de la réponse Airtable.
 */
async function atUploadAttachment(recordId, fieldId, buffer, filename, contentType = 'application/pdf') {
  if (buffer.length > 5 * 1024 * 1024) throw new Error(`Fichier trop gros (${buffer.length} bytes, max 5 MB)`);
  const url = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, filename, file: buffer.toString('base64') })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`upload attachment: ${e.error?.message || r.status}`); }
  return r.json();
}

// --- Health ---
// Endpoint minimal : pas d'info sensible (users_count, table IDs) pour ne rien révéler aux scans externes.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'tanguy-design', ts: new Date().toISOString() });
});

// --- Auth ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/login', loginLimiter, async (req, res) => {
  const { login, password } = req.body || {};
  const ip = clientIp(req);
  if (!login || !password) return res.status(400).json({ error: 'login + password requis' });
  const loginLc = String(login).toLowerCase();
  const hash = USERS[loginLc];
  if (!hash) {
    logger.warn(`[auth] login FAIL (unknown user) login=${loginLc} ip=${ip} t=${new Date().toISOString()}`);
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    logger.warn(`[auth] login FAIL (bad password) login=${loginLc} ip=${ip} t=${new Date().toISOString()}`);
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  req.session.user = loginLc;
  logger.info(`[auth] login OK login=${loginLc} ip=${ip} t=${new Date().toISOString()}`);
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: req.session.user, isAdmin: ADMIN_LOGINS.has(req.session.user) });
});

// --- Data API générique avec ACL (cf. services/acl.js et ADR Sprint 0.7 P0-2) ---
// Le proxy /api/data/:table autorisait n'importe quel user authentifié à faire CRUD
// sur n'importe quelle table avec n'importe quel champ. Risque concret : un collab
// non-admin pouvait modifier Rétro-commission d'un artisan ou Marge d'un projet.

function userRole(req) {
  return ADMIN_LOGINS.has(req.session?.user) ? 'admin' : '*';
}

function requireTableAccess(req, res, verb) {
  const tableKey = req.params.table;
  const t = TABLES[tableKey];
  if (!t) { res.status(404).json({ error: 'unknown table' }); return null; }
  const role = userRole(req);
  if (!canAccess(role, tableKey, verb)) {
    logger.warn({ user: req.session?.user, role, table: tableKey, verb }, 'ACL refus');
    res.status(role === 'admin' ? 405 : 403).json({ error: role === 'admin' ? `${verb} non autorisé sur ${tableKey}` : 'admin requis' });
    return null;
  }
  return t;
}

app.get('/api/data/:table', requireAuth, async (req, res) => {
  const t = requireTableAccess(req, res, 'GET'); if (!t) return;
  try {
    const records = await atFetchAll(t.id);
    res.json({ ok: true, records });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data/:table', requireAuth, async (req, res) => {
  const t = requireTableAccess(req, res, 'POST'); if (!t) return;
  try {
    const fields = pickAllowedFields(req.params.table, req.body.fields);
    const rec = await atCreate(t.id, fields);
    res.json({ ok: true, record: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = requireTableAccess(req, res, 'PATCH'); if (!t) return;
  try {
    const fields = pickAllowedFields(req.params.table, req.body.fields);
    const rec = await atPatch(t.id, req.params.id, fields);
    res.json({ ok: true, record: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = requireTableAccess(req, res, 'DELETE'); if (!t) return;
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

    // Zones / lignes / échéances : on récupère directement par les IDs liés du devis
    // (les linked fields exposent les record IDs côté parent, plus efficace que atFetchAll+filter).
    const zoneIds  = devis.fields?.['Zones devis']     || [];
    const ligneIds = devis.fields?.['Lignes devis']    || [];
    const echIds   = devis.fields?.['Échéances devis'] || [];
    const [zones, lignes, echeances] = await Promise.all([
      atFetchByIds(TABLES['zones-devis'].id, zoneIds),
      atFetchByIds(TABLES['lignes-devis'].id, ligneIds),
      atFetchByIds(TABLES['echeances-devis'].id, echIds),
    ]);

    res.json({ ok: true, devis, zones, lignes, echeances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- DEVIS : import PDF + parsing Claude + création complète ---
// Param `type` (optionnel) : "Principal" (défaut) ou "Additif".
// En mode Additif : projetId requis, pas de création auto client/projet.
app.post('/api/devis/import', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  const projetId = req.body.projetId || null;
  const clientId = req.body.clientId || null;
  const typeDevis = req.body.type === 'Additif' ? 'Additif' : 'Principal';
  if (typeDevis === 'Additif' && !projetId) {
    return res.status(400).json({ error: 'Devis additif : projetId requis (le projet doit déjà exister)' });
  }

  try {
    logger.info(`[devis/import] parsing ${req.file.originalname} (${req.file.size} bytes)`);
    const parsed = await parseDevisPdf(req.file.buffer);
    logger.info(`[devis/import] ✓ parsed: ${parsed.lignes?.length || 0} lignes, ${parsed.zones?.length || 0} zones`);

    // 1. Création du Devis (header)
    const devisFields = {
      'Numéro devis': parsed.metadata?.numero_devis || `AUTO-${Date.now()}`,
      'Type devis': typeDevis,
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
    // --- Résolution Client (par nom normalisé) ---
    // En mode Additif : on récupère le client du projet existant, pas de création auto.
    let resolvedClientId = clientId;
    if (typeDevis === 'Additif' && projetId && !resolvedClientId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
          { headers: { Authorization: `Bearer ${AT_KEY}` } });
        if (pr.ok) {
          const pd = (await pr.json()).fields || {};
          if (Array.isArray(pd['Client']) && pd['Client'][0]) resolvedClientId = pd['Client'][0];
        }
      } catch (e) { /* non bloquant */ }
    }
    if (typeDevis !== 'Additif' && !resolvedClientId && parsed.client?.nom) {
      const nomNorm = String(parsed.client.nom).trim().toUpperCase().replace(/\s+/g,' ');
      const allClients = await atFetchAll(TABLES.clients.id);
      const match = allClients.find(c => (c.fields?.Nom||'').trim().toUpperCase().replace(/\s+/g,' ') === nomNorm);
      if (match) {
        resolvedClientId = match.id;
        logger.info(`[devis/import] client existant matché: ${match.fields.Nom}`);
      } else {
        const c = parsed.client;
        const adresseLignes = [c.adresse, [c.cp, c.ville].filter(Boolean).join(' ')].filter(Boolean).join('\n');
        const cf = { Nom: c.nom, Type: 'Particulier' };
        if (c.civilite || c.prenom) cf.Contact = [c.civilite, c.prenom].filter(Boolean).join(' ');
        if (c.email) cf.Email = c.email;
        if (c.telephone_portable || c.telephone_domicile) cf['Téléphone'] = c.telephone_portable || c.telephone_domicile;
        if (adresseLignes) cf.Adresse = adresseLignes;
        cf.Notes = 'Créé automatiquement via import devis';
        const nc = await atCreate(TABLES.clients.id, cf);
        resolvedClientId = nc.id;
        logger.info(`[devis/import] nouveau client créé: ${c.nom}`);
      }
    }

    // --- Résolution Projet (création auto si aucun) ---
    let resolvedProjetId = projetId;
    if (!resolvedProjetId && resolvedClientId) {
      const ref = `${parsed.client?.nom || 'Projet'} · ${parsed.metadata?.milieu || ''}`.trim();
      const pf = {
        'Référence': ref,
        'Client': [resolvedClientId],
        'Statut': 'Devis',
        'Description': `Projet créé automatiquement depuis le devis ${parsed.metadata?.numero_devis || ''}`
      };
      if (parsed.totaux?.total_ht_final) pf['Budget HT'] = parsed.totaux.total_ht_final;
      const np = await atCreate(TABLES.projets.id, pf);
      resolvedProjetId = np.id;
      logger.info(`[devis/import] projet créé: ${ref}`);
    }

    if (resolvedProjetId) devisFields['Projet'] = [resolvedProjetId];
    if (resolvedClientId) devisFields['Client'] = [resolvedClientId];

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
    // Les PDF Winner ne contiennent pas de dates absolues — on dérive via libellé + datePose
    // (fix bug Morales, cf. docs/refonte-v3-2026-05-20/bug-morales-echeances.md).
    if (Array.isArray(parsed.echeances)) {
      // Lookup date pose si projet existant (sinon null → fallback date devis)
      let datePose = null;
      if (resolvedProjetId) {
        try {
          const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${resolvedProjetId}`, {
            headers: { Authorization: `Bearer ${AT_KEY}` }
          });
          if (r.ok) {
            const pRec = await r.json();
            datePose = pRec?.fields?.['Date pose prévue'] || null;
          }
        } catch (e) {
          logger.warn({ err: e.message, projetId: resolvedProjetId }, 'lookup date pose échec, fallback date devis pour échéances');
        }
      }

      const echeancesEnrichies = enrichEcheancesAvecDates(
        parsed.echeances,
        parsed.metadata?.date_devis || null,
        datePose
      );

      const echeancesBatch = echeancesEnrichies.map(e => {
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
    logger.error('[devis/import] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- DEVIS : signature → génération commandes fournisseurs + tâches ---
// Mapping catégorie devis → Type fournisseur
const CAT_TO_FOURNISSEUR_TYPE = {
  'Meubles': 'Meubles',
  'Panneaux de recouvrement': 'Meubles',
  'Electroménager': 'Électroménager',
  'Eviers et robinetterie': 'Sanitaire',
  'Sanitaires': 'Sanitaire',
  'Produits de vente': 'Accessoires'
  // Dépose et Divers : pas de commande fournisseur auto
};

app.post('/api/devis/:id/sign', requireAuth, async (req, res) => {
  const devisId = req.params.id;
  try {
    // 1. Récup devis + lignes
    const devisUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLES.devis.id}/${devisId}`;
    const dr = await fetch(devisUrl, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!dr.ok) throw new Error('Devis introuvable');
    const devis = await dr.json();
    const dv = devis.fields || {};
    const projetId = Array.isArray(dv['Projet']) ? dv['Projet'][0] : null;
    const numero = dv['Numéro devis'] || devisId;

    if (dv.Statut === 'Signé') return res.status(400).json({ error: 'Déjà signé' });

    // 1bis. Récup nom client (via projet → client) pour préfixer les numéros de commande.
    // Convention : `<NOMCLIENT> · <TYPE> · <num devis>-<idx>` — scan visuel rapide à 100+ commandes.
    let clientNom = '';
    if (projetId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
        if (pr.ok) {
          const pjson = await pr.json();
          const clientIds = Array.isArray(pjson.fields?.Client) ? pjson.fields.Client : [];
          if (clientIds.length) {
            const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientIds[0]}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
            if (cr.ok) {
              const cjson = await cr.json();
              clientNom = (cjson.fields?.Nom || '').toUpperCase().trim();
            }
          }
        }
      } catch(e) { /* fallback silencieux : pas de nom client → format legacy */ }
    }

    // 2. Récup les lignes du devis (par IDs liés depuis le devis, évite le scan complet de la table)
    const ligneIds = dv['Lignes devis'] || [];
    const lignes = await atFetchByIds(TABLES['lignes-devis'].id, ligneIds);

    // 3. Groupement par catégorie mappée + collecte des libellés de lignes pour pré-remplir le contenu
    const totauxParCat = {};
    const lignesParType = {};
    for (const l of lignes) {
      const cat = l.fields['Catégorie'];
      const type = CAT_TO_FOURNISSEUR_TYPE[cat];
      if (!type) continue;
      totauxParCat[type] = (totauxParCat[type] || 0) + (parseFloat(l.fields['Montant HT']) || 0);
      const lib = l.fields['Désignation'] || l.fields['Description'] || l.fields['Référence'] || '';
      const qte = l.fields['Quantité'] || '';
      const mt = l.fields['Montant HT'] || 0;
      if (lib) {
        (lignesParType[type] = lignesParType[type] || []).push(`• ${qte ? qte+'× ' : ''}${lib}${mt ? ' — '+(Math.round(mt*100)/100)+' € HT' : ''}`);
      }
    }

    // 4. Création des commandes fournisseurs
    const commandesCreees = [];
    let idx = 1;
    for (const [type, montant] of Object.entries(totauxParCat)) {
      if (montant <= 0) continue;
      const numCmd = clientNom
        ? `${clientNom} · ${type.toUpperCase()} · ${numero}-${idx}`
        : `${numero}-${type.slice(0,3).toUpperCase()}-${idx}`;
      const contenuSugg = (lignesParType[type] || []).join('\n');
      const notesPrefill = `[Auto-généré depuis devis ${numero} signé le ${new Date().toLocaleDateString('fr-FR')}]\n\nContenu prévisionnel (à valider/ajuster avant envoi au fournisseur) :\n${contenuSugg || '— Pas de détail ligne disponible —'}`;
      const cf = {
        'Numéro': numCmd,
        'Statut': 'Créée',
        'Date création': new Date().toISOString().slice(0,10),
        'Montant HT': Math.round(montant * 100) / 100,
        'Notes': notesPrefill
      };
      if (projetId) cf['Projet'] = [projetId];
      const c = await atCreate(TABLES.commandes.id, cf);
      commandesCreees.push({ id: c.id, type, montant, numero: numCmd });
      idx++;
    }

    // 5. Création des tâches de suivi
    const today = new Date().toISOString().slice(0,10);
    const plus7 = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const tachesFields = [
      { 'Titre': `Envoyer facture acompte — ${numero}`, 'Assignée à': 'Virginie', 'Priorité': 'Haute', 'Statut': 'À faire', 'Échéance': today, 'Description': `BC signé ${numero}. Générer et envoyer facture acompte (30%) au client.` },
      { 'Titre': `Envoyer commandes fournisseurs — ${numero}`, 'Assignée à': 'Virginie', 'Priorité': 'Haute', 'Statut': 'À faire', 'Échéance': plus7, 'Description': `${commandesCreees.length} commande(s) à envoyer : ${commandesCreees.map(c=>c.type).join(', ')}.` },
      { 'Titre': `Planifier pose — ${numero}`, 'Assignée à': 'Sébastien', 'Priorité': 'Moyenne', 'Statut': 'À faire', 'Description': `Définir la date de pose et affecter l'équipe pour le BC ${numero}.` }
    ];
    if (projetId) tachesFields.forEach(t => t['Projet'] = [projetId]);
    await atCreateBatch(TABLES.taches.id, tachesFields);

    // 6. MAJ du statut devis + projet
    await atPatch(TABLES.devis.id, devisId, { 'Statut': 'Signé' });
    if (projetId) {
      try { await atPatch(TABLES.projets.id, projetId, { 'Statut': 'Commandes' }); } catch(e){}
    }

    res.json({
      ok: true,
      commandes_creees: commandesCreees.length,
      taches_creees: tachesFields.length,
      detail: commandesCreees
    });
  } catch (e) {
    logger.error('[devis/sign] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- PLAUD : parsing d'une transcription (R1 = découverte / R2 = chantier) ---
app.post('/api/plaud/parse', requireAuth, async (req, res) => {
  const { transcript, projetId, clientId, type_reunion, niveau } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'transcript requis' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  try {
    const parsed = await parsePlaudTranscript(transcript);
    // Si niveau non fourni : R1 si Type réunion = Découverte/Présentation devis, R2 sinon.
    const typeR = type_reunion || 'Découverte';
    const niveauResolu = (niveau === 'R1' || niveau === 'R2')
      ? niveau
      : (typeR === 'Découverte' || typeR === 'Présentation devis' ? 'R1' : 'R2');
    const fields = {
      'Titre': parsed.titre || 'Réunion Plaud',
      'Type réunion': typeR,
      'Niveau': niveauResolu,
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
    res.json({ ok: true, record: rec, parsed, niveau: niveauResolu });
  } catch (e) {
    logger.error('[plaud/parse] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- DEVIS ARTISAN : import PDF + parsing + création record ---
app.post('/api/artisan-devis/import', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  const projetId = req.body.projetId || null;
  const artisanId = req.body.artisanId || null; // optionnel — sinon on match par nom d'entreprise

  try {
    logger.info(`[artisan-devis/import] parsing ${req.file.originalname} (${req.file.size} bytes)`);
    const parsed = await parseArtisanDevisPdf(req.file.buffer);
    logger.info(`[artisan-devis/import] ✓ parsed: ${parsed.artisan?.entreprise} / ${euros(parsed.totaux?.total_ht)}`);

    // Résolution artisan : si pas fourni, match par nom d'entreprise
    let resolvedArtisanId = artisanId;
    if (!resolvedArtisanId && parsed.artisan?.entreprise) {
      const nomNorm = String(parsed.artisan.entreprise).trim().toUpperCase();
      const allArtisans = await atFetchAll(TABLES.artisans.id);
      const match = allArtisans.find(a => (a.fields?.Nom || '').trim().toUpperCase().includes(nomNorm) ||
                                            nomNorm.includes((a.fields?.Nom || '').trim().toUpperCase()));
      if (match) {
        resolvedArtisanId = match.id;
        logger.info(`[artisan-devis/import] artisan matché: ${match.fields.Nom}`);
      }
    }

    const montantHT = Number(parsed.totaux?.total_ht) || 0;
    const montantTTC = Number(parsed.totaux?.total_ttc) || 0;
    const retrocom = Math.round(montantHT * 0.05 * 100) / 100;

    // Adresse chantier : concat si multi-lignes
    const adresseChantier = parsed.chantier?.adresse || parsed.client?.adresse_facturation || '';

    const fields = {
      'Numéro devis': parsed.metadata?.numero_devis || `AUTO-${Date.now()}`,
      'Date devis': parsed.metadata?.date_devis || null,
      'Montant HT': montantHT || null,
      'Montant TTC': montantTTC || null,
      'Rétro-commission HT': retrocom || null,
      'Statut': 'À valider',
      'Description travaux': parsed.description_travaux || '',
      'Adresse chantier': adresseChantier,
      'Notes': parsed.alertes_parsing || ''
    };
    if (projetId) fields['Projet'] = [projetId];
    if (resolvedArtisanId) fields['Artisan'] = [resolvedArtisanId];

    // Nettoyage null/empty
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === '') delete fields[k]; });

    const rec = await atCreate(TABLES['devis-artisans'].id, fields);
    const recordId = rec.id;

    // Upload du PDF original en attachment
    try {
      await atUploadAttachment(recordId, DA_FIELDS.pdfOriginal, req.file.buffer, req.file.originalname || 'devis-artisan.pdf');
      logger.info(`[artisan-devis/import] PDF attaché au record ${recordId}`);
    } catch (e) {
      logger.warn(`[artisan-devis/import] upload PDF échoué (record créé quand même): ${e.message}`);
    }

    // Auto-ajouter l'artisan à la liste Artisans du projet (si match + projet défini)
    if (resolvedArtisanId && projetId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
          { headers: { Authorization: `Bearer ${AT_KEY}` } });
        if (pr.ok) {
          const projetData = await pr.json();
          const current = Array.isArray(projetData.fields?.Artisans) ? projetData.fields.Artisans : [];
          if (!current.includes(resolvedArtisanId)) {
            await atPatch(TABLES.projets.id, projetId, { Artisans: [...current, resolvedArtisanId] });
            logger.info(`[artisan-devis/import] artisan ${resolvedArtisanId} ajouté au projet ${projetId}`);
          }
        }
      } catch (e) {
        logger.warn(`[artisan-devis/import] ajout artisan au projet échoué: ${e.message}`);
      }
    }

    res.json({
      ok: true,
      recordId,
      artisan_matched: !!resolvedArtisanId,
      artisan_name: parsed.artisan?.entreprise,
      parsed_summary: {
        numero: parsed.metadata?.numero_devis,
        montant_ht: montantHT,
        montant_ttc: montantTTC,
        retrocommission: retrocom
      }
    });
  } catch (e) {
    logger.error('[artisan-devis/import] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- Génération Fiche de mission : logique mutualisée ---
// Prend projetId + artisanId, trouve un devis artisan lié (optionnel) pour enrichir,
// génère le PDF, l'attache au projet (Fiches de mission) et au devis artisan s'il existe,
// retourne { ficheUrl, mailto, artisanEmail, artisanNom }.
async function generateAndAttachFicheMission(projetId, artisanId) {
  if (!projetId) throw new Error('projetId requis');
  if (!artisanId) throw new Error('artisanId requis');

  // 1. Projet + client
  const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!pr.ok) throw new Error('Projet introuvable');
  const projet = (await pr.json()).fields || {};
  const projetRef = projet['Référence'] || '—';
  let clientNom = '—';
  const clientId = Array.isArray(projet['Client']) ? projet['Client'][0] : null;
  if (clientId) {
    const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientId}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (cr.ok) clientNom = ((await cr.json()).fields || {}).Nom || '—';
  }

  // 2. Artisan
  const ar = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.artisans.id}/${artisanId}`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!ar.ok) throw new Error('Artisan introuvable');
  const artisan = (await ar.json()).fields || {};

  // 3. Devis artisan lié (si existe) — le plus récent
  const allDA = await atFetchAll(TABLES['devis-artisans'].id);
  const daRec = allDA.find(d =>
    Array.isArray(d.fields?.Projet) && d.fields.Projet.includes(projetId) &&
    Array.isArray(d.fields?.Artisan) && d.fields.Artisan.includes(artisanId)
  );
  const da = daRec?.fields || {};

  // 4. Données pour la fiche (adresse chantier : fallback vers projet si devis absent)
  const adresseChantier = da['Adresse chantier']
    || projet['Adresse chantier']
    || (projet['Description'] || '').split('\n').slice(0,2).join('\n')
    || '—';

  const pdfBuffer = await generateFicheMission({
    projetRef,
    clientNom,
    adresseChantier,
    artisanNom: artisan.Nom || '—',
    artisanContact: artisan['Contact principal'] || '',
    artisanEmail: artisan.Email || '',
    artisanSpecialite: artisan['Spécialité'] || '',
    numeroDevis: da['Numéro devis'] || '',
    dateDevis: da['Date devis'] || null,
    dateDemarrage: da['Date démarrage prévue'] || projet['Date pose prévue'] || null,
    descriptionTravaux: da['Description travaux'] || '',
    notes: da['Notes'] || ''
  });

  const safeName = (artisan.Nom || 'artisan').replace(/[^A-Za-z0-9-_]/g, '_');
  const filename = `Fiche-mission-${projetRef.replace(/[^A-Za-z0-9-_]/g, '_')}-${safeName}.pdf`;

  // 5. Upload sur Projet.Fiches de mission (accumule)
  let ficheUrl = null;
  try {
    const up = await atUploadAttachment(projetId, 'fldOVKxE25bT4zDfa', pdfBuffer, filename);
    // Airtable renvoie l'attachment — on re-fetch pour l'URL fraîche
    const pf = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    const pfdata = pf.ok ? (await pf.json()).fields : {};
    const list = pfdata['Fiches de mission'] || [];
    // Prendre le plus récent par filename
    const match = list.find(a => a.filename === filename) || list[list.length - 1];
    ficheUrl = match?.url || null;
  } catch (e) {
    logger.warn(`[fiche-mission] upload projet.Fiches échoué: ${e.message}`);
  }

  // 6. Si devis artisan existe : y attacher aussi + passer statut "Fiche envoyée"
  if (daRec) {
    try { await atUploadAttachment(daRec.id, DA_FIELDS.ficheMission, pdfBuffer, filename); } catch(e) {}
    try { await atPatch(TABLES['devis-artisans'].id, daRec.id, { 'Statut': 'Fiche envoyée' }); } catch(e) {}
  }

  // 7. Construire le mailto
  const subject = `[Tanguy Design] Fiche de mission — ${projetRef}`;
  const firstName = (artisan['Contact principal'] || artisan.Nom || '').split(/[/\n]/)[0].trim();
  const bodyLines = [
    `Bonjour ${firstName},`,
    ``,
    `Le chantier « ${projetRef} » vous est confié. Vous trouverez en pièce jointe la fiche de mission avec les informations principales (adresse, client, contact).`,
    ``,
    `Chantier : ${adresseChantier}`,
    `Client : ${clientNom}`,
    ``,
    `${ficheUrl ? `Fiche de mission PDF : ${ficheUrl}` : '(voir pièce jointe)'}`,
    ``,
    `Pour toute question, n'hésitez pas à nous revenir.`,
    ``,
    `Cordialement,`,
    `L'équipe Tanguy Design`
  ].join('\n');
  const mailto = `mailto:${encodeURIComponent(artisan.Email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines)}`;

  return {
    ok: true,
    ficheUrl,
    mailto,
    artisanEmail: artisan.Email || null,
    artisanNom: artisan.Nom || null,
    hasDevis: !!daRec
  };
}

// --- Fiche de mission par (projet, artisan) — nouveau endpoint principal ---
app.post('/api/fiche-mission', requireAuth, async (req, res) => {
  const { projetId, artisanId } = req.body || {};
  if (!projetId || !artisanId) return res.status(400).json({ error: 'projetId et artisanId requis' });
  try {
    const result = await generateAndAttachFicheMission(projetId, artisanId);
    res.json(result);
  } catch (e) {
    logger.error('[fiche-mission] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- DEVIS ARTISAN : génère la Fiche (résout projet+artisan depuis le devis) ---
app.post('/api/artisan-devis/:id/fiche-mission', requireAuth, async (req, res) => {
  const recordId = req.params.id;
  try {
    const daUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLES['devis-artisans'].id}/${recordId}`;
    const dar = await fetch(daUrl, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!dar.ok) throw new Error('Devis artisan introuvable');
    const f = (await dar.json()).fields || {};
    const projetId = Array.isArray(f['Projet']) ? f['Projet'][0] : null;
    const artisanId = Array.isArray(f['Artisan']) ? f['Artisan'][0] : null;
    if (!projetId) return res.status(400).json({ error: 'Devis sans projet lié' });
    if (!artisanId) return res.status(400).json({ error: 'Devis sans artisan lié' });
    const result = await generateAndAttachFicheMission(projetId, artisanId);
    res.json(result);
  } catch (e) {
    logger.error('[artisan-devis/fiche-mission] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- PROJET ATTACHMENTS : upload + suppression dans les 3 zones ---
const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // Airtable content API limit
});

app.post('/api/projets/:id/attachments', requireAuth, uploadAny.single('file'), async (req, res) => {
  const projetId = req.params.id;
  const field = req.body.field;
  if (!req.file) return res.status(400).json({ error: 'file requis' });
  if (!(field in PROJET_ATTACHMENT_FIELDS)) {
    return res.status(400).json({ error: `field invalide (attendu: ${Object.keys(PROJET_ATTACHMENT_FIELDS).join(', ')})` });
  }
  try {
    const fieldId = await resolveProjetFieldId(field);
    const ct = req.file.mimetype || 'application/octet-stream';
    await atUploadAttachment(projetId, fieldId, req.file.buffer, req.file.originalname, ct);
    res.json({ ok: true, filename: req.file.originalname });
  } catch (e) {
    logger.error('[projets/upload] error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projets/:id/journal', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text requis' });
  try {
    const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!pr.ok) throw new Error('projet introuvable');
    const current = ((await pr.json()).fields?.['Journal chantier']) || '';
    const now = new Date();
    const stamp = `${now.toISOString().slice(0,10)} ${now.toTimeString().slice(0,5)}`;
    const author = req.session.user ? req.session.user.charAt(0).toUpperCase() + req.session.user.slice(1) : 'Équipe';
    const entry = `[${stamp} — ${author}] ${text}`;
    const next = entry + (current ? '\n' + current : ''); // plus récent en haut
    await atPatch(TABLES.projets.id, projetId, { 'Journal chantier': next });
    res.json({ ok: true, entry });
  } catch (e) {
    logger.error('[projets/journal] error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projets/:id/attachments', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  const { field, attachmentId } = req.body || {};
  if (!field || !attachmentId) return res.status(400).json({ error: 'field + attachmentId requis' });
  if (!(field in PROJET_ATTACHMENT_FIELDS)) {
    return res.status(400).json({ error: `field invalide (attendu: ${Object.keys(PROJET_ATTACHMENT_FIELDS).join(', ')})` });
  }
  try {
    // Vérifie que le champ existe côté Airtable (résout le fieldId au passage pour cache).
    await resolveProjetFieldId(field);
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) throw new Error('projet introuvable');
    const current = ((await r.json()).fields?.[field]) || [];
    const next = current.filter(a => a.id !== attachmentId);
    if (next.length === current.length) return res.status(404).json({ error: 'attachment introuvable' });
    await atPatch(TABLES.projets.id, projetId, { [field]: next });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[projets/delete-attachment] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH date pose prévue du projet + recalcul des dates d'échéance liées (fix bug Morales).
// Voir docs/refonte-v3-2026-05-20/bug-morales-echeances.md.
app.patch('/api/projets/:id/date-pose', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  const { datePose } = req.body || {};
  if (!datePose || !/^\d{4}-\d{2}-\d{2}$/.test(datePose)) {
    return res.status(400).json({ error: 'datePose au format YYYY-MM-DD requis' });
  }
  try {
    // 1. Update du projet
    await atPatch(TABLES.projets.id, projetId, { 'Date pose prévue': datePose });

    // 2. Recalcul des dates d'échéance liées (sur les devis de ce projet)
    const filter = `FIND('${projetId}', ARRAYJOIN({Projet}))`;
    const devisList = await atFetchFiltered(TABLES.devis.id, filter);
    let recalcCount = 0;
    for (const d of devisList) {
      const dateDevis = d.fields['Date devis'] || null;
      const echIds = d.fields['Échéances devis'] || [];
      if (!echIds.length) continue;
      const echRecords = await atFetchFiltered(
        TABLES['echeances-devis'].id,
        `FIND('${d.id}', ARRAYJOIN({Devis}))`
      );
      // Reformater pour helper (libelle / date_prevue)
      const echeancesForHelper = echRecords.map(r => ({
        _id: r.id,
        libelle: r.fields['Libellé'] || '',
        date_prevue: null, // toujours recalculer ici (override)
      }));
      const enriched = enrichEcheancesAvecDates(echeancesForHelper, dateDevis, datePose);
      for (const e of enriched) {
        if (e.date_prevue) {
          await atPatch(TABLES['echeances-devis'].id, e._id, { 'Date prévue': e.date_prevue });
          recalcCount++;
        }
      }
    }
    logger.info({ projetId, datePose, recalcCount }, 'date-pose mise à jour + échéances recalculées');
    res.json({ ok: true, recalcCount });
  } catch (e) {
    logger.error({ err: e.message, projetId }, '[projets/date-pose] error');
    res.status(500).json({ error: e.message });
  }
});

// --- Helper pour log ---
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// --- SAV : proxy vers webhook n8n du cockpit central 9·58 ----------------
// Le cockpit central ouvre les tickets dans Airtable TICKETS_TBL et alimente
// la zone Pilotage. Auth via header X-958-Secret. Configurable par env vars.
const SAV_WEBHOOK_URL    = process.env.SAV_WEBHOOK_URL    || 'https://jmg958.app.n8n.cloud/webhook/sav-receiver';
const SAV_WEBHOOK_SECRET = process.env.SAV_WEBHOOK_SECRET || '';
const SAV_CLIENT_SLUG    = process.env.SAV_CLIENT_SLUG    || 'tanguy';
const SAV_COCKPIT_SOURCE = process.env.SAV_COCKPIT_SOURCE || 'Cockpit Tanguy Design';
const SAV_ABONNEMENT     = process.env.SAV_ABONNEMENT     || 'Build';

app.post('/api/sav/submit', requireAuth, async (req, res) => {
  if (!SAV_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'SAV_WEBHOOK_SECRET non configuré côté serveur' });
  }
  const { categorie, urgence, titre, description } = req.body || {};
  if (!titre || !description) {
    return res.status(400).json({ error: 'Titre et description requis' });
  }
  try {
    const payload = {
      client_slug: SAV_CLIENT_SLUG,
      cockpit_source: SAV_COCKPIT_SOURCE,
      abonnement: SAV_ABONNEMENT,
      categorie: categorie || 'Autre',
      urgence: urgence || 'P3',
      titre: String(titre).slice(0, 200),
      description: String(description).slice(0, 5000),
      auteur_email: req.session?.user ? `${req.session.user}@tanguydesign.local` : '',
    };
    const r = await fetch(SAV_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-958-Secret': SAV_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.error(`[sav/submit] n8n ${r.status}: ${txt.slice(0,200)}`);
      return res.status(502).json({ error: `Webhook 9·58 indisponible (${r.status})` });
    }
    const data = await r.json().catch(() => ({}));
    res.json({ ok: true, ticket_id: data.ticket_id, notification_id: data.notification_id });
  } catch (e) {
    logger.error('[sav/submit] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Static ---
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));

app.listen(PORT, () => {
  logger.info({
    port: PORT,
    users: Object.keys(USERS).length,
    airtable: !!BASE_ID,
    claude: !!process.env.ANTHROPIC_API_KEY,
    env: IS_PROD ? 'production' : 'development',
  }, `Tanguy Design Cockpit v0.3.0 démarré sur port ${PORT}`);
});
