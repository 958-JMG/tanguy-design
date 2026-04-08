const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Airtable config ---
const BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AT_KEY  = process.env.AIRTABLE_KEY || '';

// Table IDs (créées via MCP Airtable)
const TABLES = {
  clients:      { id: 'tbl2zmxpWWzbY1wT0', name: 'Clients' },
  projets:      { id: 'tbl9y74Gakhfwt6i1', name: 'Projets' },
  artisans:     { id: 'tblWxbLpwHNagDKfJ', name: 'Artisans' },
  fournisseurs: { id: 'tblz1AZIKkn9VCbkR', name: 'Fournisseurs' },
  commandes:    { id: 'tblDynhnhLXb4Ibs2', name: 'Commandes' },
  taches:       { id: 'tblDwUHL16LBVMSaz', name: 'Tâches' },
  sav:          { id: 'tbl8ErWw6zhXLfCII', name: 'SAV' }
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
const USERS = parseUsers(process.env.USERS_HASHES);

// --- Middleware ---
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not authenticated' });
  return res.redirect('/login');
}

// --- Airtable helpers ---
async function atFetchAll(tableId) {
  if (!BASE_ID || !AT_KEY) throw new Error('Airtable not configured');
  let records = [], offset = null;
  do {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100${offset ? '&offset=' + offset : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
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

async function atPatch(tableId, recordId, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  return r.json();
}

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'tanguy-design',
    airtable_configured: !!AT_KEY && !!BASE_ID,
    users_count: Object.keys(USERS).length,
    tables: Object.keys(TABLES)
  });
});

// --- Auth ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

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

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: req.session.user });
});

// --- Data API (protégée) ---
app.get('/api/data/:table', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const records = await atFetchAll(t.id);
    res.json({ ok: true, records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/data/:table', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const rec = await atCreate(t.id, req.body.fields || {});
    res.json({ ok: true, record: rec });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/data/:table/:id', requireAuth, async (req, res) => {
  const t = TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const rec = await atPatch(t.id, req.params.id, req.body.fields || {});
    res.json({ ok: true, record: rec });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Static ---
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

app.listen(PORT, () => {
  console.log(`✅ Tanguy Design — Cockpit running on port ${PORT}`);
  console.log(`   Users: ${Object.keys(USERS).length} | Airtable: ${BASE_ID ? 'OK ' + BASE_ID : 'MISSING'}`);
});
