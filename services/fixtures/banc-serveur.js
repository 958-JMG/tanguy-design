'use strict';
// ────────────────────────────────────────────────────────────────────────────
// Banc d'essai : le VRAI serveur (routes, liste blanche, session cookie-session
// signée), avec Airtable et Pennylane simulés EN MÉMOIRE. On voit ce qu'ils
// REÇOIVENT. Aucun appel réseau réel : tout hôte inattendu fait échouer le test.
//
// À appeler AVANT de charger server.js (il lit l'environnement au chargement).
// Chaque fichier de test tourne dans son propre processus : un banc par fichier.
//
//   const banc = require('./fixtures/banc-serveur')();
//   before(() => { semer(banc); return banc.demarrer(); });
//   after(() => banc.arreter());
// ────────────────────────────────────────────────────────────────────────────
const http = require('node:http');
const Keygrip = require('keygrip');

// Doivent rester synchronisés avec TABLES dans server.js.
const T = {
  devis: 'tblWklGEKMiBStXCs', lignes: 'tblCxDvzQAqBzpCx2', commandes: 'tblDynhnhLXb4Ibs2',
  projets: 'tbl9y74Gakhfwt6i1', clients: 'tbl2zmxpWWzbY1wT0', fournisseurs: 'tblz1AZIKkn9VCbkR',
  zones: 'tbl6FmEIIR15NMsgZ', taches: 'tblDwUHL16LBVMSaz',
};

module.exports = function creerBanc({ secret = 'secret-de-test-banc-serveur-tanguy-2026' } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.AIRTABLE_BASE_ID = 'appTESTBANC';
  process.env.AIRTABLE_KEY = 'patTEST';
  process.env.PENNYLANE_API_KEY = 'plTEST';
  process.env.ADMIN_LOGINS = 'virginie';
  process.env.SESSION_SECRET = secret;
  delete process.env.PENNYLANE_ECO_PRODUCT_ID;
  delete process.env.ANTHROPIC_API_KEY;   // aucune IA réelle depuis un test

  // ── Airtable simulé ───────────────────────────────────────────────────────
  const db = {};
  let seq = 0;
  const table = id => (db[id] ||= new Map());
  const put = (tableId, id, fields) => {
    table(tableId).set(id, { id, createdTime: '2026-10-14T07:00:00.000Z', fields: JSON.parse(JSON.stringify(fields)) });
  };
  const get = (tableId, id) => table(tableId).get(id);
  // Champs « pas encore migrés » : Airtable refuse alors toute écriture qui les porte.
  const champsInconnus = new Map(); // tableId → Set(noms)
  // Liens inverses tenus par Airtable lui-même.
  const INVERSES = [
    { de: T.commandes, champ: 'Projet', vers: T.projets, inverse: 'Commandes' },
    { de: T.devis, champ: 'Projet', vers: T.projets, inverse: 'Devis' },
    { de: T.lignes, champ: 'Devis', vers: T.devis, inverse: 'Lignes devis' },
  ];
  function lier(tableId, rec) {
    for (const r of INVERSES.filter(x => x.de === tableId)) {
      for (const cible of rec.fields[r.champ] || []) {
        const p = get(r.vers, cible);
        if (p && !(p.fields[r.inverse] || []).includes(rec.id)) p.fields[r.inverse] = [...(p.fields[r.inverse] || []), rec.id];
      }
    }
  }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const inconnu = (tableId, fields) => [...(champsInconnus.get(tableId) || [])].find(c => fields && c in fields);

  function airtable(u, opts) {
    const m = u.pathname.match(/^\/v0\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    if (!m || m[1] !== process.env.AIRTABLE_BASE_ID) return json(404, { error: { type: 'NOT_FOUND' } });
    const [, , tableId, id] = m;
    const t = table(tableId);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET' && id) { const r = t.get(id); return r ? json(200, r) : json(404, { error: { type: 'NOT_FOUND' } }); }
    if (method === 'GET') {
      const f = u.searchParams.get('filterByFormula') || '';
      let recs = [...t.values()];
      if (f) {
        const ids = [...f.matchAll(/RECORD_ID\(\)='(rec\w+)'/g)].map(x => x[1]);
        recs = ids.length ? recs.filter(r => ids.includes(r.id)) : [];
      }
      return json(200, { records: recs });
    }
    const body = JSON.parse(opts.body || '{}');
    const lot = Array.isArray(body.records) ? body.records.map(x => x.fields) : [body.fields];
    for (const f of lot) {
      const c = inconnu(tableId, f);
      if (c) return json(422, { error: { type: 'UNKNOWN_FIELD_NAME', message: `Unknown field name: "${c}"` } });
    }
    if (method === 'PATCH' && id) {
      const r = t.get(id);
      if (!r) return json(404, { error: { type: 'NOT_FOUND' } });
      Object.assign(r.fields, body.fields || {});
      lier(tableId, r);
      return json(200, r);
    }
    if (method === 'POST') {
      const creer = fields => { const rid = `recNEW${++seq}`; put(tableId, rid, fields || {}); const r = t.get(rid); lier(tableId, r); return r; };
      if (Array.isArray(body.records)) return json(200, { records: body.records.map(x => creer(x.fields)) });
      return json(200, creer(body.fields));
    }
    return json(405, { error: { type: 'METHOD' } });
  }

  // ── Pennylane simulé : on garde ce qu'il reçoit ───────────────────────────
  const pennylaneRecu = [];
  // Références externes déjà prises (document supprimé ou archivé) : le vrai
  // Pennylane les refuse — constaté et documenté dans server.js.
  const referencesPrises = new Set();
  function pennylane(u, opts) {
    if ((opts.method || 'GET').toUpperCase() === 'POST' && u.pathname === '/api/external/v2/quotes') {
      const body = JSON.parse(opts.body);
      if (referencesPrises.has(body.external_reference)) {
        return json(422, { message: 'External reference has already been taken' });
      }
      pennylaneRecu.push(body);
      return json(201, { id: 777000 + pennylaneRecu.length, quote_number: 0, status: 'draft' });
    }
    return json(404, { message: `route Pennylane non simulée : ${u.pathname}` });
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.airtable.com') return airtable(u, opts);
    if (u.hostname === 'app.pennylane.com') return pennylane(u, opts);
    if (u.hostname === '127.0.0.1') return realFetch(url, opts);
    throw new Error(`appel réseau inattendu : ${url}`);
  };

  // ── Session signée, comme celle que pose /api/login ───────────────────────
  function cookiePour(user) {
    const valeur = Buffer.from(JSON.stringify({ user })).toString('base64');
    const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`tanguy.sid=${valeur}`);
    return `tanguy.sid=${valeur}; tanguy.sid.sig=${sig}`;
  }

  let base, srv;
  return {
    T, table, put, get, lier, champsInconnus, pennylaneRecu, referencesPrises, cookiePour,
    async demarrer() {
      const app = require('../../server');
      srv = http.createServer(app);
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${srv.address().port}`;
    },
    arreter() { return new Promise(r => srv.close(r)); },
    /** Requête JSON authentifiée. */
    async appel(method, path, body, user = 'virginie') {
      const r = await realFetch(base + path, {
        method,
        headers: { cookie: cookiePour(user), 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const texte = await r.text();
      let j = null; try { j = JSON.parse(texte); } catch { /* corps non JSON */ }
      return { status: r.status, json: j };
    },
    /** Envoi multipart (FormData) authentifié. */
    async envoyer(path, formData, user = 'virginie') {
      const r = await realFetch(base + path, { method: 'POST', headers: { cookie: cookiePour(user) }, body: formData });
      const texte = await r.text();
      let j = null; try { j = JSON.parse(texte); } catch { /* corps non JSON */ }
      return { status: r.status, json: j };
    },
  };
};
