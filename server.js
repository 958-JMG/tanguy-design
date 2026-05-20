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

// --- Admin : IA suggestions cockpit (Sprint 4 P2) ---
// Analyse l'état du cockpit (projets en cours, alertes, marges, blockages) et demande à
// Claude (claude-sonnet-4-5) une synthèse + 5 suggestions actionnables. Admin only.
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'not authenticated' });
  if (!ADMIN_LOGINS.has(req.session.user)) return res.status(403).json({ error: 'admin requis' });
  next();
}
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

// --- Support feedback (Sprint 4 P2) ---
// Bouton flottant v3 → POST ici. On log structuré JSON, JMG suit dans Scaleway Logs Browser.
// Champs : message (requis), url, context (optionnel).
app.post('/api/support/feedback', requireAuth, async (req, res) => {
  const { message, url, context } = req.body || {};
  if (!message || message.length < 5) return res.status(400).json({ error: 'message requis (≥ 5 chars)' });
  if (message.length > 2000) return res.status(400).json({ error: 'message trop long (≤ 2000 chars)' });
  logger.warn({
    user: req.session?.user,
    url: String(url || '').slice(0, 200),
    context: String(context || '').slice(0, 500),
    message: String(message).slice(0, 2000),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  }, '[support] feedback utilisateur');
  res.json({ ok: true });
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
  const hash = USERS[loginLc];
  if (!hash) {
    accountRegisterFail(loginLc);
    logger.warn({ login: loginLc, ip }, '[auth] login FAIL (unknown user)');
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    accountRegisterFail(loginLc);
    logger.warn({ login: loginLc, ip }, '[auth] login FAIL (bad password)');
    return res.status(401).json({ error: 'identifiants invalides' });
  }
  accountRegisterSuccess(loginLc);
  req.session.user = loginLc;
  logger.info({ login: loginLc, ip }, '[auth] login OK');
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: req.session.user, isAdmin: ADMIN_LOGINS.has(req.session.user) });
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

    // Clients rattachés (cas architecte : champ inverse "Clients liés")
    const clientsLies = client.fields?.['Clients liés'] || [];

    // Agrégats simples pour la fiche
    const stats = {
      nbProjets: projets.length,
      nbProjetsEnCours: projets.filter(p => (p.fields['Statut chantier'] || '') !== 'Archivé' && (p.fields['Statut chantier'] || '') !== 'Terminé').length,
      caTotal: projets.reduce((sum, p) => sum + (p.fields['Budget HT'] || 0), 0),
    };

    res.json({ ok: true, client, projets, clientsLies, stats });
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
    const daIds     = projet.fields?.['Devis artisans'] || [];

    const [taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans] = await Promise.all([
      atFetchByIds(TABLES.taches.id, tacheIds),
      atFetchByIds(TABLES.commandes.id, cmdIds),
      atFetchByIds(TABLES.devis.id, devisIds),
      atFetchByIds(TABLES['reunions-plaud'].id, plaudIds),
      atFetchByIds(TABLES['devis-artisans'].id, daIds),
      atFetchAll(TABLES.fournisseurs.id),
      atFetchAll(TABLES.artisans.id),
    ]);

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

    res.json({ ok: true, projet, client, taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans });
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

    return {
      ok: true,
      devisId,
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
    // Pour meubles : extraire infos modèle depuis la 1re zone du devis (NOVA_CUC = singulier)
    let modeleHeader = '';
    let detailsModele = '';
    try {
      if (Array.isArray(parsed.zones) && parsed.zones[0]) {
        const z0 = parsed.zones[0];
        modeleHeader = [z0.marque, z0.modele].filter(Boolean).join(' — ') +
          (z0.porte_epaisseur ? `\nPorte épaisseur ${z0.porte_epaisseur}` : '');
        const lines = [];
        if (z0.modularite)              lines.push(`Modularité : ${z0.modularite}`);
        if (z0.execution_facade)        lines.push(`Exécution façade : ${z0.execution_facade}`);
        if (z0.coloris_facade)          lines.push(`Coloris façade : ${z0.coloris_facade}`);
        if (z0.chant_facade)            lines.push(`Chant façade : ${z0.chant_facade}`);
        if (z0.coloris_caisson)         lines.push(`Coloris caisson : ${z0.coloris_caisson}`);
        if (z0.execution_cote_finition) lines.push(`Exécution côté finition : ${z0.execution_cote_finition}`);
        if (z0.coloris_cote_finition)   lines.push(`Coloris côté finition : ${z0.coloris_cote_finition}`);
        if (z0.type_gorge)              lines.push(`Type de gorge : ${z0.type_gorge}`);
        if (z0.execution_gorges)        lines.push(`Exécution gorges : ${z0.execution_gorges}`);
        if (z0.finition_gorges)         lines.push(`Finition gorges : ${z0.finition_gorges}`);
        if (z0.profondeur)              lines.push(`Profondeur : ${z0.profondeur}`);
        if (z0.option_ouverture)        lines.push(`Option ouverture : ${z0.option_ouverture}`);
        if (z0.finition_socle)          lines.push(`Finition socle : ${z0.finition_socle}`);
        detailsModele = lines.join('\n');
      }
    } catch (e) { /* best effort */ }

    for (const [type, montant] of Object.entries(totauxParCat)) {
      if (montant <= 0) continue;
      const numCmd = clientNom
        ? `${clientNom} · ${type.toUpperCase()} · ${numero}-${idx}`
        : `${numero}-${type.slice(0,3).toUpperCase()}-${idx}`;
      const lignesType = lignesParType[type] || [];
      const { texte: tableauTexte } = buildBcTableau(lignesType);
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
      const notesPrefill = `[Auto-généré depuis devis ${numero} signé le ${new Date().toLocaleDateString('fr-FR')}]\n\nContenu prévisionnel (à valider/ajuster avant envoi au fournisseur, SANS MONTANTS) :\n\n${tableauTexte}`;
      const cf = {
        'Numéro': numCmd,
        'Statut': 'Créée',
        'Date création': new Date().toISOString().slice(0, 10),
        'Montant HT': Math.round(montant * 100) / 100,
        'Notes': notesPrefill,
        'Contremarque': clientNom || '',
        'Contact Tanguy': 'Solène',
        'Référence courte': TYPE_TO_REFERENCE_COURTE[type] || type.toUpperCase(),
        // Modèle choisi + détails uniquement pour les commandes Meubles (utile sur le BC)
        ...(type === 'Meubles' ? { 'Modèle choisi': modeleHeader, 'Détails modèle': detailsModele } : {}),
        'Lignes BC': JSON.stringify(lignesStructured, null, 2),
      };
      if (projetId) cf['Projet'] = [projetId];
      // Nettoyage : retirer les champs vides
      Object.keys(cf).forEach(k => { if (cf[k] === '' || cf[k] == null) delete cf[k]; });
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

    return { ok: true, record: rec, parsed, niveau: niveauResolu, tachesCreees };
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

  // La description Airtable est multiline — on garde les sauts de ligne via <br>.
  // Les dimensions L/H/P sont déjà dans la description (extraites du devis Winner), pas besoin de doubler.
  const lignesHtml = (Array.isArray(lignes) && lignes.length > 0)
    ? lignes.map(l => {
        const descHtml = l.description ? esc(l.description).replace(/\n/g, '<br>') : '';
        const notesHtml = l.notes ? '<br><em style="color:#c44">' + esc(l.notes).replace(/\n/g, '<br>') + '</em>' : '';
        const qteTxt = l.quantite != null
          ? l.quantite.toLocaleString('fr-FR', { minimumFractionDigits: 4 }) + (l.unite ? ' ' + l.unite : '')
          : '';
        return `
      <tr>
        <td>${esc(l.pos)}</td>
        <td><strong>${esc(l.code || '')}</strong>${descHtml ? '<br>' + descHtml : ''}${notesHtml}</td>
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
    await atPatch(TABLES.projets.id, projetId, { 'Date pose prévue': datePose });
    const filter = `FIND('${projetId}', ARRAYJOIN({Projet}))`;
    const devisList = await atFetchFiltered(TABLES.devis.id, filter);
    let recalcCount = 0;
    for (const d of devisList) {
      const dateDevis = d.fields['Date devis'] || null;
      const echIds = d.fields['Échéances devis'] || [];
      if (!echIds.length) continue;
      const echRecords = await atFetchByIds(TABLES['echeances-devis'].id, echIds);
      const echeancesForHelper = echRecords.map(r => ({
        _id: r.id,
        libelle: r.fields['Libellé'] || '',
        date_prevue: null,
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
// RC Pro 2026 : retirer le default hardcodé pour éviter d'exposer l'URL n8n
// dans le repo public. Si SAV_WEBHOOK_URL absent : le proxy SAV refuse l'envoi.
const SAV_WEBHOOK_URL    = process.env.SAV_WEBHOOK_URL    || '';
const SAV_WEBHOOK_SECRET = process.env.SAV_WEBHOOK_SECRET || '';
const SAV_CLIENT_SLUG    = process.env.SAV_CLIENT_SLUG    || 'tanguy';
const SAV_COCKPIT_SOURCE = process.env.SAV_COCKPIT_SOURCE || 'Cockpit Tanguy Design';
const SAV_ABONNEMENT     = process.env.SAV_ABONNEMENT     || 'Build';

app.post('/api/sav/submit', requireAuth, async (req, res) => {
  // RC Pro 2026 : refuser si URL ou secret webhook manquant (au lieu de fallback hardcodé)
  if (!SAV_WEBHOOK_URL) {
    return res.status(500).json({ error: 'SAV_WEBHOOK_URL non configuré côté serveur' });
  }
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

// /v3/ — démo isolée du pivot client-centric (Sprint 1).
// Pas de redirect /v3 → /v3/ : Cloudflare normalise les URLs en supprimant le trailing
// slash, ce qui crée une boucle ERR_TOO_MANY_REDIRECTS. On sert le même HTML sur les
// deux paths, et tous les <link>/<script> de l'index.html sont en chemin absolu
// (/v3/assets/...) donc OK quel que soit le path d'entrée.
const v3Index = (req, res) => res.sendFile(path.join(__dirname, 'public', 'v3', 'index.html'));
app.get('/v3',  requireAuth, v3Index);
app.get('/v3/', requireAuth, v3Index);
app.use('/v3',  requireAuth, express.static(path.join(__dirname, 'public', 'v3')));

app.listen(PORT, () => {
  logger.info(`✅ Tanguy Design — Cockpit v0.3.0 on port ${PORT}`);
  logger.info(`   Users: ${Object.keys(USERS).length} | Airtable: ${BASE_ID ? 'OK' : 'MISSING'} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'}`);
});
