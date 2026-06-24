const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
// fetch est natif depuis Node 18, requis Node 20+ (cf. package.json engines).
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const { parseDevisPdf, parsePlaudTranscript } = require('./services/devis-parser');
const { parseArtisanDevisPdf } = require('./services/artisan-devis-parser');
const { generateFicheMission } = require('./services/fiche-mission-generator');
const { generateBcPdf } = require('./services/bc-pdf-generator');
const { enrichEcheancesAvecDates } = require('./services/echeances-helper');
const { parseFactureFournisseurPdf } = require('./services/facture-fournisseur-parser');
const { buildPlanTresorerie, echeancesFacturees, mondayOf, addDays, toCsv } = require('./services/tresorerie-helper');
const { recapPaieMois, alertesVisitesMedicales, joursOuvres } = require('./services/rh-helper');
const { joursRetard, niveauRelanceSuggere, buildEmailRelance, buildEmailRelanceFournisseur, buildMailto } = require('./services/relances-helper');
const { buildRetroApporteurs, TAUX_RETRO } = require('./services/retro-apporteurs-helper');
const { canAccess, pickAllowedFields } = require('./services/acl');
const logger = require('./services/logger');
const usersStore = require('./services/users-store');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// RC Pro 2026 : logs PII (noms clients/artisans) en mode debug seulement.
// En prod : silencieux pour respecter la minimisation RGPD des logs.
function logPII(msg) {
  if (!IS_PROD) logger.info(msg);
}

// --- Session secret : refus de démarrer en prod sans secret robuste ---
const SESSION_SECRET_FALLBACK = 'dev-only-change-me';
if (IS_PROD) {
  const s = process.env.SESSION_SECRET || '';
  if (!s || s === SESSION_SECRET_FALLBACK || s.length < 32) {
    logger.error('❌ SESSION_SECRET manquant ou trop court (min 32 chars). En prod, génère avec: openssl rand -hex 32');
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
  'rendez-vous':   { id: 'tbli7Rdwv7J3XY3dU', name: 'Rendez-vous' },
  'reunions-plaud':    { id: 'tblWYGr3ETRWxrE63', name: 'Réunions Plaud' },
  devis:           { id: 'tblWklGEKMiBStXCs', name: 'Devis' },
  'zones-devis':   { id: 'tbl6FmEIIR15NMsgZ', name: 'Zones devis' },
  'lignes-devis':  { id: 'tblCxDvzQAqBzpCx2', name: 'Lignes devis' },
  'echeances-devis': { id: 'tblML7D7MXeWnMcxy', name: 'Échéances devis' },
  stock:           { id: 'tblENw2eBplwUZ4nd', name: 'Stock' },
  'devis-artisans': { id: 'tblFxsJtEYpDOmQQj', name: 'Devis Artisans' },
  // Sprint v5 — Automatisation Virginie (2026-06)
  'factures-clients':      { id: 'tblUdblJl5bohxcTd', name: 'Factures clients' },
  'factures-fournisseurs': { id: 'tblhFunkaTOcDoROM', name: 'Factures fournisseurs' },
  salaries:                { id: 'tblm0VR0eriWBkvs4', name: 'Salariés' },
  absences:                { id: 'tbl89I9NcQ9Esb5jp', name: 'Absences' },
  'heures-salaries':       { id: 'tblLecQk6Hdf0rqLK', name: 'Heures salariés' },
  // Sprint v5.1 — Aide utilisateur éditable par les admins depuis le cockpit
  aide:                    { id: 'tblpOREwCKcKtKEef', name: 'Aide' },
  // Chantier Devis express (P-H1, 2026-06) — grille de référence éco-participation
  'eco-participation':     { id: 'tblJavUnoshZvdKIg', name: 'Éco-participation' }
};

// Field IDs attachments des tables v5 (upload direct, cf. DA_FIELDS)
const FF_FIELDS = { pdf: 'fldcYOyaxcOsG80lp' }; // Factures fournisseurs → PDF

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

// Sprint v3.24 — Vrais emails users pour le SAV (vs login@tanguydesign.local fake)
// Format env var USERS_EMAILS="virginie:virginie@tanguydesign.com,solene:solene@..."
// JMG TODO : à terme, admin UI permettra à Virginie d'éditer les emails depuis le
// cockpit sans toucher aux env vars Scaleway (créer table Airtable "Users" + CRUD).
const USERS_EMAILS = (() => {
  const map = {};
  const raw = process.env.USERS_EMAILS || '';
  for (const part of raw.split(',')) {
    const [login, email] = part.split(':').map(s => s.trim());
    if (login && email) map[login.toLowerCase()] = email;
  }
  return map;
})();
function getUserEmail(login) {
  if (!login) return '';
  const lo = String(login).toLowerCase();
  return USERS_EMAILS[lo] || `${lo}@tanguydesign.local`;
}

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
// CSP : Sprint 0.7 — script-src n'a plus besoin de 'unsafe-inline' (JS externe dans /assets/js/main.js).
// script-src-attr garde 'unsafe-inline' tant que les onclick="..." inline persistent dans index.html.
// style-src garde 'unsafe-inline' pour les style="..." inline encore présents.
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
  // Sprint 4 P2 : Permissions-Policy explicite (camera/mic/géoloc bloqués — cockpit n'en a pas besoin)
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

// Permissions-Policy header (helmet ne le set pas par défaut)
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=()');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'tanguy.sid',
  keys: [process.env.SESSION_SECRET || SESSION_SECRET_FALLBACK],
  httpOnly: true,
  // RC Pro 2026 : sameSite='strict' (vs 'lax') bloque les CSRF cross-site, y compris navigations top-level.
  // Trade-off UX : un user qui clique sur un lien externe vers tanguydesign.958.fr en étant déjà loggué
  // verra une page non-authentifiée (cookie pas envoyé sur la 1re requête). Acceptable ici (cockpit interne).
  sameSite: 'strict',
  secure: IS_PROD, // HTTPS only en prod
  maxAge: 1000 * 60 * 60 * 24 * 30
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not authenticated' });
  return res.redirect('/login');
}

// RC Pro 2026 : refuse l'accès si user n'est pas dans ADMIN_LOGINS (Stock, Marges, etc.)
// Le menu Admin frontend était masqué via window.ME_ADMIN mais l'API restait ouverte
// à tout user authentifié (bypass trivial via curl). Ajout d'un check serveur.
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'not authenticated' });
  }
  if (!ADMIN_LOGINS.has(req.session.user)) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}

// ACL complète /api/data/:table : cf. services/acl.js (Sprint 0.7).
// Mapping (table × verb × role) + whitelist des champs modifiables par table.
// Remplace l'ancien requireAdminIfRestrictedTable qui ne protégeait que `stock`.
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

// ────────────────────────────────────────────────────────────────────────────────
// withKeepAlive — wrapper pour les routes qui appellent Claude (PDF parsing, Plaud)
// ────────────────────────────────────────────────────────────────────────────────
// Cloudflare timeout = 100s sans byte reçu de l'origine. Sonnet 4.5 + vision PDF
// peut prendre 60-120s → CF coupe avec HTTP 524 alors que le backend est encore
// en train d'attendre Anthropic.
//
// Solution : envoyer 1 byte (un espace, compatible JSON.parse côté client) toutes
// les 20s pour que CF reset son timer "no data received". Le client final reçoit
// du whitespace au début + le JSON à la fin → JSON.parse gère bien.
//
// Compromise : si l'origine échoue APRÈS le 1er byte envoyé, on ne peut plus
// retourner un status 4xx/5xx → le response sera 200 avec {error: ...}. Le
// frontend doit donc check à la fois r.ok ET d.error (déjà mis à jour).
async function withKeepAlive(req, res, handler) {
  // Disable buffering pour qu'Express envoie chaque write au client immédiatement
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx & équivalent
  res.write(' '); // flush initial → CF voit le 1er byte
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let keepAlive = setInterval(() => {
    try { res.write(' '); } catch (_) {}
  }, 20000); // toutes les 20s (< 100s CF timeout)

  try {
    const result = await handler();
    clearInterval(keepAlive);
    keepAlive = null;
    res.end(JSON.stringify(result));
  } catch (e) {
    if (keepAlive) clearInterval(keepAlive);
    logger.error('[withKeepAlive] error:', e.message);
    // headers déjà envoyés → on ne peut plus changer le status, on retourne JSON {error}
    try {
      res.end(JSON.stringify({ error: e.message || 'erreur serveur' }));
    } catch (_) {
      // socket peut-être fermé, abandonner silencieusement
    }
  }
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

// Sprint 4 — Account lockout par login (en plus du rate-limit par IP).
// Un attaquant pivotant sur plusieurs IPs ne peut plus brute-forcer un compte donné.
// 5 échecs consécutifs → lock 15 min pour ce login (toute IP confondue).
const ACCOUNT_LOCK_MAX_FAILS = 5;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;
const accountLockout = new Map(); // login.toLowerCase() → { fails, lockedUntil }
function accountIsLocked(login) {
  const entry = accountLockout.get(login);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) accountLockout.delete(login);
  return false;
}
function accountRegisterFail(login) {
  const entry = accountLockout.get(login) || { fails: 0, lockedUntil: 0 };
  entry.fails++;
  if (entry.fails >= ACCOUNT_LOCK_MAX_FAILS) {
    entry.lockedUntil = Date.now() + ACCOUNT_LOCK_DURATION_MS;
    logger.warn({ login, fails: entry.fails }, 'account locked after consecutive fails');
  }
  accountLockout.set(login, entry);
}
function accountRegisterSuccess(login) {
  accountLockout.delete(login);
}

// Multer pour upload PDF (stockage mémoire, 15MB max)
// Note : fileFilter ne voit que le mimetype déclaré (manipulable). La validation
// magic bytes "%PDF-" est faite après l'upload côté route, avant l'appel Claude.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  }
});

// Vérifie les 4 premiers bytes du buffer pour confirmer signature PDF (Sprint 4 P1-6).
// Empêche un upload non-PDF étiqueté avec un mimetype manipulé.
function validatePdfMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // PDF commence par %PDF-
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

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

// --- Admin : tableau marges par projet (Sprint 5) ---
// Pour chaque projet : CA HT, coût fournisseurs (commandes), coût artisans (devis-artisans),
// rétro-commission 5% sur artisans contractuels, marge € + %.
app.get('/api/admin/marges', requireAuth, async (req, res) => {
  if (!ADMIN_LOGINS.has(req.session?.user)) return res.status(403).json({ error: 'admin requis' });
  try {
    const [projets, commandes, devisArtisans, artisans, clients] = await Promise.all([
      atFetchAll(TABLES.projets.id),
      atFetchAll(TABLES.commandes.id),
      atFetchAll(TABLES['devis-artisans'].id),
      atFetchAll(TABLES.artisans.id),
      atFetchAll(TABLES.clients.id),
    ]);
    const clientById = new Map(clients.map(c => [c.id, c]));
    const artisanById = new Map(artisans.map(a => [a.id, a]));

    const rows = projets.map(p => {
      const f = p.fields || {};
      const projetCmds = commandes.filter(c => (c.fields?.Projet || []).includes(p.id));
      const projetDA = devisArtisans.filter(d => (d.fields?.Projet || []).includes(p.id));
      const caHT = f['Budget HT'] || 0;
      const coutFourn = projetCmds.reduce((s, c) => s + (c.fields?.['Montant HT'] || 0), 0);
      const coutArtisans = projetDA.reduce((s, d) => s + (d.fields?.['Montant HT'] || 0), 0);
      const retro = projetDA.filter(d => {
        const aId = (d.fields?.Artisan || [])[0];
        return aId && artisanById.get(aId)?.fields?.Contractuel;
      }).reduce((s, d) => s + (d.fields?.['Montant HT'] || 0) * 0.05, 0);
      const margeAbs = caHT - coutFourn - coutArtisans + retro;
      const margePct = caHT > 0 ? (margeAbs / caHT) * 100 : null;
      const clientNom = clientById.get((f.Client || [])[0])?.fields?.Nom || '?';
      return {
        id: p.id,
        reference: f.Référence,
        client: clientNom,
        phase: f['Phase commerciale'] || f.Statut,
        chantier: f['Statut chantier'] || '',
        caHT, coutFourn, coutArtisans, retro,
        margeAbs, margePct,
      };
    });
    res.json({ ok: true, rows });
  } catch (e) {
    logger.error({ err: e.message }, '[admin/marges] error');
    res.status(500).json({ error: e.message });
  }
});

// --- Admin : rétrocessions apporteurs d'affaires (rétro 3 %) ---
// Pour chaque apporteur (champ singleSelect "Apporteur" sur Clients) : nb de dossiers
// SIGNÉS apportés, CA HT apporté (Σ Budget HT des projets signés), rétro 3 % = 3 % du CA HT.
// Périmètre : projets Phase commerciale === 'Signé' uniquement (cf. retro-apporteurs-helper).
// Défensif : si le champ "Apporteur" n'existe pas encore (script schéma non exécuté),
// aucun client n'a d'apporteur → rows vide, pas d'erreur.
app.get('/api/retro-apporteurs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [projets, clients] = await Promise.all([
      atFetchAll(TABLES.projets.id),
      atFetchAll(TABLES.clients.id),
    ]);
    const clientsNorm = clients.map(c => ({ id: c.id, Apporteur: c.fields?.['Apporteur'] }));
    const projetsNorm = projets.map(p => ({
      clientIds: p.fields?.Client || [],
      budgetHT: p.fields?.['Budget HT'] || 0,
      phase: p.fields?.['Phase commerciale'] || p.fields?.Statut || '',
    }));
    const { rows, totaux } = buildRetroApporteurs({ clients: clientsNorm, projets: projetsNorm });
    res.json({ ok: true, taux: TAUX_RETRO, rows, totaux });
  } catch (e) {
    logger.error({ err: e.message }, '[retro-apporteurs] error');
    res.status(500).json({ error: e.message });
  }
});

// --- Admin : IA suggestions cockpit (Sprint 4 P2) ---
// Analyse l'état du cockpit (projets en cours, alertes, marges, blockages) et demande à
// Claude (claude-sonnet-4-5) une synthèse + 5 suggestions actionnables. Admin only.
// (Grand nettoyage 2026-06-07 : requireAdmin était redéfini ici à l'identique —
// doublon supprimé, on utilise la définition RC Pro 2026 plus haut.)
app.get('/api/admin/ai-suggestions', requireAuth, requireAdmin, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });
  await withKeepAlive(req, res, async () => {
    // 1. Snapshot état cockpit
    const [clients, projets, taches, commandes] = await Promise.all([
      atFetchAll(TABLES.clients.id),
      atFetchAll(TABLES.projets.id),
      atFetchAll(TABLES.taches.id),
      atFetchAll(TABLES.commandes.id),
    ]);
    const now = new Date();
    const aujourdhui = now.toISOString().slice(0, 10);

    const projetsEnCours = projets.filter(p => {
      const c = p.fields['Statut chantier'];
      return c && c !== 'Archivé' && c !== 'Terminé';
    });
    const tachesEnRetard = taches.filter(t => {
      const e = t.fields['Échéance'];
      return e && e < aujourdhui && t.fields['Statut'] !== 'Terminée';
    });
    const projetsBloques = projets.filter(p => {
      const dDec = p.fields['Date découverte'];
      if (!dDec) return false;
      const age = Math.floor((now - new Date(dDec)) / 86400000);
      return age > 30 && p.fields['Phase commerciale'] !== 'Signé';
    });

    const snapshot = {
      date_snapshot: aujourdhui,
      nb_clients: clients.length,
      nb_projets_total: projets.length,
      nb_projets_en_cours: projetsEnCours.length,
      nb_taches_en_retard: tachesEnRetard.length,
      nb_projets_bloques_30j: projetsBloques.length,
      ca_total_prevu: projets.reduce((s, p) => s + (p.fields['Budget HT'] || 0), 0),
      repartition_phases: projets.reduce((acc, p) => {
        const k = p.fields['Phase commerciale'] || p.fields.Statut || 'inconnu';
        acc[k] = (acc[k] || 0) + 1; return acc;
      }, {}),
      top_taches_retard: tachesEnRetard.slice(0, 5).map(t => ({
        titre: t.fields.Titre, assignee: t.fields['Assignée à'], echeance: t.fields['Échéance']
      })),
      top_projets_bloques: projetsBloques.slice(0, 5).map(p => ({
        ref: p.fields.Référence, phase: p.fields['Phase commerciale'], decouverte: p.fields['Date découverte']
      })),
    };

    // 2. Claude analyse
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Tu es un consultant senior qui analyse le cockpit de gestion de Tanguy Design (agence cuisine 4 collaborateurs à Vannes).
Voici un snapshot JSON de l'état du cockpit aujourd'hui :

${JSON.stringify(snapshot, null, 2)}

Réponds en JSON strict avec :
{
  "synthese": "2-3 phrases sur l'état global (santé pipeline, charge tâches, points chauds)",
  "points_attention": ["3-5 points concrets prioritaires aujourd'hui, formulés en impératif court"],
  "suggestions": ["5 suggestions actionnables et spécifiques pour optimiser la semaine"],
  "alerte_critique": "phrase ou null — uniquement si une situation est vraiment urgente (projet pose < 7 j sans commandes, etc.)"
}

Sois concret, factuel, pas creux. Cible Tanguy ou Virginie qui lisent ça en 30 secondes le matin.`;
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first === -1) throw new Error('Réponse Claude sans JSON');
    const analysis = JSON.parse(text.slice(first, last + 1));

    return { ok: true, snapshot, analysis, generatedAt: new Date().toISOString() };
  });
});

// --- Support feedback (Sprint 4 P2 / v3.20) ---
// Bouton flottant v3 → POST ici. On log structuré JSON (Scaleway Logs Browser)
// ET on forwarde au webhook 9·58 si configuré, pour créer un ticket dans le
// cockpit central (Airtable TICKETS_TBL → zone Pilotage 958).
//
// JMG 2026-05-21 : "Le bouton SAV en bas à droite ne m'envoie pas de
// notification sur mon cockpit comme avant" → réintégration du forward webhook.
app.post('/api/support/feedback', requireAuth, async (req, res) => {
  const { message, url, context } = req.body || {};
  if (!message || message.length < 5) return res.status(400).json({ error: 'message requis (≥ 5 chars)' });
  if (message.length > 2000) return res.status(400).json({ error: 'message trop long (≤ 2000 chars)' });

  // 1. Log structuré local (toujours, même si webhook KO)
  logger.warn({
    user: req.session?.user,
    url: String(url || '').slice(0, 200),
    context: String(context || '').slice(0, 500),
    message: String(message).slice(0, 2000),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  }, '[support] feedback utilisateur');

  // 2. Forward webhook 9·58 si configuré → ticket dans le cockpit central
  let ticketId = null, notificationId = null;
  if (SAV_WEBHOOK_URL && SAV_WEBHOOK_SECRET) {
    try {
      const payload = {
        client_slug: SAV_CLIENT_SLUG,
        cockpit_source: SAV_COCKPIT_SOURCE,
        abonnement: SAV_ABONNEMENT,
        categorie: 'Feedback cockpit',
        urgence: 'P3',
        titre: `[${req.session?.user || 'user'}] ${String(message).slice(0, 80)}`,
        description: `Message :\n${String(message).slice(0, 2000)}\n\nURL : ${String(url || '').slice(0, 200)}\nContext : ${String(context || '').slice(0, 500)}`,
        auteur_email: await usersStore.getEmail(req.session?.user),
        auteur_login: req.session?.user || '',
        // Sprint v3.23 — Standard inter-cockpits : chaque cockpit déclare son
        // URL de callback. n8n stocke ça dans le ticket et l'appelle à la
        // résolution. Plus de mapping centralisé à maintenir côté 9·58.
        callback_url: SAV_CALLBACK_URL,
      };
      const r = await fetch(SAV_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-958-Secret': SAV_WEBHOOK_SECRET,
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        ticketId = data.ticket_id || null;
        notificationId = data.notification_id || null;
        logger.info({ ticketId, notificationId }, '[support] forwardé au cockpit 9·58');
      } else {
        const txt = await r.text().catch(() => '');
        logger.warn(`[support] webhook 9·58 ${r.status}: ${txt.slice(0,200)} (feedback loggé localement quand même)`);
      }
    } catch (e) {
      logger.warn(`[support] forward webhook 9·58 échoué : ${e.message} (feedback loggé localement)`);
    }
  } else {
    logger.warn('[support] SAV_WEBHOOK_URL ou SAV_WEBHOOK_SECRET non configurés — pas de forward 9·58');
  }

  res.json({ ok: true, ticket_id: ticketId, notification_id: notificationId });
});

// --- Auth ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/login', loginLimiter, async (req, res) => {
  const { login, password } = req.body || {};
  const ip = clientIp(req);
  if (!login || !password) return res.status(400).json({ error: 'login + password requis' });
  const loginLc = String(login).toLowerCase();
  // Account lockout (Sprint 4 P1-5)
  if (accountIsLocked(loginLc)) {
    logger.warn({ login: loginLc, ip }, '[auth] login REJECTED (account locked)');
    return res.status(429).json({ error: 'Trop de tentatives. Compte temporairement verrouillé (15 min).' });
  }
  // Sprint v4 — vérification via users-store (Airtable + fallback env var)
  const user = await usersStore.findUser(loginLc);
  if (!user || !user.actif) {
    accountRegisterFail(loginLc);
    logger.warn({ login: loginLc, ip, reason: user ? 'user désactivé' : 'inconnu' }, '[auth] login FAIL');
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) {
    accountRegisterFail(loginLc);
    logger.warn({ login: loginLc, ip }, '[auth] login FAIL (bad password)');
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  accountRegisterSuccess(loginLc);
  req.session.user = loginLc;
  logger.info({ login: loginLc, ip, source: user.source }, '[auth] login OK');
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// === Sprint v4 — Admin Users (CRUD comptes utilisateurs) ===========================
// Toutes ces routes nécessitent admin (Virginie par défaut, ou ADMIN_LOGINS env).
// Source : table Airtable "Users cockpit" via services/users-store.js.
function requireAdminUsers(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'non authentifié' });
  // Permissive : admin si dans ADMIN_LOGINS env OU si user.admin=true dans Airtable
  if (ADMIN_LOGINS.has(req.session.user)) return next();
  // Check async dans usersStore
  usersStore.isAdmin(req.session.user).then(isAdmin => {
    if (isAdmin) return next();
    return res.status(403).json({ error: 'admin requis pour gérer les utilisateurs' });
  }).catch(e => res.status(500).json({ error: e.message }));
}

app.get('/api/admin/users', requireAdminUsers, async (req, res) => {
  try {
    await usersStore.refreshCache();
    const users = await usersStore.listUsers();
    res.json({ ok: true, users });
  } catch (e) {
    logger.error('[admin/users] list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/users', requireAdminUsers, async (req, res) => {
  const { login, password, email, displayName, admin, notes } = req.body || {};
  try {
    const created = await usersStore.createUser({ login, password, email, displayName, admin, notes });
    logger.info({ by: req.session.user, login: created.login }, '[admin/users] user créé');
    res.json({ ok: true, user: created });
  } catch (e) {
    logger.warn({ err: e.message, by: req.session.user }, '[admin/users] create FAIL');
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', requireAdminUsers, async (req, res) => {
  const { email, displayName, admin, actif, notes } = req.body || {};
  try {
    await usersStore.updateUser(req.params.id, { email, displayName, admin, actif, notes });
    logger.info({ by: req.session.user, id: req.params.id }, '[admin/users] user updated');
    res.json({ ok: true });
  } catch (e) {
    logger.warn({ err: e.message, by: req.session.user, id: req.params.id }, '[admin/users] update FAIL');
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAdminUsers, async (req, res) => {
  const { newPassword } = req.body || {};
  try {
    await usersStore.resetPassword(req.params.id, newPassword);
    logger.warn({ by: req.session.user, id: req.params.id }, '[admin/users] password reset');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/disable', requireAdminUsers, async (req, res) => {
  try {
    await usersStore.disableUser(req.params.id);
    logger.warn({ by: req.session.user, id: req.params.id }, '[admin/users] user désactivé');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/me', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  // Sprint v4 — isAdmin lu depuis Airtable OU env ADMIN_LOGINS (rétrocompat)
  const isAdmin = ADMIN_LOGINS.has(req.session.user) || await usersStore.isAdmin(req.session.user);
  res.json({ user: req.session.user, isAdmin });
});

// --- Data API générique avec ACL (cf. services/acl.js) ---
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

    // Sprint v3.6 (revu) — Pas de mutation auto du statut Airtable des échéances
    // quand la tâche passe à "Terminée". Le statut "Envoyé" est déduit côté UI
    // (présence d'une tâche liée terminée). Le passage à "Encaissé" reste une
    // action manuelle explicite via le bouton "Marquer encaissée" (modale).

    res.json({ ok: true, record: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sprint v3.5 — Création d'une tâche de facturation liée à une échéance.
// JMG 2026-05-21 : "tache facture d'acompte 30% -> création tâche à Virginie
// et quand Virginie marque fait -> Mise à jour de la fiche du projet".
app.post('/api/projets/:projetId/echeances/:echeanceId/facturer', requireAuth, async (req, res) => {
  const { projetId, echeanceId } = req.params;
  try {
    // Récup échéance pour libellé + montant
    const eR = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES['echeances-devis'].id}/${echeanceId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` },
    });
    if (!eR.ok) return res.status(404).json({ error: 'Échéance introuvable' });
    const ech = await eR.json();
    const libelle = ech.fields?.['Libellé'] || 'Facture';
    const montant = ech.fields?.['Montant prévu'] || 0;
    const datePrevue = ech.fields?.['Date prévue'] || null;

    // Récup nom client pour préfixer le titre tâche
    let clientNom = '';
    try {
      const pR = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, {
        headers: { Authorization: `Bearer ${AT_KEY}` },
      });
      if (pR.ok) {
        const p = await pR.json();
        const clientIds = p.fields?.Client || [];
        if (clientIds[0]) {
          const cR = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientIds[0]}`, {
            headers: { Authorization: `Bearer ${AT_KEY}` },
          });
          if (cR.ok) clientNom = (await cR.json()).fields?.Nom || '';
        }
      }
    } catch (e) { /* non bloquant */ }

    const titre = `[${clientNom || 'Projet'}] Facturer ${libelle}${montant ? ' — ' + Math.round(montant).toLocaleString('fr-FR') + ' €' : ''}`;
    const description = `Facture client à émettre.\nMontant prévu : ${montant} €\n${datePrevue ? 'Date prévue : ' + datePrevue + '\n' : ''}\nMarque cette tâche "Terminée" une fois l'encaissement reçu — l'échéance passera automatiquement à "Encaissé" dans le projet.\n\n[echeance:${echeanceId}]`;

    const tacheFields = {
      'Titre': titre,
      'Assignée à': 'Virginie',
      'Priorité': 'Haute',
      'Statut': 'À faire',
      'Description': description,
      'Échéance': datePrevue,
      'Projet': [projetId],
    };
    Object.keys(tacheFields).forEach(k => { if (tacheFields[k] == null || tacheFields[k] === '') delete tacheFields[k]; });

    const t = await atCreate(TABLES.taches.id, tacheFields);
    logger.info({ tacheId: t.id, echeanceId, projetId }, 'tâche facturation créée');
    res.json({ ok: true, tache: t });
  } catch (e) {
    logger.error({ err: e.message, projetId, echeanceId }, '[facturer] error');
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = requireTableAccess(req, res, 'DELETE'); if (!t) return;
  try {
    const d = await atDelete(t.id, req.params.id);
    res.json({ ok: true, deleted: d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- CLIENT : fiche détaillée (client + projets liés agrégés) ---
// Sprint 1 — endpoint dédié pour la fiche client (pivot client-centric).
app.get('/api/clients/:id', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  try {
    // Fiche client (lookup direct)
    const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` },
    });
    if (!cr.ok) {
      if (cr.status === 404) return res.status(404).json({ error: 'Client introuvable' });
      throw new Error(`client lookup: ${cr.status}`);
    }
    const client = await cr.json();

    // Projets liés (via le champ inverse depuis le client)
    const projetIds = client.fields?.Projets || [];
    const projets = await atFetchByIds(TABLES.projets.id, projetIds);

    // Sprint v3.10 — Cas architecte : si ce client est référencé par d'autres clients
    // (champ inverse "From field: Architecte référent"), on récupère ces clients et
    // leurs projets pour agréger le CA généré par l'architecte.
    const clientsRattachesIds = client.fields?.['From field: Architecte référent'] || [];
    let clientsRattaches = [];
    let projetsRattaches = [];
    let archiStats = null;
    if (clientsRattachesIds.length > 0) {
      clientsRattaches = await atFetchByIds(TABLES.clients.id, clientsRattachesIds);
      // Collecter tous les projets de tous les clients liés
      const projetIdsRattaches = clientsRattaches.flatMap(c => c.fields?.Projets || []);
      projetsRattaches = projetIdsRattaches.length
        ? await atFetchByIds(TABLES.projets.id, projetIdsRattaches)
        : [];
      const caCumule = projetsRattaches.reduce((s, p) => s + (p.fields?.['Budget HT'] || 0), 0);
      const chantiersActifs = projetsRattaches.filter(p => {
        const ch = p.fields?.['Statut chantier'] || '';
        return ch && ch !== 'Archivé' && ch !== 'Terminé';
      }).length;
      archiStats = {
        nbClients: clientsRattaches.length,
        nbChantiers: projetsRattaches.length,
        nbChantiersActifs: chantiersActifs,
        caCumule,
      };
    }

    // Agrégats simples pour la fiche du client courant
    const stats = {
      nbProjets: projets.length,
      nbProjetsEnCours: projets.filter(p => (p.fields['Statut chantier'] || '') !== 'Archivé' && (p.fields['Statut chantier'] || '') !== 'Terminé').length,
      caTotal: projets.reduce((sum, p) => sum + (p.fields['Budget HT'] || 0), 0),
    };

    res.json({
      ok: true,
      client,
      projets,
      clientsLies: clientsRattachesIds,
      clientsRattaches,
      projetsRattaches,
      archiStats,
      stats,
    });
  } catch (e) {
    logger.error({ err: e.message, clientId }, '[clients/:id] error');
    res.status(500).json({ error: e.message });
  }
});

// --- CLIENT : liste des projets d'un client ---
app.get('/api/clients/:id/projets', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  try {
    const filter = `FIND('${clientId}', ARRAYJOIN({Client}))`;
    const projets = await atFetchFiltered(TABLES.projets.id, filter);
    res.json({ ok: true, projets });
  } catch (e) {
    logger.error({ err: e.message, clientId }, '[clients/:id/projets] error');
    res.status(500).json({ error: e.message });
  }
});

// --- CLIENT : créer un projet rattaché à un client existant ---
// Force le linking client → projet, complète avec phase commerciale "Découverte" par défaut.
app.post('/api/clients/:id/projets', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  try {
    const body = req.body || {};
    const fields = pickAllowedFields('projets', body.fields || {});
    fields['Client'] = [clientId];
    if (!fields['Phase commerciale']) fields['Phase commerciale'] = 'Découverte';
    if (!fields['Date découverte']) fields['Date découverte'] = new Date().toISOString().slice(0, 10);
    const rec = await atCreate(TABLES.projets.id, fields);
    logger.info({ clientId, projetId: rec.id, ref: rec.fields?.['Référence'] }, 'projet créé rattaché à client');
    res.json({ ok: true, record: rec });
  } catch (e) {
    logger.error({ err: e.message, clientId }, '[clients/:id/projets POST] error');
    res.status(500).json({ error: e.message });
  }
});

// --- PROJET : détail complet (projet + tâches + commandes + devis + Plaud + attachments) ---
// Sprint 2 — agrégat pour fiche projet riche v3 (1 round-trip au lieu de N).
app.get('/api/projets/:id', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  try {
    const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` }
    });
    if (!pr.ok) {
      if (pr.status === 404) return res.status(404).json({ error: 'Projet introuvable' });
      throw new Error(`projet lookup: ${pr.status}`);
    }
    const projet = await pr.json();

    const tacheIds  = projet.fields?.['Tâches']     || [];
    const cmdIds    = projet.fields?.['Commandes']  || [];
    const devisIds  = projet.fields?.['Devis']      || [];
    const plaudIds  = projet.fields?.['Réunions Plaud'] || projet.fields?.['Réunions plaud'] || [];
    // P-B (2026-06-24) — le champ de lien inverse côté Projets s'appelle « Devis Artisans »
    // (A majuscule, fldgKzRCotdiqMei6). L'ancien code lisait « Devis artisans » → daIds toujours
    // vide → les devis artisans ne remontaient jamais sur la fiche projet (card Artisans à 0).
    // On lit les deux casses par sécurité.
    const daIds     = projet.fields?.['Devis Artisans'] || projet.fields?.['Devis artisans'] || [];

    const [taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans] = await Promise.all([
      atFetchByIds(TABLES.taches.id, tacheIds),
      atFetchByIds(TABLES.commandes.id, cmdIds),
      atFetchByIds(TABLES.devis.id, devisIds),
      atFetchByIds(TABLES['reunions-plaud'].id, plaudIds),
      atFetchByIds(TABLES['devis-artisans'].id, daIds),
      atFetchAll(TABLES.fournisseurs.id),
      atFetchAll(TABLES.artisans.id),
    ]);

    // Sprint v3.5 — Échéances liées aux devis (pour section Facturation client)
    const echeanceIds = devis.flatMap(d => d.fields?.['Échéances devis'] || []);
    const echeances = echeanceIds.length
      ? await atFetchByIds(TABLES['echeances-devis'].id, echeanceIds)
      : [];

    // Lookup client (1er linked)
    const clientId = (projet.fields?.Client || [])[0];
    let client = null;
    if (clientId) {
      try {
        const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientId}`, {
          headers: { Authorization: `Bearer ${AT_KEY}` }
        });
        if (cr.ok) client = await cr.json();
      } catch (e) { /* fallback silencieux */ }
    }

    res.json({ ok: true, projet, client, taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans, echeances });
  } catch (e) {
    logger.error({ err: e.message, projetId }, '[projets/:id] error');
    res.status(500).json({ error: e.message });
  }
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
  if (!validatePdfMagicBytes(req.file.buffer)) return res.status(400).json({ error: 'Fichier non reconnu comme PDF (signature %PDF manquante)' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  const projetId = req.body.projetId || null;
  const clientId = req.body.clientId || null;
  const typeDevis = req.body.type === 'Additif' ? 'Additif' : 'Principal';
  if (typeDevis === 'Additif' && !projetId) {
    return res.status(400).json({ error: 'Devis additif : projetId requis (le projet doit déjà exister)' });
  }

  // RC Pro 2026 — withKeepAlive : envoie 1 byte toutes les 20s pendant que Claude
  // analyse le PDF (peut prendre 60-120s avec Sonnet 4.5 vision). Sans ça, Cloudflare
  // coupe à 100s sans byte reçu → HTTP 524.
  await withKeepAlive(req, res, async () => {
    const t0 = Date.now();
    logger.info(`[devis/import] START parsing ${req.file.originalname} (${req.file.size} bytes, type=${typeDevis}, projetId=${projetId||'auto'})`);
    const parsed = await parseDevisPdf(req.file.buffer);
    const tParse = Date.now() - t0;
    logger.info(`[devis/import] ✓ parsed in ${tParse}ms: ${parsed.lignes?.length || 0} lignes, ${parsed.zones?.length || 0} zones, ${parsed.echeances?.length || 0} échéances`);

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
        logPII(`[devis/import] client existant matché: ${match.fields.Nom}`);
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
        logPII(`[devis/import] nouveau client créé: ${c.nom}`);
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

    const tTotal = Date.now() - t0;
    logger.info(`[devis/import] DONE in ${tTotal}ms — devisId=${devisId}, ${parsed.lignes?.length||0} lignes, ${parsed.zones?.length||0} zones`);

    return {
      ok: true,
      devisId,
      duration_ms: tTotal,
      parsed_summary: {
        numero: parsed.metadata?.numero_devis,
        total_ttc: parsed.totaux?.total_ttc,
        lignes: parsed.lignes?.length || 0,
        zones: parsed.zones?.length || 0,
        echeances: parsed.echeances?.length || 0
      }
    };
  });
});

// --- DEVIS : signature → génération commandes fournisseurs + tâches ---
// Mapping catégorie devis → Type fournisseur (Sprint 2 : + Plan de travail)
const CAT_TO_FOURNISSEUR_TYPE = {
  'Meubles': 'Meubles',
  'Panneaux de recouvrement': 'Meubles',
  'Electroménager': 'Électroménager',
  'Eviers et robinetterie': 'Sanitaire',
  'Sanitaires': 'Sanitaire',
  'Produits de vente': 'Accessoires',
  'Plan de travail': 'Plan de travail',
  'Plans de travail': 'Plan de travail',
  // Dépose et Divers : pas de commande fournisseur auto
};

// Sprint 2 — Format BC en tableau structuré (Pos | Code | Description | SENS | Cote | Qté)
// SANS MONTANTS, à la demande JMG. Retour : string ASCII alignée + version HTML pour mail.
function buildBcTableau(lignes) {
  if (!lignes || lignes.length === 0) return { texte: '— Pas de ligne disponible —', html: '<p>Pas de ligne disponible.</p>' };

  const rows = lignes.map(l => {
    const f = l.fields || {};
    return {
      pos:   String(f['Position'] || ''),
      code:  String(f['Code produit'] || f['Code'] || ''),
      desc:  String(f['Désignation'] || f['Description'] || '').replace(/\s+/g, ' ').slice(0, 80),
      sens:  String(f['Sens'] || ''),
      cote:  String(f['Côté visible'] || f['Cote visible'] || ''),
      qte:   String(f['Quantité'] || ''),
      unite: String(f['Unité'] || ''),
    };
  }).filter(r => r.code || r.desc); // ignorer les lignes vides

  // Largeurs auto (alignement texte)
  const widths = {
    pos: Math.max(3, ...rows.map(r => r.pos.length)),
    code: Math.max(4, ...rows.map(r => r.code.length)),
    desc: Math.min(50, Math.max(11, ...rows.map(r => r.desc.length))),
    sens: Math.max(4, ...rows.map(r => r.sens.length)),
    cote: Math.max(4, ...rows.map(r => r.cote.length)),
    qte: Math.max(3, ...rows.map(r => r.qte.length)),
  };
  const pad = (s, n, right = false) => right ? String(s).padStart(n) : String(s).padEnd(n);

  const header = `${pad('Pos', widths.pos)} | ${pad('Code', widths.code)} | ${pad('Description', widths.desc)} | ${pad('SENS', widths.sens)} | ${pad('Cote', widths.cote)} | ${pad('Qté', widths.qte, true)}`;
  const sep    = `${'-'.repeat(widths.pos)}-+-${'-'.repeat(widths.code)}-+-${'-'.repeat(widths.desc)}-+-${'-'.repeat(widths.sens)}-+-${'-'.repeat(widths.cote)}-+-${'-'.repeat(widths.qte)}`;
  const body   = rows.map(r => `${pad(r.pos, widths.pos)} | ${pad(r.code, widths.code)} | ${pad(r.desc, widths.desc)} | ${pad(r.sens, widths.sens)} | ${pad(r.cote, widths.cote)} | ${pad(r.qte + (r.unite ? ' ' + r.unite : ''), widths.qte, true)}`).join('\n');

  const texte = [header, sep, body].join('\n');

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const html = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;font-size:12px">
  <thead><tr style="background:#f4f4f4"><th>Pos</th><th>Code</th><th>Description</th><th>SENS</th><th>Cote visible</th><th>Qté</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td>${esc(r.pos)}</td><td>${esc(r.code)}</td><td>${esc(r.desc)}</td><td>${esc(r.sens)}</td><td>${esc(r.cote)}</td><td style="text-align:right">${esc(r.qte)}${r.unite ? ' ' + esc(r.unite) : ''}</td></tr>`).join('')}</tbody>
</table>`;

  return { texte, html };
}

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

    // 1bis. Récup nom client + date pose + artisans contractuels via projet
    // Convention numéro commande : `<NOMCLIENT> · <TYPE> · <num devis>-<idx>` — scan visuel rapide.
    // Date pose : sert au rétro-planning des commandes (date envoi = date pose - 105 jours / 3,5 mois).
    // Artisans contractuels : pour la tâche "Notifier artisans — devis signé".
    let clientNom = '';
    let datePose = null;
    let artisansContractuelsNoms = [];
    if (projetId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
        if (pr.ok) {
          const pjson = await pr.json();
          const pfields = pjson.fields || {};
          datePose = pfields['Date pose prévue'] || null;
          const clientIds = Array.isArray(pfields.Client) ? pfields.Client : [];
          if (clientIds.length) {
            const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientIds[0]}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
            if (cr.ok) {
              const cjson = await cr.json();
              clientNom = (cjson.fields?.Nom || '').toUpperCase().trim();
            }
          }
          // Récup artisans contractuels du projet (pour la tâche de notif post-signature)
          const artisanIds = Array.isArray(pfields.Artisans) ? pfields.Artisans : [];
          if (artisanIds.length) {
            try {
              const artisans = await atFetchByIds(TABLES.artisans.id, artisanIds);
              artisansContractuelsNoms = artisans
                .filter(a => a.fields?.Contractuel === true)
                .map(a => a.fields?.Nom || '?');
            } catch(e) { /* non bloquant */ }
          }
        }
      } catch(e) { /* fallback silencieux : pas de nom client → format legacy */ }
    }
    // Rétro-planning : date envoi prévue commandes = date pose - 105 jours (3,5 mois).
    // Si la date calculée est dans le passé, on fallback à today (le BC sort tout de suite).
    let dateEnvoiCommande = null;
    if (datePose) {
      const d = new Date(datePose + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 105);
      const todayIso = new Date().toISOString().slice(0, 10);
      const calculated = d.toISOString().slice(0, 10);
      dateEnvoiCommande = calculated < todayIso ? todayIso : calculated;
    }

    // 2. Récup les lignes du devis (par IDs liés depuis le devis, évite le scan complet de la table)
    const ligneIds = dv['Lignes devis'] || [];
    const lignes = await atFetchByIds(TABLES['lignes-devis'].id, ligneIds);

    // 3. Groupement par catégorie mappée + collecte des LIGNES ENTIÈRES par type (Sprint 2 : tableau BC)
    const totauxParCat = {};
    const lignesParType = {};
    for (const l of lignes) {
      const cat = l.fields['Catégorie'];
      const type = CAT_TO_FOURNISSEUR_TYPE[cat];
      if (!type) continue;
      totauxParCat[type] = (totauxParCat[type] || 0) + (parseFloat(l.fields['Montant HT']) || 0);
      (lignesParType[type] = lignesParType[type] || []).push(l);
    }

    // 4. Création des commandes fournisseurs (Sprint v3.1 — BC structurés et modifiables)
    // Pour chaque type, on populer les champs structurés (Contremarque, Contact Tanguy,
    // Référence courte, Lignes BC JSON) en + des Notes texte ASCII pour rétrocompatibilité.
    const TYPE_TO_REFERENCE_COURTE = {
      'Meubles': 'NOVA_CUC',
      'Électroménager': 'ELECTRO',
      'Sanitaire': 'SANIT',
      'Accessoires': 'ACCESS',
      'Plan de travail': 'PLAN_TRAV',
    };
    const commandesCreees = [];
    let idx = 1;
    // Pour meubles : extraire infos modèle depuis la 1re zone du devis (NOVA_CUC = singulier).
    // Fix 2026-06-07 (grand nettoyage) : ce bloc référençait `parsed.zones` (variable du
    // endpoint /api/devis/import, inexistante ici) — le catch best-effort avalait le
    // ReferenceError et "Modèle choisi"/"Détails modèle" n'étaient JAMAIS remplis à la
    // signature. On lit désormais les zones du devis depuis Airtable (triées par Ordre).
    let modeleHeader = '';
    let detailsModele = '';
    try {
      const zoneIds = Array.isArray(dv['Zones devis']) ? dv['Zones devis'] : [];
      const zones = (await atFetchByIds(TABLES['zones-devis'].id, zoneIds))
        .sort((a, b) => (a.fields?.Ordre ?? 999) - (b.fields?.Ordre ?? 999));
      const z0 = zones[0]?.fields;
      if (z0) {
        modeleHeader = [z0['Marque'], z0['Modèle']].filter(Boolean).join(' — ') +
          (z0['Porte épaisseur'] ? `\nPorte épaisseur ${z0['Porte épaisseur']}` : '');
        const lines = [];
        if (z0['Modularité'])              lines.push(`Modularité : ${z0['Modularité']}`);
        if (z0['Exécution façade'])        lines.push(`Exécution façade : ${z0['Exécution façade']}`);
        if (z0['Coloris façade'])          lines.push(`Coloris façade : ${z0['Coloris façade']}`);
        if (z0['Chant façade'])            lines.push(`Chant façade : ${z0['Chant façade']}`);
        if (z0['Coloris caisson'])         lines.push(`Coloris caisson : ${z0['Coloris caisson']}`);
        if (z0['Exécution côté finition']) lines.push(`Exécution côté finition : ${z0['Exécution côté finition']}`);
        if (z0['Coloris côté finition'])   lines.push(`Coloris côté finition : ${z0['Coloris côté finition']}`);
        if (z0['Type de gorge'])           lines.push(`Type de gorge : ${z0['Type de gorge']}`);
        if (z0['Exécution gorges'])        lines.push(`Exécution gorges : ${z0['Exécution gorges']}`);
        if (z0['Finition gorges'])         lines.push(`Finition gorges : ${z0['Finition gorges']}`);
        if (z0['Profondeur'])              lines.push(`Profondeur : ${z0['Profondeur']}`);
        if (z0['Option ouverture'])        lines.push(`Option ouverture : ${z0['Option ouverture']}`);
        if (z0['Finition socle'])          lines.push(`Finition socle : ${z0['Finition socle']}`);
        detailsModele = lines.join('\n');
      }
    } catch (e) { /* best effort — la signature ne doit jamais bloquer sur ces métadonnées */ }

    // Workflow JMG 2026-05-21 : il faut TOUJOURS prévoir un 4ème BC "Plan de travail"
    // même si le devis Winner n'a aucune ligne plan de travail (le PT est mesuré
    // sur chantier après pose meubles, le BC est complété manuellement par Virginie).
    if (!totauxParCat['Plan de travail']) {
      totauxParCat['Plan de travail'] = 0; // sentinel pour forcer la création
    }

    for (const [type, montant] of Object.entries(totauxParCat)) {
      // On accepte montant=0 uniquement pour "Plan de travail" (BC vide à compléter sur chantier)
      if (montant <= 0 && type !== 'Plan de travail') continue;
      const numCmd = clientNom
        ? `${clientNom} · ${type.toUpperCase()} · ${numero}-${idx}`
        : `${numero}-${type.slice(0,3).toUpperCase()}-${idx}`;
      const lignesType = lignesParType[type] || [];
      const { texte: tableauTexte } = buildBcTableau(lignesType);
      const isPlanTravailVide = type === 'Plan de travail' && lignesType.length === 0;
      // Lignes structurées JSON pour édition future (front v3)
      const lignesStructured = lignesType.map(l => {
        const f = l.fields || {};
        return {
          pos: String(f.Position || ''),
          code: String(f['Code produit'] || ''),
          description: String(f['Désignation'] || ''),
          sens: String(f.Sens || ''),
          coteVisible: String(f['Côté visible'] || ''),
          quantite: f.Quantité != null ? Number(f.Quantité) : null,
          unite: String(f.Unité || ''),
          largeurMm: f['Largeur mm'] || null,
          hauteurMm: f['Hauteur mm'] || null,
          profondeurMm: f['Profondeur mm'] || null,
          notes: String(f.Notes || ''),
        };
      });
      const notesPrefill = isPlanTravailVide
        ? `[Auto-généré depuis devis ${numero} signé le ${new Date().toLocaleDateString('fr-FR')}]\n\nBC à compléter APRÈS prise de mesures sur chantier :\n• Matériau / Coloris / Finition / Épaisseur\n• Dimensions exactes (longueur, largeur, profondeur, découpes évier/plaque)\n• Fournisseur final (Inalco, Compac, Silestone, Caesarstone, etc.)\n• Délai de livraison\n\nUne fois mesures prises, mettre à jour ce BC puis l'envoyer au fournisseur.`
        : `[Auto-généré depuis devis ${numero} signé le ${new Date().toLocaleDateString('fr-FR')}]\n\nContenu prévisionnel (à valider/ajuster avant envoi au fournisseur, SANS MONTANTS) :\n\n${tableauTexte}`;
      const cf = {
        'Numéro': numCmd,
        // "À compléter" pas dans le singleSelect Statut (PATCH choices 422), on garde
        // "Créée" + mention explicite dans Notes pour le BC Plan de travail vide.
        'Statut': 'Créée',
        'Date création': new Date().toISOString().slice(0, 10),
        ...(montant > 0 ? { 'Montant HT': Math.round(montant * 100) / 100 } : {}),
        'Notes': notesPrefill,
        'Contremarque': clientNom || '',
        'Contact Tanguy': 'Solène',
        'Référence courte': TYPE_TO_REFERENCE_COURTE[type] || type.toUpperCase(),
        // Modèle choisi + détails uniquement pour les commandes Meubles (utile sur le BC)
        ...(type === 'Meubles' ? { 'Modèle choisi': modeleHeader, 'Détails modèle': detailsModele } : {}),
        // Rétro-planning : date envoi = date pose - 3,5 mois (cf. demande JMG 2026-05-21).
        // Si pas de date pose connue, le champ reste vide et Virginie le remplira manuellement.
        ...(dateEnvoiCommande ? { 'Date envoi': dateEnvoiCommande } : {}),
        'Lignes BC': JSON.stringify(lignesStructured, null, 2),
      };
      if (projetId) cf['Projet'] = [projetId];
      // Nettoyage : retirer les champs vides
      Object.keys(cf).forEach(k => { if (cf[k] === '' || cf[k] == null) delete cf[k]; });
      const c = await atCreate(TABLES.commandes.id, cf);
      commandesCreees.push({ id: c.id, type, montant, numero: numCmd });
      idx++;
    }

    // 5. Création des tâches de suivi (Sprint v3.2 — workflow signature complet)
    const today = new Date().toISOString().slice(0,10);
    const plus7 = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const plus60 = new Date(Date.now()+60*86400000).toISOString().slice(0,10);
    const dateEnvoiTxt = dateEnvoiCommande ? ` (date envoi prévue : ${dateEnvoiCommande})` : '';
    const artisansNoms = artisansContractuelsNoms.length
      ? artisansContractuelsNoms.join(', ')
      : 'aucun artisan contractuel rattaché — vérifier la fiche projet';
    const tachesFields = [
      { 'Titre': `Envoyer facture acompte — ${numero}`, 'Assignée à': 'Virginie', 'Priorité': 'Haute', 'Statut': 'À faire', 'Échéance': today, 'Description': `BC signé ${numero}. Générer et envoyer facture acompte (30%) au client.` },
      { 'Titre': `Envoyer commandes fournisseurs — ${numero}`, 'Assignée à': 'Virginie', 'Priorité': 'Haute', 'Statut': 'À faire', 'Échéance': plus7, 'Description': `${commandesCreees.length} commande(s) à envoyer${dateEnvoiTxt} : ${commandesCreees.map(c=>c.type).join(', ')}.` },
      // Workflow JMG 2026-05-21 : à signature, notifier les artisans contractuels que leur devis est OK
      // et qu'ils peuvent émettre leurs factures, en annonçant le rappel planning à 2 mois.
      { 'Titre': `Notifier artisans contractuels — devis ${numero} signé`, 'Assignée à': 'Virginie', 'Priorité': 'Haute', 'Statut': 'À faire', 'Échéance': today, 'Description': `Devis client ${numero} signé. Prévenir ${artisansNoms} : devis artisan OK → peuvent envoyer leurs factures. Annoncer que nous reviendrons dans 2 mois pour la planification chantier exacte.` },
      // Rappel planification chantier auto à J+60 — workflow découverte → signature → ... → planning à 2 mois.
      { 'Titre': `Planifier chantier — devis ${numero}`, 'Assignée à': 'Sébastien', 'Priorité': 'Moyenne', 'Statut': 'À faire', 'Échéance': plus60, 'Description': `Définir le planning exact du chantier (équipe + dates intervention) pour le BC ${numero}. Recontacter les artisans contractuels pour caler leurs créneaux.` },
    ];
    if (projetId) tachesFields.forEach(t => t['Projet'] = [projetId]);
    await atCreateBatch(TABLES.taches.id, tachesFields);

    // 6. MAJ du statut devis + projet
    // À la signature : Statut → Commandes ET Phase commerciale → Signé (P2 — la signature
    // du devis force la phase commerciale, le pipeline ne doit pas rester sur Découverte/Dessin).
    await atPatch(TABLES.devis.id, devisId, { 'Statut': 'Signé' });
    if (projetId) {
      try { await atPatch(TABLES.projets.id, projetId, { 'Statut': 'Commandes', 'Phase commerciale': 'Signé' }); } catch(e){}
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

  // withKeepAlive — Claude parse Plaud peut prendre 30-60s → idem fix devis/import
  await withKeepAlive(req, res, async () => {
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

    // Sprint 2 — créer auto les tâches depuis prochaines_actions[]
    const tachesCreees = [];
    if (Array.isArray(parsed.prochaines_actions) && projetId) {
      // Récupère nom client pour préfixer le titre (cf. demande JMG)
      let clientNom = '';
      if (clientId) {
        try {
          const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientId}`, {
            headers: { Authorization: `Bearer ${AT_KEY}` }
          });
          if (cr.ok) clientNom = (await cr.json()).fields?.Nom || '';
        } catch (e) { /* fallback silencieux */ }
      }
      for (const action of parsed.prochaines_actions) {
        if (!action.titre) continue;
        const titre = clientNom && !action.titre.includes('[')
          ? `[${clientNom}] / ${action.titre}`
          : action.titre;
        try {
          const t = await atCreate(TABLES.taches.id, {
            'Titre': titre,
            'Statut': 'À faire',
            'Priorité': 'Moyenne',
            'Assignée à': action.assignee_suggere || 'Virginie',
            'Échéance': action.date_souhaitee || null,
            'Description': action.notes || `Tâche générée auto depuis Plaud R1 (type: ${action.type || 'autre'})`,
            'Projet': [projetId],
          });
          tachesCreees.push({ id: t.id, titre });
        } catch (e) {
          logger.warn({ err: e.message, action }, 'plaud: création tâche auto échouée');
        }
      }
      if (tachesCreees.length) {
        logger.info({ projetId, count: tachesCreees.length }, 'plaud: tâches auto créées depuis prochaines_actions');
      }
    }

    // P-E (2026-06-24) — relance client auto J+7 après la découverte (réunion R1).
    // Idempotent : on ne recrée pas si une relance « suite découverte » existe déjà sur le projet.
    let relanceTache = null;
    if (niveauResolu === 'R1' && projetId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
        const projet = pr.ok ? await pr.json() : null;
        const tacheIds = projet?.fields?.['Tâches'] || [];
        const cliId = (projet?.fields?.Client || [])[0] || clientId;
        let cliNom = '';
        if (cliId) {
          try {
            const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${cliId}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
            if (cr.ok) cliNom = (await cr.json()).fields?.Nom || '';
          } catch (e) { /* fallback silencieux */ }
        }
        let dejaRelance = false;
        if (tacheIds.length) {
          const existing = await atFetchByIds(TABLES.taches.id, tacheIds);
          dejaRelance = existing.some(t => /relance-decouverte|relance.*d[ée]couverte/i.test((t.fields?.Titre || '') + ' ' + (t.fields?.Description || '')));
        }
        if (!dejaRelance) {
          const titre = cliNom ? `[${cliNom}] / Relancer le client (suite découverte)` : 'Relancer le client (suite découverte)';
          const t = await atCreate(TABLES.taches.id, {
            'Titre': titre,
            'Statut': 'À faire',
            'Priorité': 'Moyenne',
            'Assignée à': 'Virginie',
            'Échéance': addDays(todayISO(), 7),
            'Description': `[relance-decouverte] Relance commerciale automatique 7 jours après la découverte. Reprendre contact avec le client pour faire avancer le projet.`,
            'Projet': [projetId],
          });
          relanceTache = { id: t.id, titre };
          logger.info({ projetId, tacheId: t.id }, '[plaud] relance découverte J+7 créée (P-E)');
        }
      } catch (e) {
        logger.warn({ err: e.message, projetId }, '[plaud] création relance découverte échouée (P-E)');
      }
    }

    return { ok: true, record: rec, parsed, niveau: niveauResolu, tachesCreees, relanceTache };
  });
});

// --- DEVIS ARTISAN : import PDF + parsing + création record ---
app.post('/api/artisan-devis/import', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  if (!validatePdfMagicBytes(req.file.buffer)) return res.status(400).json({ error: 'Fichier non reconnu comme PDF (signature %PDF manquante)' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });

  const projetId = req.body.projetId || null;
  const artisanId = req.body.artisanId || null; // optionnel — sinon on match par nom d'entreprise

  // withKeepAlive — parser un PDF artisan via Claude peut prendre 60-120s
  await withKeepAlive(req, res, async () => {
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
        logPII(`[artisan-devis/import] artisan matché: ${match.fields.Nom}`);
      } else {
        // #4 — Pas de match → CRÉER l'artisan. Sinon le devis n'est lié à personne,
        // projet.Artisans reste vide et le compteur/calcul reste à 0 (bug signalé).
        const artisanFields = { Nom: String(parsed.artisan.entreprise).trim() };
        if (parsed.artisan?.email) artisanFields.Email = parsed.artisan.email;
        if (parsed.artisan?.telephone) artisanFields['Téléphone'] = parsed.artisan.telephone;
        const createdArtisan = await atCreate(TABLES.artisans.id, artisanFields);
        resolvedArtisanId = createdArtisan.id;
        logPII(`[artisan-devis/import] artisan CRÉÉ (non matché): ${artisanFields.Nom}`);
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

    return {
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
    };
  });
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

// (Grand nettoyage 2026-06-07 : POST /api/fiche-mission supprimé — appelé uniquement
// par le cockpit v2 archivé. La génération passe par /api/artisan-devis/:id/fiche-mission.)

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

// --- COMMANDES : détail enrichi + rendu HTML imprimable (Sprint v3.1 BC types) ---
app.get('/api/commandes/:id', requireAuth, async (req, res) => {
  const cmdId = req.params.id;
  try {
    const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.commandes.id}/${cmdId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` }
    });
    if (!cr.ok) {
      if (cr.status === 404) return res.status(404).json({ error: 'Commande introuvable' });
      throw new Error(`commande lookup: ${cr.status}`);
    }
    const commande = await cr.json();

    const projetId = (commande.fields?.Projet || [])[0];
    const fournisseurId = (commande.fields?.Fournisseur || [])[0];

    let projet = null, client = null, fournisseur = null;
    if (projetId) {
      try {
        const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`, {
          headers: { Authorization: `Bearer ${AT_KEY}` }
        });
        if (pr.ok) {
          projet = await pr.json();
          const clientId = (projet.fields?.Client || [])[0];
          if (clientId) {
            const cr2 = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.clients.id}/${clientId}`, {
              headers: { Authorization: `Bearer ${AT_KEY}` }
            });
            if (cr2.ok) client = await cr2.json();
          }
        }
      } catch (e) { /* best effort */ }
    }
    if (fournisseurId) {
      try {
        const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.fournisseurs.id}/${fournisseurId}`, {
          headers: { Authorization: `Bearer ${AT_KEY}` }
        });
        if (fr.ok) fournisseur = await fr.json();
      } catch (e) { /* best effort */ }
    }

    // Décoder Lignes BC JSON
    let lignes = [];
    try {
      const raw = commande.fields?.['Lignes BC'];
      if (raw) lignes = JSON.parse(raw);
    } catch (e) {
      logger.warn({ err: e.message, cmdId }, 'commandes: Lignes BC JSON invalide');
    }

    res.json({ ok: true, commande, projet, client, fournisseur, lignes });
  } catch (e) {
    logger.error({ err: e.message, cmdId }, '[commandes/:id] error');
    res.status(500).json({ error: e.message });
  }
});

// PATCH lignes BC structurées (édition v3)
app.patch('/api/commandes/:id/lignes', requireAuth, async (req, res) => {
  const cmdId = req.params.id;
  const { lignes } = req.body || {};
  if (!Array.isArray(lignes)) return res.status(400).json({ error: 'lignes array requis' });
  try {
    await atPatch(TABLES.commandes.id, cmdId, { 'Lignes BC': JSON.stringify(lignes, null, 2) });
    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e.message, cmdId }, '[commandes/lignes] error');
    res.status(500).json({ error: e.message });
  }
});

// Rendu HTML d'un BC (format calé sur PDF Tanguy)
app.get('/api/commandes/:id/render', requireAuth, async (req, res) => {
  const cmdId = req.params.id;
  try {
    // Réutilise la logique GET /api/commandes/:id
    const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.commandes.id}/${cmdId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` }
    });
    if (!cr.ok) return res.status(404).json({ error: 'Commande introuvable' });
    const commande = await cr.json();
    const cf = commande.fields || {};

    const fournisseurId = (cf.Fournisseur || [])[0];
    let fournisseur = null;
    if (fournisseurId) {
      try {
        const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.fournisseurs.id}/${fournisseurId}`, {
          headers: { Authorization: `Bearer ${AT_KEY}` }
        });
        if (fr.ok) fournisseur = (await fr.json()).fields;
      } catch (e) { /* */ }
    }

    let lignes = [];
    try { if (cf['Lignes BC']) lignes = JSON.parse(cf['Lignes BC']); } catch (e) { /* */ }

    const html = renderBcHtml({ commande: cf, fournisseur, lignes });
    res.json({ ok: true, html });
  } catch (e) {
    logger.error({ err: e.message, cmdId }, '[commandes/render] error');
    res.status(500).json({ error: e.message });
  }
});

// Sprint v3.9 — Génère + sert le PDF d'un BC (téléchargement direct).
// JMG 2026-05-21 : "Quand je clique sur Envoyer Mail, le mail généré ne va pas.
// Il faudrait mieux un PDF ou en tout cas un doc propre".
app.get('/api/commandes/:id/pdf', requireAuth, async (req, res) => {
  const cmdId = req.params.id;
  try {
    const cr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.commandes.id}/${cmdId}`, {
      headers: { Authorization: `Bearer ${AT_KEY}` },
    });
    if (!cr.ok) return res.status(404).json({ error: 'Commande introuvable' });
    const commande = await cr.json();
    const cf = commande.fields || {};

    const fournisseurId = (cf.Fournisseur || [])[0];
    let fournisseur = null;
    if (fournisseurId) {
      try {
        const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.fournisseurs.id}/${fournisseurId}`, {
          headers: { Authorization: `Bearer ${AT_KEY}` },
        });
        if (fr.ok) fournisseur = await fr.json();
      } catch (e) { /* non bloquant */ }
    }

    let lignes = [];
    try { if (cf['Lignes BC']) lignes = JSON.parse(cf['Lignes BC']); } catch (e) { /* */ }

    const pdfBuffer = await generateBcPdf({ commande: cf, fournisseur, lignes });
    const safeNumero = (cf['Numéro'] || cmdId).replace(/[^a-zA-Z0-9-_.]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="BC_${safeNumero}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(pdfBuffer);
  } catch (e) {
    logger.error({ err: e.message, cmdId }, '[commandes/pdf] error');
    res.status(500).json({ error: e.message });
  }
});

// Helper rendu HTML BC (format Tanguy)
function renderBcHtml({ commande, fournisseur, lignes }) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const dateCreaFr = commande['Date création']
    ? new Date(commande['Date création']).toLocaleDateString('fr-FR')
    : '—';
  const refCourte = commande['Référence courte'] || (fournisseur?.Nom || '').toUpperCase().slice(0, 12);
  const contremarque = commande['Contremarque'] || '';
  const numero = commande['Numéro'] || '';
  const numDevis = numero.match(/\d+\/\d+\/\d+/)?.[0] || '';

  // Format Winner : ligne 1 = Code en gras, ligne 2 = Description, ligne 3 = dimensions L/H/P,
  // ligne 4 = notes (italique rouge si présentes).
  const lignesHtml = (Array.isArray(lignes) && lignes.length > 0)
    ? lignes.map(l => {
        const descHtml = l.description ? esc(l.description).replace(/\n/g, '<br>') : '';
        // Dimensions sur leur propre ligne si disponibles
        const dims = [];
        if (l.largeurMm)    dims.push(`L: ${l.largeurMm}`);
        if (l.hauteurMm)    dims.push(`H: ${l.hauteurMm}`);
        if (l.profondeurMm) dims.push(`P: ${l.profondeurMm}`);
        const dimsHtml = dims.length ? '<br>' + esc(dims.join(', ')) : '';
        const notesHtml = l.notes ? '<br><em style="color:#c44">' + esc(l.notes).replace(/\n/g, '<br>') + '</em>' : '';
        const qteTxt = l.quantite != null
          ? l.quantite.toLocaleString('fr-FR', { minimumFractionDigits: 4 }) + (l.unite ? ' ' + l.unite : '')
          : '';
        return `
      <tr>
        <td>${esc(l.pos)}</td>
        <td><strong>${esc(l.code || '')}</strong>${descHtml ? '<br>' + descHtml : ''}${dimsHtml}${notesHtml}</td>
        <td style="text-align:center">${esc(l.sens || '')}</td>
        <td style="text-align:center">${esc(l.coteVisible || '')}</td>
        <td style="text-align:right">${esc(qteTxt)}</td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#999">Aucune ligne définie. Édite la commande pour ajouter les détails.</td></tr>';

  return `
<style>
  .bc-doc { font-family: Helvetica, Arial, sans-serif; color: #222; max-width: 760px; margin: 0 auto; padding: 24px; font-size: 13px; }
  .bc-doc h1 { font-size: 32px; font-weight: 700; margin: 16px 0 8px; }
  .bc-doc .bc-head { font-size: 12px; margin-bottom: 24px; }
  .bc-doc .bc-head strong { font-size: 14px; }
  .bc-doc .bc-top { display: flex; justify-content: space-between; align-items: flex-start; margin: 24px 0; }
  .bc-doc .bc-box { border: 1px solid #000; padding: 32px 48px; }
  .bc-doc .bc-cmd-title { font-size: 36px; font-weight: 700; }
  .bc-doc .bc-fournisseur-ref { font-style: italic; font-weight: 600; font-size: 18px; margin-bottom: 8px; }
  .bc-doc .bc-contact { font-size: 12px; line-height: 1.6; }
  .bc-doc .bc-contact span.label { display: inline-block; min-width: 90px; }
  .bc-doc .bc-meta { margin: 24px 0; font-size: 13px; }
  .bc-doc .bc-meta dt { display: inline-block; min-width: 180px; font-weight: 700; font-style: italic; }
  .bc-doc .bc-meta dd { display: inline; margin: 0; }
  .bc-doc .bc-meta .row { margin: 4px 0; }
  .bc-doc .bc-modele { border: 1px solid #aaa; padding: 8px 12px; margin: 16px 0; font-style: italic; }
  .bc-doc .bc-detail { font-size: 12px; margin: 16px 0; padding: 0 24px; }
  .bc-doc .bc-detail h3 { font-style: italic; font-weight: 700; font-size: 13px; margin-bottom: 6px; }
  .bc-doc .bc-detail dl { display: grid; grid-template-columns: 220px 1fr; gap: 2px 12px; font-style: italic; }
  .bc-doc table.bc-lignes { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 12px; }
  .bc-doc table.bc-lignes th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #888; text-align: left; }
  .bc-doc table.bc-lignes td { padding: 6px 8px; border: 1px solid #888; vertical-align: top; }
  .bc-doc .bc-livraison { margin-top: 32px; font-size: 12px; }
  .bc-doc .bc-livraison .row { margin: 4px 0; }
  .bc-doc .bc-livraison strong { display: inline-block; min-width: 150px; }
  .bc-doc .bc-footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #888; text-align: center; font-style: italic; font-size: 11px; color: #555; }
</style>
<div class="bc-doc">
  <div class="bc-head">
    <strong>TANGUY DESIGN</strong><br>
    <em>4 Rue Louis Blériot . ZA Toul Garros</em><br>
    <em>56400 AURAY</em><br>
    <em>Tél. :0297562853</em><br>
    Email : admin@tanguydesign.com<br>
    Site : www.tanguydesign.com
  </div>

  <div class="bc-top">
    <div class="bc-box"><div class="bc-cmd-title">Commande</div></div>
    <div>
      <div class="bc-fournisseur-ref">${esc(refCourte)}</div>
      <div class="bc-contact">
        <div><strong>Téléphone</strong> : ${esc(fournisseur?.Téléphone || '')}</div>
        <div><strong>Fax</strong> : ${esc(fournisseur?.Fax || '')}</div>
        <div><strong>E-Mail</strong> : ${esc(fournisseur?.Email || '')}</div>
      </div>
    </div>
  </div>

  <div class="bc-meta">
    <div class="row"><span class="label" style="display:inline-block;min-width:90px">Contact</span> : ${esc(commande['Contact Tanguy'] || 'Solène LORHO')}</div>
    <div class="row"><span class="label" style="display:inline-block;min-width:90px">N° client</span> : </div>
  </div>

  <div class="bc-meta">
    <div class="row"><dt>Numéro de commande</dt> : ${esc(numero)}</div>
    <div class="row"><dt>Date de commande</dt> : ${esc(dateCreaFr)}</div>
    <div class="row"><dt>Livraison souhaitée</dt> : ${esc(commande['Livraison semaine'] || '')}</div>
    <div class="row"><dt>Contremarque</dt> : <strong>${esc(contremarque)}</strong></div>
  </div>

  ${commande['Modèle choisi'] ? `
  <div style="font-style:italic;margin:16px 0 4px"><strong>Choix du modèle :</strong></div>
  <div class="bc-modele">${esc(commande['Modèle choisi']).replace(/\n/g, '<br>')}</div>
  ` : ''}

  ${commande['Détails modèle'] ? `
  <div class="bc-detail">
    <h3>Détail :</h3>
    ${commande['Détails modèle'].split('\n').map(l => {
      const [k, ...rest] = l.split(' : ');
      const v = rest.join(' : ');
      return v ? `<div><em>${esc(k)}</em> : <strong>${esc(v)}</strong></div>` : `<div>${esc(l)}</div>`;
    }).join('')}
  </div>
  ` : ''}

  <table class="bc-lignes">
    <thead>
      <tr>
        <th style="width:50px">Pos</th>
        <th>Désignation</th>
        <th style="width:50px;text-align:center">Sens</th>
        <th style="width:60px;text-align:center">Coté visible</th>
        <th style="width:100px;text-align:right">Quantité</th>
      </tr>
    </thead>
    <tbody>
      ${lignesHtml}
    </tbody>
  </table>

  <div class="bc-livraison">
    <div class="row"><strong>Adresse de Livraison</strong> : TANGUY DESIGN</div>
    <div class="row" style="padding-left:152px">4 Rue Louis Blériot</div>
    <div class="row" style="padding-left:152px">ZA Toul Garros</div>
    <div class="row" style="padding-left:152px">56400 AURAY</div>
    <div class="row"><strong>Téléphone</strong> : 0297562853</div>
    <div class="row"><strong>Téléphone Mobile</strong> : 0608034200</div>
    <div class="row"><strong>Fax</strong> : </div>
  </div>

  <div class="bc-footer">
    Numéro de TVA<br>
    FR83334475068<br>
    Siret : 33447506800022<br>
    Email : admin@tanguydesign.com<br>
    Site : www.tanguydesign.com<br>
    <span style="font-size:10px;color:#888;display:block;margin-top:12px">Réf. : ${esc(numDevis)} &nbsp;&nbsp; Imprimé : ${esc(new Date().toLocaleDateString('fr-FR'))}</span>
  </div>
</div>
`.trim();
}

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

// Sprint v3.8 — Suppression d'une entrée journal par contenu exact.
// JMG 2026-05-21 : "On doit pouvoir supprimer une entrée dans le journal chantier".
// Le journal est stocké en texte multiligne, on identifie l'entrée à supprimer
// par son contenu exact (l'UI envoie la ligne complète).
app.delete('/api/projets/:id/journal', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  const entryToDelete = (req.body?.entry || '').trim();
  if (!entryToDelete) return res.status(400).json({ error: 'entry requis' });
  try {
    const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.projets.id}/${projetId}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!pr.ok) throw new Error('projet introuvable');
    const current = ((await pr.json()).fields?.['Journal chantier']) || '';
    const lines = current.split('\n');
    const idx = lines.findIndex(l => l.trim() === entryToDelete);
    if (idx === -1) return res.status(404).json({ error: 'Entrée introuvable dans le journal' });
    lines.splice(idx, 1);
    const next = lines.join('\n');
    await atPatch(TABLES.projets.id, projetId, { 'Journal chantier': next });
    logger.info({ projetId, entry: entryToDelete.slice(0, 60) }, 'journal entry deleted');
    res.json({ ok: true, removed: entryToDelete });
  } catch (e) {
    logger.error('[projets/journal] DELETE error:', e);
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

// --- Helper pour log ---
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// --- SAV : callback de résolution depuis cockpit 9·58 → notif client (v3.22) ---
// Quand JMG clique "Résolu" sur un ticket côté cockpit central, n8n appelle
// CE endpoint pour notifier l'utilisateur Tanguy qui avait ouvert le ticket.
// Stockage en RAM (Map auteur → liste de notifs), cleanup auto > 30 j.
//
// Côté n8n : configurer un HTTP node sur la transition "Résolu" qui POST
// https://tanguydesign.958.fr/api/sav/callback avec header X-958-Secret:
// {SAV_WEBHOOK_SECRET} et body { ticket_id, statut, message_resolution,
// auteur_email, titre }.
const savNotifications = new Map(); // login → [{id, date, ticket_id, titre, message, lu}]
const SAV_NOTIF_MAX_AGE_MS = 30 * 86400 * 1000;
function cleanupOldNotifs() {
  const now = Date.now();
  for (const [login, list] of savNotifications.entries()) {
    const fresh = list.filter(n => now - new Date(n.date).getTime() < SAV_NOTIF_MAX_AGE_MS);
    if (fresh.length === 0) savNotifications.delete(login);
    else savNotifications.set(login, fresh);
  }
}

app.post('/api/sav/callback', async (req, res) => {
  // Auth via secret (header X-958-Secret) — pas requireAuth car c'est n8n qui appelle
  const incomingSecret = req.headers['x-958-secret'] || '';
  if (!SAV_WEBHOOK_SECRET || incomingSecret !== SAV_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { ticket_id, statut, message_resolution, auteur_email, auteur_login, titre } = req.body || {};
  if (!ticket_id || !(auteur_email || auteur_login)) {
    return res.status(400).json({ error: 'ticket_id et auteur_login (ou auteur_email) requis' });
  }
  // Sprint v3.24 — Prioriser auteur_login (envoyé explicitement par le cockpit),
  // fallback sur auteur_email.split('@')[0] pour rétrocompat avec anciens cockpits.
  const login = String(auteur_login || (auteur_email || '').split('@')[0] || '').toLowerCase();
  if (!login) return res.status(400).json({ error: 'login utilisateur introuvable' });
  const notif = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    ticket_id,
    statut: statut || 'Résolu',
    titre: String(titre || `Ticket ${ticket_id}`).slice(0, 200),
    message: String(message_resolution || 'Ticket résolu par l\'équipe 9·58.').slice(0, 2000),
    lu: false,
  };
  cleanupOldNotifs();
  const list = savNotifications.get(login) || [];
  list.unshift(notif); // plus récent en tête
  savNotifications.set(login, list);
  logger.info({ login, ticket_id, statut }, '[sav/callback] notif stockée');
  res.json({ ok: true, notif_id: notif.id });
});

// GET /api/sav/my-notifications — récupère les notifs de l'user connecté
app.get('/api/sav/my-notifications', requireAuth, (req, res) => {
  cleanupOldNotifs();
  const login = (req.session?.user || '').toLowerCase();
  const list = savNotifications.get(login) || [];
  const unread = list.filter(n => !n.lu).length;
  res.json({ ok: true, notifications: list, unread });
});

// POST /api/sav/notifications/:id/read — marquer comme lue
app.post('/api/sav/notifications/:id/read', requireAuth, (req, res) => {
  const login = (req.session?.user || '').toLowerCase();
  const list = savNotifications.get(login) || [];
  const n = list.find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'introuvable' });
  n.lu = true;
  res.json({ ok: true });
});

// POST /api/sav/notifications/mark-all-read — marquer toutes comme lues (auto à
// l'ouverture du modal support : si tu vois les notifs, compteur retombe à 0).
// Sprint 26/05 — UX naturelle (avant : fallait cliquer "OK, vu" sur chaque notif).
app.post('/api/sav/notifications/mark-all-read', requireAuth, (req, res) => {
  const login = (req.session?.user || '').toLowerCase();
  const list = savNotifications.get(login) || [];
  let marked = 0;
  for (const n of list) {
    if (!n.lu) { n.lu = true; marked++; }
  }
  res.json({ ok: true, marked });
});

// --- SAV : proxy vers webhook n8n du cockpit central 9·58 ----------------
// Le cockpit central ouvre les tickets dans Airtable TICKETS_TBL et alimente
// la zone Pilotage. Auth via header X-958-Secret. Configurable par env vars.
// RC Pro 2026 : retirer le default hardcodé pour éviter d'exposer l'URL n8n
// dans le repo public. Si SAV_WEBHOOK_URL absent : le proxy SAV refuse l'envoi.
const SAV_WEBHOOK_URL    = process.env.SAV_WEBHOOK_URL    || '';
const SAV_WEBHOOK_SECRET = process.env.SAV_WEBHOOK_SECRET || '';
const SAV_CLIENT_SLUG    = process.env.SAV_CLIENT_SLUG    || 'tanguy';
const SAV_COCKPIT_SOURCE = process.env.SAV_COCKPIT_SOURCE || 'Cockpit Tanguy Design';
const SAV_ABONNEMENT     = process.env.SAV_ABONNEMENT     || 'Build';
// Sprint v3.23 — Standard inter-cockpits : chaque cockpit déclare son URL de
// callback dans le payload initial. n8n la stocke dans le ticket et l'appelle
// à la résolution. Convention : <cockpit-domain>/api/sav/callback.
// PUBLIC_BASE_URL peut être set en env (sinon construit depuis le domain Scaleway).
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://tanguydesign.958.fr';
const SAV_CALLBACK_URL = `${PUBLIC_BASE_URL}/api/sav/callback`;

// (Grand nettoyage 2026-06-07 : POST /api/sav/submit supprimé — appelé uniquement par
// le cockpit v2 archivé. Le v3 passe par POST /api/support/feedback, qui forwarde au
// webhook 9·58 avec le même callback_url. /api/sav/callback et les notifications restent.)

// ════════════════════════════════════════════════════════════════════════════
// Sprint v5 — Automatisation Virginie (2026-06)
// Facturation clients + relances impayés · Factures fournisseurs + règlements ·
// Trésorerie hebdo + export expert-comptable · RH (salariés, absences, heures,
// paie) · Retards livraison + relances fournisseurs · Dossier chantier.
// Données financières et RH : admin only (RGPD + confidentialité paie).
// ════════════════════════════════════════════════════════════════════════════

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Normalise un record Airtable "Factures clients" pour les routes v5.
function normFactureClient(r) {
  const f = r.fields || {};
  const ttc = Number(f['Montant TTC']) || 0;
  const regle = Number(f['Montant réglé']) || 0;
  return {
    id: r.id,
    numero: f['Numéro'] || '',
    statut: f['Statut'] || 'Brouillon',
    type: f['Type'] || '',
    dateEmission: f['Date émission'] || null,
    dateEcheance: f['Date échéance'] || null,
    montantHT: Number(f['Montant HT']) || 0,
    montantTTC: ttc,
    montantRegle: regle,
    montantRestant: Math.max(0, Math.round((ttc - regle) * 100) / 100),
    niveauRelance: Number(f['Niveau relance']) || 0,
    dateDerniereRelance: f['Date dernière relance'] || null,
    clientIds: f['Client'] || [],
    projetIds: f['Projet'] || [],
    echeanceIds: f['Échéance liée'] || [],
  };
}

// Type de facture dérivé du libellé d'échéance Winner (même sémantique que
// services/echeances-helper.js deriveDateEcheance).
function typeFactureDepuisLibelle(libelle) {
  const l = String(libelle || '').toLowerCase();
  if (/commande|acompte|signature/.test(l)) return 'Acompte';
  if (/solde|fin|pose|r[ée]cep/.test(l)) return 'Solde';
  return 'Intermédiaire';
}

// --- Facturation clients -----------------------------------------------------

// POST /api/factures-clients/from-echeance — crée la facture depuis une échéance devis.
// Numérotation FC-YYYY-NNN séquentielle. Refuse si l'échéance est déjà facturée.
app.post('/api/factures-clients/from-echeance', requireAdmin, async (req, res) => {
  const { echeanceId } = req.body || {};
  if (!echeanceId) return res.status(400).json({ error: 'echeanceId requis' });
  try {
    const [echRecords, factures] = await Promise.all([
      atFetchByIds(TABLES['echeances-devis'].id, [echeanceId]),
      atFetchAll(TABLES['factures-clients'].id),
    ]);
    const ech = echRecords[0];
    if (!ech) return res.status(404).json({ error: 'échéance introuvable' });
    const dejaFacturee = factures.some(f => (f.fields['Échéance liée'] || []).includes(echeanceId));
    if (dejaFacturee) return res.status(409).json({ error: 'Cette échéance a déjà une facture liée' });

    // Remonte devis → projet + client pour lier la facture.
    const devisId = (ech.fields['Devis'] || [])[0];
    let projetIds = [], clientIds = [];
    if (devisId) {
      const devis = (await atFetchByIds(TABLES.devis.id, [devisId]))[0];
      projetIds = devis?.fields['Projet'] || [];
      clientIds = devis?.fields['Client'] || [];
    }

    const year = todayISO().slice(0, 4);
    const seq = factures.filter(f => String(f.fields['Numéro'] || '').startsWith(`FC-${year}-`)).length + 1;
    const numero = `FC-${year}-${String(seq).padStart(3, '0')}`;
    const montant = Number(ech.fields['Montant prévu']) || 0;

    const created = await atCreate(TABLES['factures-clients'].id, {
      'Numéro': numero,
      'Projet': projetIds,
      'Client': clientIds,
      'Échéance liée': [echeanceId],
      'Type': typeFactureDepuisLibelle(ech.fields['Libellé']),
      'Date émission': todayISO(),
      'Date échéance': ech.fields['Date prévue'] || addDays(todayISO(), 30),
      'Montant TTC': montant,
      'Montant réglé': 0,
      'Statut': 'Brouillon',
      'Niveau relance': 0,
      'Notes': `Créée depuis l'échéance "${ech.fields['Libellé'] || '?'}" (montant repris TTC). Compléter HT/TVA si besoin.`,
    });
    logger.info({ numero, echeanceId, montant }, '[factures-clients] créée depuis échéance');
    res.json({ ok: true, facture: { id: created.id, ...created.fields } });
  } catch (e) {
    logger.error('[factures-clients/from-echeance] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/factures-clients/impayes — factures en retard (avec niveau de relance
// suggéré + email mailto prêt) et échéances en retard pas encore facturées.
app.get('/api/factures-clients/impayes', requireAdmin, async (req, res) => {
  try {
    const today = todayISO();
    const [facturesRaw, echeancesRaw] = await Promise.all([
      atFetchAll(TABLES['factures-clients'].id),
      atFetchAll(TABLES['echeances-devis'].id),
    ]);
    const factures = facturesRaw.map(normFactureClient);

    const impayes = factures
      .filter(f => !['Payée', 'Annulée', 'Brouillon'].includes(f.statut))
      .filter(f => f.montantRestant > 0 && f.dateEcheance && f.dateEcheance < today)
      .map(f => ({ ...f, joursRetard: joursRetard(f.dateEcheance, today) }))
      .map(f => ({ ...f, niveauSuggere: niveauRelanceSuggere(f) }))
      .sort((a, b) => b.joursRetard - a.joursRetard);

    // Résolution noms + emails clients (pour le mailto)
    const clientIds = [...new Set(impayes.flatMap(f => f.clientIds))];
    const clients = clientIds.length ? await atFetchByIds(TABLES.clients.id, clientIds) : [];
    const clientById = new Map(clients.map(c => [c.id, c]));
    for (const f of impayes) {
      const c = clientById.get(f.clientIds[0]);
      f.clientNom = c?.fields['Nom'] || '?';
      f.clientEmail = c?.fields['Email'] || '';
      const niveau = f.niveauSuggere || Math.min((f.niveauRelance || 0) + 1, 3);
      const email = buildEmailRelance({
        numero: f.numero, clientNom: f.clientNom, montantRestant: f.montantRestant,
        dateEcheance: f.dateEcheance, niveau,
      });
      f.relance = { niveau, sujet: email.sujet, mailto: buildMailto(f.clientEmail, email.sujet, email.corps) };
    }

    // Échéances en retard jamais facturées → Virginie doit créer la facture.
    const facturees = echeancesFacturees(factures);
    const echeancesAFacturer = echeancesRaw
      .filter(e => (e.fields['Statut'] || '') !== 'Encaissé')
      .filter(e => !facturees.has(e.id))
      .filter(e => e.fields['Date prévue'] && e.fields['Date prévue'] < today)
      .filter(e => (Number(e.fields['Montant prévu']) || 0) - (Number(e.fields['Montant réglé']) || 0) > 0)
      .map(e => ({
        id: e.id,
        libelle: e.fields['Libellé'] || '?',
        datePrevue: e.fields['Date prévue'],
        montant: Number(e.fields['Montant prévu']) || 0,
        joursRetard: joursRetard(e.fields['Date prévue'], today),
        devisId: (e.fields['Devis'] || [])[0] || null,
      }))
      .sort((a, b) => b.joursRetard - a.joursRetard);

    res.json({ ok: true, impayes, echeancesAFacturer });
  } catch (e) {
    logger.error('[factures-clients/impayes] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/factures-clients/:id/relance — enregistre la relance (niveau + date)
// et retourne le mailto prêt à envoyer (email souverain, cf. Sprint v3.17).
app.post('/api/factures-clients/:id/relance', requireAdmin, async (req, res) => {
  try {
    const recs = await atFetchByIds(TABLES['factures-clients'].id, [req.params.id]);
    if (!recs[0]) return res.status(404).json({ error: 'facture introuvable' });
    const f = normFactureClient(recs[0]);
    const today = todayISO();
    f.joursRetard = joursRetard(f.dateEcheance, today);
    const niveau = Math.min(Math.max(Number(req.body?.niveau) || niveauRelanceSuggere(f) || f.niveauRelance + 1, 1), 3);

    const c = f.clientIds.length ? (await atFetchByIds(TABLES.clients.id, [f.clientIds[0]]))[0] : null;
    const clientNom = c?.fields['Nom'] || '?';
    const email = buildEmailRelance({
      numero: f.numero, clientNom, montantRestant: f.montantRestant,
      dateEcheance: f.dateEcheance, niveau,
    });
    await atPatch(TABLES['factures-clients'].id, f.id, {
      'Niveau relance': niveau,
      'Date dernière relance': today,
      'Statut': 'En retard',
    });
    logger.info({ facture: f.numero, niveau }, '[factures-clients] relance enregistrée');
    res.json({ ok: true, niveau, sujet: email.sujet, corps: email.corps, mailto: buildMailto(c?.fields['Email'] || '', email.sujet, email.corps) });
  } catch (e) {
    logger.error('[factures-clients/relance] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/factures-clients/:id/reglement — encaisse un règlement (total ou partiel).
// Synchronise l'échéance devis liée (Statut Encaissé) quand la facture est soldée.
app.post('/api/factures-clients/:id/reglement', requireAdmin, async (req, res) => {
  const { montant, mode, date } = req.body || {};
  const m = Number(montant);
  if (!m || m <= 0) return res.status(400).json({ error: 'montant > 0 requis' });
  try {
    const recs = await atFetchByIds(TABLES['factures-clients'].id, [req.params.id]);
    if (!recs[0]) return res.status(404).json({ error: 'facture introuvable' });
    const f = normFactureClient(recs[0]);
    const nouveauRegle = Math.round((f.montantRegle + m) * 100) / 100;
    const soldee = nouveauRegle >= f.montantTTC - 0.01;
    const dateReglement = date || todayISO();
    await atPatch(TABLES['factures-clients'].id, f.id, {
      'Montant réglé': nouveauRegle,
      'Date règlement': dateReglement,
      ...(mode ? { 'Mode règlement': mode } : {}),
      'Statut': soldee ? 'Payée' : 'Payée partiellement',
    });
    // Sync échéance devis liée (contrôle des encaissements unifié)
    if (soldee && f.echeanceIds.length) {
      await atPatch(TABLES['echeances-devis'].id, f.echeanceIds[0], {
        'Statut': 'Encaissé',
        'Montant réglé': nouveauRegle,
        'Date règlement': dateReglement,
        ...(mode ? { 'Mode règlement': mode } : {}),
      }).catch(err => logger.warn({ err: err.message }, '[reglement] sync échéance échouée'));
    }
    logger.info({ facture: f.numero, montant: m, soldee }, '[factures-clients] règlement enregistré');
    res.json({ ok: true, montantRegle: nouveauRegle, statut: soldee ? 'Payée' : 'Payée partiellement' });
  } catch (e) {
    logger.error('[factures-clients/reglement] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Factures fournisseurs ---------------------------------------------------

// POST /api/factures-fournisseurs/import — upload PDF → parse Claude → contrôle
// automatique vs commande liée (rapprochement) → record "À contrôler".
// withKeepAlive : parse Claude 30-90s (cf. helper ligne ~290, check j.error côté front).
app.post('/api/factures-fournisseurs/import', requireAdmin, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis (champ "pdf")' });
  if (!validatePdfMagicBytes(req.file.buffer)) return res.status(400).json({ error: 'Fichier invalide : signature PDF absente' });
  const commandeIdParam = req.body?.commandeId || null;

  await withKeepAlive(req, res, async () => {
    const parsed = await parseFactureFournisseurPdf(req.file.buffer);
    const meta = parsed.metadata || {};
    const totaux = parsed.totaux || {};
    const numero = meta.numero_facture || `FF-${Date.now().toString(36).toUpperCase()}`;

    const [fournisseurs, facturesExistantes, commandes] = await Promise.all([
      atFetchAll(TABLES.fournisseurs.id),
      atFetchAll(TABLES['factures-fournisseurs'].id),
      atFetchAll(TABLES.commandes.id),
    ]);

    // Anti-doublon : même numéro de facture déjà saisi
    const doublon = facturesExistantes.find(x => String(x.fields['Numéro'] || '').trim().toLowerCase() === String(numero).trim().toLowerCase());
    if (doublon) throw new Error(`Facture ${numero} déjà saisie (record ${doublon.id})`);

    // Rapprochement fournisseur par nom (insensible casse, inclusion bidirectionnelle)
    const nomFournisseur = String(parsed.fournisseur?.nom || '').toLowerCase().trim();
    const fournisseur = nomFournisseur ? fournisseurs.find(x => {
      const n = String(x.fields['Nom'] || '').toLowerCase().trim();
      return n && (n.includes(nomFournisseur) || nomFournisseur.includes(n));
    }) : null;

    // Rapprochement commande : param explicite > référence BC > contremarque
    let commande = commandeIdParam ? commandes.find(x => x.id === commandeIdParam) : null;
    if (!commande && meta.reference_commande) {
      const ref = String(meta.reference_commande).toLowerCase().trim();
      commande = commandes.find(x => String(x.fields['Numéro'] || '').toLowerCase().trim() === ref
        || String(x.fields['Référence courte'] || '').toLowerCase().trim() === ref);
    }
    if (!commande && meta.contremarque) {
      const cm = String(meta.contremarque).toLowerCase().trim();
      commande = commandes.find(x => String(x.fields['Contremarque'] || '').toLowerCase().trim() === cm);
    }

    // Contrôle automatique (pointage facture ↔ commande)
    const controles = [];
    let ecart = null;
    if (commande) {
      controles.push(`Commande rapprochée : ${commande.fields['Numéro'] || commande.id}`);
      const mtCommande = Number(commande.fields['Montant HT']);
      const mtFacture = Number(totaux.total_ht);
      if (!isNaN(mtCommande) && !isNaN(mtFacture) && mtCommande > 0) {
        ecart = Math.round((mtFacture - mtCommande) * 100) / 100;
        controles.push(Math.abs(ecart) < 1
          ? `✓ Montant HT conforme à la commande (${euros(mtCommande)})`
          : `⚠ Écart HT de ${euros(ecart)} vs commande (facture ${euros(mtFacture)} / commande ${euros(mtCommande)})`);
      }
      const fournCommande = (commande.fields['Fournisseur'] || [])[0];
      if (fournisseur && fournCommande && fournCommande !== fournisseur.id) {
        controles.push('⚠ Le fournisseur de la facture ne correspond pas à celui de la commande');
      }
    } else {
      controles.push('Aucune commande rapprochée automatiquement — vérifier manuellement');
    }
    if (!fournisseur && nomFournisseur) controles.push(`⚠ Fournisseur "${parsed.fournisseur.nom}" introuvable dans la table Fournisseurs`);

    const created = await atCreate(TABLES['factures-fournisseurs'].id, {
      'Numéro': numero,
      ...(fournisseur ? { 'Fournisseur': [fournisseur.id] } : {}),
      ...(commande ? { 'Commande': [commande.id], 'Projet': commande.fields['Projet'] || [] } : {}),
      'Date facture': meta.date_facture || todayISO(),
      'Date échéance': meta.date_echeance || addDays(meta.date_facture || todayISO(), 30),
      'Montant HT': Number(totaux.total_ht) || 0,
      'Montant TVA': Number(totaux.total_tva) || 0,
      'Montant TTC': Number(totaux.total_ttc) || 0,
      'Statut': 'À contrôler',
      'Contrôle': controles.join('\n'),
      ...(ecart != null ? { 'Écart': ecart } : {}),
      'Alertes parsing': parsed.alertes_parsing || '',
      'Notes': parsed.lignes_resume || '',
    });

    // Attache le PDF original (limite 5 MB content API)
    if (req.file.buffer.length <= 5 * 1024 * 1024) {
      await atUploadAttachment(created.id, FF_FIELDS.pdf, req.file.buffer, req.file.originalname || `${numero}.pdf`)
        .catch(err => logger.warn({ err: err.message }, '[factures-fournisseurs] upload PDF échoué'));
    }
    logger.info({ numero, fournisseur: fournisseur?.fields['Nom'], commande: commande?.fields['Numéro'], ecart }, '[factures-fournisseurs] importée');
    return { ok: true, facture: { id: created.id, ...created.fields }, controles, alertes: parsed.alertes_parsing || '' };
  });
});

// GET /api/reglements/a-preparer — factures fournisseurs à payer, groupées par
// semaine d'échéance (préparation des virements du lundi).
app.get('/api/reglements/a-preparer', requireAdmin, async (req, res) => {
  try {
    const today = todayISO();
    const [factures, fournisseurs] = await Promise.all([
      atFetchAll(TABLES['factures-fournisseurs'].id),
      atFetchAll(TABLES.fournisseurs.id),
    ]);
    const fournById = new Map(fournisseurs.map(x => [x.id, x.fields['Nom'] || '?']));
    const aPayer = factures
      .filter(x => ['Validée', 'À payer'].includes(x.fields['Statut'] || ''))
      .map(x => ({
        id: x.id,
        numero: x.fields['Numéro'] || '?',
        fournisseur: fournById.get((x.fields['Fournisseur'] || [])[0]) || '?',
        dateEcheance: x.fields['Date échéance'] || null,
        montantTTC: Number(x.fields['Montant TTC']) || 0,
        statut: x.fields['Statut'],
        enRetard: !!(x.fields['Date échéance'] && x.fields['Date échéance'] < today),
        semaine: x.fields['Date échéance'] ? mondayOf(x.fields['Date échéance']) : null,
      }))
      .sort((a, b) => String(a.dateEcheance || '9999').localeCompare(String(b.dateEcheance || '9999')));

    const parSemaine = {};
    for (const f of aPayer) {
      const key = f.semaine || 'sans-date';
      (parSemaine[key] = parSemaine[key] || { factures: [], total: 0 }).factures.push(f);
      parSemaine[key].total = Math.round((parSemaine[key].total + f.montantTTC) * 100) / 100;
    }
    res.json({ ok: true, aPayer, parSemaine, total: Math.round(aPayer.reduce((s, f) => s + f.montantTTC, 0) * 100) / 100 });
  } catch (e) {
    logger.error('[reglements/a-preparer] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/factures-fournisseurs/:id/payer — marque payée (date + mode).
app.post('/api/factures-fournisseurs/:id/payer', requireAdmin, async (req, res) => {
  try {
    await atPatch(TABLES['factures-fournisseurs'].id, req.params.id, {
      'Statut': 'Payée',
      'Date paiement': req.body?.date || todayISO(),
      ...(req.body?.mode ? { 'Mode paiement': req.body.mode } : {}),
    });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[factures-fournisseurs/payer] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Trésorerie ----------------------------------------------------------------

// GET /api/tresorerie/plan?semaines=12 — plan de trésorerie hebdomadaire.
// Entrées = factures clients non soldées + échéances devis non encaissées non
// facturées (dédup via echeancesFacturees). Sorties = factures fournisseurs dues.
app.get('/api/tresorerie/plan', requireAdmin, async (req, res) => {
  try {
    const nbSemaines = Math.min(Math.max(parseInt(req.query.semaines, 10) || 12, 4), 26);
    const today = todayISO();
    const [facturesCliRaw, echeancesRaw, facturesFournRaw, fournisseurs] = await Promise.all([
      atFetchAll(TABLES['factures-clients'].id),
      atFetchAll(TABLES['echeances-devis'].id),
      atFetchAll(TABLES['factures-fournisseurs'].id),
      atFetchAll(TABLES.fournisseurs.id),
    ]);
    const facturesCli = facturesCliRaw.map(normFactureClient);
    const fournById = new Map(fournisseurs.map(x => [x.id, x.fields['Nom'] || '?']));

    const entrees = [];
    for (const f of facturesCli) {
      if (['Payée', 'Annulée'].includes(f.statut) || f.montantRestant <= 0) continue;
      entrees.push({ date: f.dateEcheance || f.dateEmission, montant: f.montantRestant, label: `Facture ${f.numero}`, kind: 'facture-client', id: f.id });
    }
    const facturees = echeancesFacturees(facturesCli);
    for (const e of echeancesRaw) {
      if ((e.fields['Statut'] || '') === 'Encaissé' || facturees.has(e.id)) continue;
      const restant = (Number(e.fields['Montant prévu']) || 0) - (Number(e.fields['Montant réglé']) || 0);
      if (restant <= 0) continue;
      entrees.push({ date: e.fields['Date prévue'] || null, montant: Math.round(restant * 100) / 100, label: `Échéance ${e.fields['Libellé'] || '?'}`, kind: 'echeance', id: e.id });
    }
    const sorties = [];
    for (const x of facturesFournRaw) {
      const statut = x.fields['Statut'] || '';
      if (['Payée', 'Avoir reçu'].includes(statut)) continue;
      const ttc = Number(x.fields['Montant TTC']) || 0;
      if (ttc <= 0) continue;
      sorties.push({
        date: x.fields['Date échéance'] || x.fields['Date facture'] || null,
        montant: ttc,
        label: `${x.fields['Numéro'] || '?'} — ${fournById.get((x.fields['Fournisseur'] || [])[0]) || '?'}${statut === 'Litige' ? ' (litige)' : ''}`,
        kind: 'facture-fournisseur', id: x.id,
      });
    }
    const plan = buildPlanTresorerie({ entrees, sorties, today, nbSemaines });
    res.json({ ok: true, today, nbSemaines, ...plan });
  } catch (e) {
    logger.error('[tresorerie/plan] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tresorerie/export-compta?mois=YYYY-MM[&format=json] — pièces du mois
// (ventes + achats) pour l'expert-comptable. CSV Excel FR par défaut.
app.get('/api/tresorerie/export-compta', requireAdmin, async (req, res) => {
  const mois = String(req.query.mois || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mois)) return res.status(400).json({ error: 'mois=YYYY-MM requis' });
  try {
    const [facturesCliRaw, facturesFournRaw, clients, fournisseurs] = await Promise.all([
      atFetchAll(TABLES['factures-clients'].id),
      atFetchAll(TABLES['factures-fournisseurs'].id),
      atFetchAll(TABLES.clients.id),
      atFetchAll(TABLES.fournisseurs.id),
    ]);
    const clientById = new Map(clients.map(x => [x.id, x.fields['Nom'] || '?']));
    const fournById = new Map(fournisseurs.map(x => [x.id, x.fields['Nom'] || '?']));

    const rows = [];
    for (const r of facturesCliRaw) {
      const f = r.fields || {};
      if ((f['Date émission'] || '').slice(0, 7) !== mois) continue;
      if ((f['Statut'] || '') === 'Annulée') continue;
      rows.push({
        sens: 'Vente', numero: f['Numéro'] || '?', tiers: clientById.get((f['Client'] || [])[0]) || '?',
        date: f['Date émission'] || '', echeance: f['Date échéance'] || '',
        ht: Number(f['Montant HT']) || 0, tva: Number(f['Montant TVA']) || 0, ttc: Number(f['Montant TTC']) || 0,
        regle: Number(f['Montant réglé']) || 0, statut: f['Statut'] || '', mode: f['Mode règlement'] || '',
      });
    }
    for (const r of facturesFournRaw) {
      const f = r.fields || {};
      if ((f['Date facture'] || '').slice(0, 7) !== mois) continue;
      rows.push({
        sens: 'Achat', numero: f['Numéro'] || '?', tiers: fournById.get((f['Fournisseur'] || [])[0]) || '?',
        date: f['Date facture'] || '', echeance: f['Date échéance'] || '',
        ht: Number(f['Montant HT']) || 0, tva: Number(f['Montant TVA']) || 0, ttc: Number(f['Montant TTC']) || 0,
        regle: f['Statut'] === 'Payée' ? (Number(f['Montant TTC']) || 0) : 0, statut: f['Statut'] || '', mode: f['Mode paiement'] || '',
      });
    }
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (req.query.format === 'json') return res.json({ ok: true, mois, rows });
    const csv = toCsv(rows, [
      { key: 'sens', label: 'Sens' }, { key: 'numero', label: 'Numéro' }, { key: 'tiers', label: 'Tiers' },
      { key: 'date', label: 'Date' }, { key: 'echeance', label: 'Échéance' },
      { key: 'ht', label: 'Montant HT' }, { key: 'tva', label: 'TVA' }, { key: 'ttc', label: 'Montant TTC' },
      { key: 'regle', label: 'Réglé' }, { key: 'statut', label: 'Statut' }, { key: 'mode', label: 'Mode' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="compta-tanguy-design-${mois}.csv"`);
    res.send(csv);
  } catch (e) {
    logger.error('[tresorerie/export-compta] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- RH (admin only — données personnelles) ------------------------------------

function normSalarie(r) {
  const f = r.fields || {};
  return {
    id: r.id, nom: f['Nom'] || '?', poste: f['Poste'] || '', typeContrat: f['Type contrat'] || '',
    soldeConges: typeof f['Solde congés'] === 'number' ? f['Solde congés'] : null,
    prochaineVisite: f['Prochaine visite médicale'] || null, actif: !!f['Actif'],
  };
}

// GET /api/rh/paie?mois=YYYY-MM[&format=csv] — éléments de paie mensuels par salarié.
app.get('/api/rh/paie', requireAdmin, async (req, res) => {
  const mois = String(req.query.mois || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mois)) return res.status(400).json({ error: 'mois=YYYY-MM requis' });
  try {
    const [salariesRaw, heuresRaw, absencesRaw] = await Promise.all([
      atFetchAll(TABLES.salaries.id),
      atFetchAll(TABLES['heures-salaries'].id),
      atFetchAll(TABLES.absences.id),
    ]);
    const salaries = salariesRaw.map(normSalarie).filter(s => s.actif);
    const heures = heuresRaw.map(r => ({
      salarieId: (r.fields['Salarié'] || [])[0], semaine: r.fields['Semaine du'] || '',
      heuresNormales: Number(r.fields['Heures normales']) || 0, heuresSupp: Number(r.fields['Heures supp']) || 0,
    }));
    const absences = absencesRaw.map(r => ({
      salarieId: (r.fields['Salarié'] || [])[0], type: r.fields['Type'] || 'Autre',
      dateDebut: r.fields['Date début'] || null, dateFin: r.fields['Date fin'] || null,
      jours: Number(r.fields['Jours ouvrés']) || 0, statut: r.fields['Statut'] || '',
    }));
    const recap = recapPaieMois({ salaries, heures, absences, mois });

    if (req.query.format === 'csv') {
      const csv = toCsv(recap, [
        { key: 'nom', label: 'Salarié' }, { key: 'poste', label: 'Poste' }, { key: 'typeContrat', label: 'Contrat' },
        { key: 'heuresNormales', label: 'Heures normales' }, { key: 'heuresSupp', label: 'Heures supp' },
        { key: 'congesPris', label: 'Congés/RTT pris (j)' }, { key: 'maladie', label: 'Maladie (j)' },
        { key: 'autresAbsences', label: 'Autres absences (j)' }, { key: 'soldeConges', label: 'Solde congés' },
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="paie-${mois}.csv"`);
      return res.send(csv);
    }
    res.json({ ok: true, mois, recap });
  } catch (e) {
    logger.error('[rh/paie] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/rh/alertes — visites médicales à planifier/dépassées + absences à valider.
app.get('/api/rh/alertes', requireAdmin, async (req, res) => {
  try {
    const [salariesRaw, absencesRaw] = await Promise.all([
      atFetchAll(TABLES.salaries.id),
      atFetchAll(TABLES.absences.id),
    ]);
    const salaries = salariesRaw.map(normSalarie).filter(s => s.actif);
    const visites = alertesVisitesMedicales(salaries, todayISO(), 60);
    const absencesAValider = absencesRaw
      .filter(r => (r.fields['Statut'] || '') === 'Demandée')
      .map(r => ({ id: r.id, libelle: r.fields['Libellé'] || '?', type: r.fields['Type'] || '?', dateDebut: r.fields['Date début'], dateFin: r.fields['Date fin'], jours: r.fields['Jours ouvrés'] }));
    res.json({ ok: true, visites, absencesAValider });
  } catch (e) {
    logger.error('[rh/alertes] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/rh/absences — déclare une absence (libellé + jours ouvrés auto).
app.post('/api/rh/absences', requireAdmin, async (req, res) => {
  const { salarieId, type, dateDebut, dateFin, jours, notes } = req.body || {};
  if (!salarieId || !type || !dateDebut) return res.status(400).json({ error: 'salarieId, type et dateDebut requis' });
  try {
    const sal = (await atFetchByIds(TABLES.salaries.id, [salarieId]))[0];
    if (!sal) return res.status(404).json({ error: 'salarié introuvable' });
    const fin = dateFin || dateDebut;
    const nbJours = Number(jours) > 0 ? Number(jours) : joursOuvres(dateDebut, fin);
    const created = await atCreate(TABLES.absences.id, {
      'Libellé': `${sal.fields['Nom'] || '?'} — ${type} — ${dateDebut}${fin !== dateDebut ? ` → ${fin}` : ''}`,
      'Salarié': [salarieId],
      'Type': type,
      'Date début': dateDebut,
      'Date fin': fin,
      'Jours ouvrés': nbJours,
      'Statut': 'Demandée',
      ...(notes ? { 'Notes': notes } : {}),
    });
    res.json({ ok: true, absence: { id: created.id, ...created.fields } });
  } catch (e) {
    logger.error('[rh/absences] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/rh/absences/:id/decision — valide ou refuse. À la validation d'un
// congé payé / RTT, décrémente le solde de congés du salarié.
app.post('/api/rh/absences/:id/decision', requireAdmin, async (req, res) => {
  const decision = req.body?.decision;
  if (!['Validée', 'Refusée'].includes(decision)) return res.status(400).json({ error: 'decision = Validée | Refusée' });
  try {
    const abs = (await atFetchByIds(TABLES.absences.id, [req.params.id]))[0];
    if (!abs) return res.status(404).json({ error: 'absence introuvable' });
    if ((abs.fields['Statut'] || '') !== 'Demandée') return res.status(409).json({ error: `absence déjà ${abs.fields['Statut']}` });
    await atPatch(TABLES.absences.id, abs.id, { 'Statut': decision });
    let nouveauSolde = null;
    if (decision === 'Validée' && ['Congés payés', 'RTT'].includes(abs.fields['Type'] || '')) {
      const salarieId = (abs.fields['Salarié'] || [])[0];
      const sal = salarieId ? (await atFetchByIds(TABLES.salaries.id, [salarieId]))[0] : null;
      if (sal && typeof sal.fields['Solde congés'] === 'number') {
        nouveauSolde = Math.round((sal.fields['Solde congés'] - (Number(abs.fields['Jours ouvrés']) || 0)) * 10) / 10;
        await atPatch(TABLES.salaries.id, salarieId, { 'Solde congés': nouveauSolde });
      }
    }
    logger.info({ absence: abs.fields['Libellé'], decision, nouveauSolde }, '[rh/absences] décision');
    res.json({ ok: true, decision, nouveauSolde });
  } catch (e) {
    logger.error('[rh/absences/decision] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/rh/heures — saisie hebdo des heures (upsert par salarié + semaine).
app.post('/api/rh/heures', requireAdmin, async (req, res) => {
  const { salarieId, semaine, heuresNormales, heuresSupp, projetId, notes } = req.body || {};
  if (!salarieId || !semaine || !/^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
    return res.status(400).json({ error: 'salarieId et semaine (YYYY-MM-DD) requis' });
  }
  try {
    const lundi = mondayOf(semaine);
    const sal = (await atFetchByIds(TABLES.salaries.id, [salarieId]))[0];
    if (!sal) return res.status(404).json({ error: 'salarié introuvable' });
    const fields = {
      'Heures normales': Number(heuresNormales) || 0,
      'Heures supp': Number(heuresSupp) || 0,
      ...(projetId ? { 'Projet': [projetId] } : {}),
      ...(notes ? { 'Notes': notes } : {}),
    };
    // Upsert : un seul relevé par salarié et par semaine
    const existants = await atFetchAll(TABLES['heures-salaries'].id);
    const existant = existants.find(r => (r.fields['Salarié'] || [])[0] === salarieId && r.fields['Semaine du'] === lundi);
    let rec;
    if (existant) {
      rec = await atPatch(TABLES['heures-salaries'].id, existant.id, fields);
    } else {
      const [y, m, d] = lundi.split('-');
      rec = await atCreate(TABLES['heures-salaries'].id, {
        'Libellé': `${sal.fields['Nom'] || '?'} — semaine du ${d}/${m}`,
        'Salarié': [salarieId],
        'Semaine du': lundi,
        ...fields,
      });
    }
    res.json({ ok: true, heures: { id: rec.id, ...rec.fields }, updated: !!existant });
  } catch (e) {
    logger.error('[rh/heures] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Logistique Tanguy Design ----------------------------------------------------

// GET /api/commandes-retards — commandes dont la livraison prévue est dépassée,
// avec email de relance fournisseur prêt (mailto souverain).
// NB : pas /api/commandes/retards, qui serait avalé par GET /api/commandes/:id.
app.get('/api/commandes-retards', requireAuth, async (req, res) => {
  try {
    const today = todayISO();
    const [commandes, fournisseurs, projets] = await Promise.all([
      atFetchAll(TABLES.commandes.id),
      atFetchAll(TABLES.fournisseurs.id),
      atFetchAll(TABLES.projets.id),
    ]);
    const fournById = new Map(fournisseurs.map(x => [x.id, x.fields]));
    const projetById = new Map(projets.map(x => [x.id, x.fields]));
    const STATUTS_CLOS = /livr|r[ée]cep|reçu|annul|termin/i;

    const retards = commandes
      .filter(c => c.fields['Date livraison prévue'] && c.fields['Date livraison prévue'] < today)
      .filter(c => !STATUTS_CLOS.test(String(c.fields['Statut'] || '')))
      .map(c => {
        const fourn = fournById.get((c.fields['Fournisseur'] || [])[0]) || {};
        const projet = projetById.get((c.fields['Projet'] || [])[0]) || {};
        const email = buildEmailRelanceFournisseur({
          numero: c.fields['Numéro'] || c.id,
          contremarque: c.fields['Contremarque'] || '',
          dateLivraisonPrevue: c.fields['Date livraison prévue'],
          fournisseurNom: fourn['Nom'] || '',
        });
        return {
          id: c.id,
          numero: c.fields['Numéro'] || '?',
          type: c.fields['Type'] || '',
          statut: c.fields['Statut'] || '',
          fournisseur: fourn['Nom'] || '?',
          projetRef: projet['Référence'] || '',
          dateLivraisonPrevue: c.fields['Date livraison prévue'],
          joursRetard: joursRetard(c.fields['Date livraison prévue'], today),
          relance: { sujet: email.sujet, mailto: buildMailto(fourn['Email commande'] || '', email.sujet, email.corps) },
        };
      })
      .sort((a, b) => b.joursRetard - a.joursRetard);
    res.json({ ok: true, retards });
  } catch (e) {
    logger.error('[commandes/retards] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projets/:id/dossier-chantier — génère la checklist administrative
// avant démarrage chantier (tâches idempotentes, échéance = pose - 30 j).
const DOSSIER_CHANTIER_TACHES = [
  'Dossier chantier — Collecter plans signés + feuille de choix',
  'Dossier chantier — Vérifier autorisations (copropriété / urbanisme)',
  'Dossier chantier — Vérifier encaissement acompte',
  'Dossier chantier — Attestations assurance artisans à jour',
  'Dossier chantier — Confirmer accès chantier / stationnement / étage',
  'Dossier chantier — Transmettre dossier technique aux artisans',
];
app.post('/api/projets/:id/dossier-chantier', requireAuth, async (req, res) => {
  const projetId = req.params.id;
  try {
    const projet = (await atFetchByIds(TABLES.projets.id, [projetId]))[0];
    if (!projet) return res.status(404).json({ error: 'projet introuvable' });
    const tachesIds = projet.fields['Tâches'] || [];
    const existantes = tachesIds.length ? await atFetchByIds(TABLES.taches.id, tachesIds) : [];
    const titresExistants = new Set(existantes.map(t => t.fields['Titre']));
    const echeance = projet.fields['Date pose prévue'] ? addDays(projet.fields['Date pose prévue'], -30) : null;

    const aCreer = DOSSIER_CHANTIER_TACHES.filter(t => !titresExistants.has(t)).map(titre => ({
      'Titre': titre,
      'Projet': [projetId],
      'Statut': 'À faire',
      'Priorité': 'Haute',
      'Assignée à': 'Virginie',
      ...(echeance ? { 'Échéance': echeance } : {}),
      'Description': 'Checklist dossier administratif avant démarrage chantier (générée automatiquement).',
    }));
    const created = aCreer.length ? await atCreateBatch(TABLES.taches.id, aCreer) : [];
    logger.info({ projetId, creees: created.length, dejaPresentes: DOSSIER_CHANTIER_TACHES.length - aCreer.length }, '[dossier-chantier] checklist générée');
    res.json({ ok: true, creees: created.length, dejaPresentes: DOSSIER_CHANTIER_TACHES.length - aCreer.length });
  } catch (e) {
    logger.error('[dossier-chantier] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Static ---
// Sprint v3.12 — Cutover : la racine sert le cockpit v3.
// Grand nettoyage 2026-06-07 : le cockpit v2 (rollback temporaire) est supprimé —
// routes /v2 + public/index.html + public/assets/js/main.js + public/assets/css.
// /assets reste monté : il sert public/assets/js/login.js (page /login).
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));

// /v3/ — démo isolée du pivot client-centric (Sprint 1).
// Pas de redirect /v3 → /v3/ : Cloudflare normalise les URLs en supprimant le trailing
// slash, ce qui crée une boucle ERR_TOO_MANY_REDIRECTS. On sert le même HTML sur les
// deux paths, et tous les <link>/<script> de l'index.html sont en chemin absolu
// (/v3/assets/...) donc OK quel que soit le path d'entrée.
//
// Sprint v3.3 — cache-busting des modules ES :
// Le browser garde les imports ES en cache navigateur (cache-control max-age=14400
// imposé par Cloudflare malgré nos headers). Pour propager les fix immédiatement,
// on append `?v=<GITHUB_SHA>` sur tous les imports relatifs des fichiers .js de /v3/
// ET sur le main.js / styles.css référencés dans index.html. Chaque deploy = nouveau
// SHA = nouvelle URL = browser télécharge frais.
const V3_VERSION = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
const v3IndexHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'v3', 'index.html'), 'utf8');
  html = html.replace(/src="\/v3\/assets\/js\/main\.js"/g, `src="/v3/assets/js/main.js?v=${V3_VERSION}"`);
  html = html.replace(/href="\/v3\/assets\/css\/styles\.css"/g, `href="/v3/assets/css/styles.css?v=${V3_VERSION}"`);
  return html;
})();
const v3Index = (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(v3IndexHtml);
};
// Sprint v3.12 — La racine sert maintenant le cockpit v3 (cutover).
app.get('/',    requireAuth, v3Index);
app.get('/v3',  requireAuth, v3Index);  // alias pour bookmarks existants
app.get('/v3/', requireAuth, v3Index);  // idem

// Middleware qui réécrit tous les imports relatifs des .js de /v3/ avec ?v=VERSION
// pour forcer le browser à télécharger les nouveaux modules à chaque déploiement.
// Doit être placé AVANT express.static pour intercepter.
app.get(/^\/v3\/assets\/js\/.+\.js$/, requireAuth, (req, res, next) => {
  const fp = path.join(__dirname, 'public', req.path);
  if (!fs.existsSync(fp)) return next();
  let js;
  try { js = fs.readFileSync(fp, 'utf8'); }
  catch (e) { return next(); }
  // Réécrit `from './x.js'` → `from './x.js?v=VERSION'`
  js = js.replace(/(\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])(\.\.?\/[^'"]+\.js)\2/g,
    (m, prefix, q, p) => `${prefix}${q}${p}?v=${V3_VERSION}${q}`);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(js);
});
// V3 est encore en dev rapide : pas de cache long. Le browser doit toujours revalider
// (Cmd+R = ETag → 304 si pas changé, sinon 200 avec nouveau code). Cela évite que les
// users gardent un module ES obsolète après un fix déployé (cas vu 2026-05-21 : champ
// Artisans filtré côté front pas pris en compte parce que projet.js était en cache 4h).
app.use('/v3',  requireAuth, express.static(path.join(__dirname, 'public', 'v3'), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (/\.(js|css|html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

app.listen(PORT, () => {
  logger.info(`✅ Tanguy Design — Cockpit v0.3.0 on port ${PORT}`);
  logger.info(`   Users: ${Object.keys(USERS).length} | Airtable: ${BASE_ID ? 'OK' : 'MISSING'} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'}`);
});
