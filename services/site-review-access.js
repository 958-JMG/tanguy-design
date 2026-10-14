const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const { esc } = require('../website/render.cjs');

function safeNext(value) {
  if (typeof value !== 'string' || value.length > 1500 || /[\\\r\n]/.test(value)) return '/site/';
  try {
    const url = new URL(value, 'https://review.invalid');
    return url.origin === 'https://review.invalid' && /^\/site\/(?!acces(?:\/|$)|deconnexion(?:\/|$))/i.test(url.pathname) ? url.pathname + url.search : '/site/';
  } catch { return '/site/'; }
}

function accessPage(req, res, error = '') {
  req.session.siteReviewCsrf ||= crypto.randomBytes(32).toString('hex');
  const next = safeNext(req.method === 'POST' ? req.body?.next : req.query.next);
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Validation du site · Tanguy Design</title><style>
  *{box-sizing:border-box}body{margin:0;background:#e9e5df;color:#171816;font:16px/1.55 Arial,sans-serif;min-height:100svh;display:grid;place-items:center;padding:28px}main{width:min(100%,460px);padding:44px 36px;background:#fbfaf7;border:1px solid #d8d2c9}.brand{font-size:15px;letter-spacing:.18em;text-transform:uppercase;margin:0 0 44px}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#686359}h1{font:normal 39px/1.12 Georgia,serif;margin:14px 0 20px}.intro{color:#686359;margin-bottom:28px}label{display:block;font-size:13px;margin:18px 0 7px}input{width:100%;padding:13px;border:1px solid #b2ab9e;border-radius:0;background:#fff;color:#171816;font:inherit}button{width:100%;padding:15px;margin-top:24px;background:#171816;color:white;border:0;font:inherit;cursor:pointer}input:focus-visible,button:focus-visible{outline:2px solid #8a7455;outline-offset:3px}.error{color:#8b2a20;font-size:14px}.note{font-size:12px;color:#686359;margin:24px 0 0}@media(max-width:420px){body{padding:16px}main{padding:32px 24px}h1{font-size:35px}}
  </style></head><body><main><p class="brand">Tanguy Design</p><p class="eyebrow">Votre nouveau site</p><h1>Bienvenue dans votre espace de validation.</h1><p class="intro">Découvrez les pages du site et partagez-nous vos retours.</p>${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}<form method="post" action="/site/acces"><input type="hidden" name="csrf" value="${esc(req.session.siteReviewCsrf)}"><input type="hidden" name="next" value="${esc(next)}"><label for="login">Identifiant</label><input id="login" name="login" autocomplete="username" required maxlength="80" autocapitalize="none" spellcheck="false"><label for="password">Mot de passe</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="64"><button type="submit">Découvrir le site →</button></form><p class="note">Utilisez les accès transmis par 9·58. Aucun compte ChatGPT n’est nécessaire.</p></main></body></html>`);
}

function createReviewAccess({
  enabled = process.env.SITE_REVIEW_ENABLED === 'true',
  username = process.env.SITE_REVIEW_LOGIN || '',
  passwordHash = process.env.SITE_REVIEW_PASSWORD_HASH || '',
  now = Date.now,
  maxAge = 7 * 24 * 60 * 60 * 1000,
  attempts = 20,
} = {}) {
  const router = express.Router();
  const version = crypto.createHash('sha256').update(username + ':' + passwordHash).digest('hex');
  const valid = req => req.session?.siteReview?.version === version && req.session.siteReview.expiresAt > now();
  router.use((req, res, next) => {
    if (!enabled || req.sitePublic) return next('router');
    req.siteReviewProtected = true;
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.vary('Cookie');
    if (!username || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
      return res.status(503).send('L’accès de validation est en cours de configuration.');
    }
    next();
  });
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: attempts,
    standardHeaders: 'draft-8', legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => { res.status(429); accessPage(req, res, 'Trop de tentatives. Réessayez dans 15 minutes.'); },
  });
  router.get('/acces', (req, res) => valid(req) ? res.redirect(303, safeNext(req.query.next)) : accessPage(req, res));
  router.post('/acces', limiter, async (req, res, next) => {
    try {
      if (!req.session?.siteReviewCsrf || req.body?.csrf !== req.session.siteReviewCsrf || req.get('sec-fetch-site') === 'cross-site') {
        res.status(403); return accessPage(req, res, 'La page a expiré. Veuillez réessayer.');
      }
      const { login, password } = req.body;
      const matches = typeof password === 'string' && password.length <= 64 && await bcrypt.compare(password, passwordHash);
      if (typeof login !== 'string' || login !== username || !matches) {
        res.status(401); return accessPage(req, res, 'Identifiant ou mot de passe incorrect.');
      }
      // This grant never creates a cockpit user or grants CMS/API access.
      req.session.siteReview = { version, expiresAt: now() + maxAge };
      delete req.session.siteReviewCsrf;
      res.redirect(303, safeNext(req.body.next));
    } catch (error) { next(error); }
  });
  router.use((req, res, next) => {
    if (req.session?.user || valid(req)) return next();
    res.redirect(303, '/site/acces?next=' + encodeURIComponent(safeNext(req.originalUrl)));
  });
  return router;
}

module.exports = { createReviewAccess, safeNext };
