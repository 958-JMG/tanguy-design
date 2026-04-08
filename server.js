const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

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
  return res.redirect('/login');
}

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'tanguy-design',
    airtable_configured: !!process.env.AIRTABLE_KEY && !!process.env.AIRTABLE_BASE_ID,
    users_count: Object.keys(USERS).length
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
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: req.session.user });
});

// --- Static (protected) ---
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

app.listen(PORT, () => {
  console.log(`✅ Tanguy Design — Cockpit running on port ${PORT}`);
  console.log(`   Users: ${Object.keys(USERS).length} | Airtable: ${process.env.AIRTABLE_BASE_ID ? 'OK' : 'MISSING'}`);
});
