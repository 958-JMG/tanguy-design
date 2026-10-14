// Retours Virginie du 14/10/2026, rejoués sur le VRAI serveur : vraies routes,
// vraie liste blanche, vraie session signée (cookie-session). Seuls Airtable et
// Pennylane sont simulés en mémoire — on voit ce qu'ils REÇOIVENT. Aucun appel
// réseau réel : tout hôte inattendu fait échouer le test.
//
//   1. « L'éco-participation, je la calcule mais quand j'enregistre je ne la vois
//      pas » → la liste blanche du devis jetait le champ sans bruit (200 « OK »).
//   2. « L'éco-participation n'apparaît pas dans Pennylane, même regénéré » → le
//      montant n'était jamais en base, donc jamais porté sur une ligne.
//   3. « La commande reste vide même si je supprime l'ancienne » → devis 650/1/1 :
//      3 lignes « Divers » jamais commandées, aucun moyen de refaire la commande.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Keygrip = require('keygrip');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.AIRTABLE_BASE_ID = 'appTEST1410';
process.env.AIRTABLE_KEY = 'patTEST';
process.env.PENNYLANE_API_KEY = 'plTEST';
process.env.ADMIN_LOGINS = 'virginie';
process.env.SESSION_SECRET = 'secret-de-test-retours-virginie-14-10-2026';
delete process.env.PENNYLANE_ECO_PRODUCT_ID;

const T = {
  devis: 'tblWklGEKMiBStXCs', lignes: 'tblCxDvzQAqBzpCx2', commandes: 'tblDynhnhLXb4Ibs2',
  projets: 'tbl9y74Gakhfwt6i1', clients: 'tbl2zmxpWWzbY1wT0', fournisseurs: 'tblz1AZIKkn9VCbkR',
  zones: 'tbl6FmEIIR15NMsgZ',
};

// ── Airtable simulé ─────────────────────────────────────────────────────────
const db = {};
let seq = 0;
const table = id => (db[id] ||= new Map());
function put(tableId, id, fields) {
  table(tableId).set(id, { id, createdTime: '2026-10-14T07:00:00.000Z', fields: JSON.parse(JSON.stringify(fields)) });
}
const get = (tableId, id) => table(tableId).get(id);
// Liens inverses tenus par Airtable lui-même : un BC lié à un projet apparaît dans
// « Commandes » du projet.
function lier(tableId, rec) {
  if (tableId !== T.commandes) return;
  for (const pid of rec.fields.Projet || []) {
    const p = get(T.projets, pid);
    if (p && !(p.fields.Commandes || []).includes(rec.id)) p.fields.Commandes = [...(p.fields.Commandes || []), rec.id];
  }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

// ── Pennylane simulé : on garde ce qu'il reçoit ─────────────────────────────
const pennylaneRecu = [];
function pennylane(u, opts) {
  if ((opts.method || 'GET').toUpperCase() === 'POST' && u.pathname === '/api/external/v2/quotes') {
    pennylaneRecu.push(JSON.parse(opts.body));
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

// ── Session signée, comme celle que pose /api/login ─────────────────────────
function cookiePour(user) {
  const valeur = Buffer.from(JSON.stringify({ user })).toString('base64');
  const sig = new Keygrip([process.env.SESSION_SECRET]).sign(`tanguy.sid=${valeur}`);
  return `tanguy.sid=${valeur}; tanguy.sid.sig=${sig}`;
}

let base, srv;
async function appel(method, path, body, user = 'virginie') {
  const r = await realFetch(base + path, {
    method,
    headers: { cookie: cookiePour(user), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// ── Données : la forme RÉELLE du devis 650/1/1 (montants, TVA, catégories) ──
function semer() {
  put(T.clients, 'recCLI', { Nom: 'CLIENT TEST', 'Pennylane customer ID': '555', Adresse: '1 rue du Test\n56000 VANNES' });
  put(T.fournisseurs, 'recFOU', { Nom: 'LAGO', 'Catégories': ['Mobilier'] });
  put(T.projets, 'recPRJ', { 'Référence': 'Meuble LAGO', Client: ['recCLI'], Commandes: [] });
  put(T.devis, 'recDEV', {
    'Numéro devis': '650/1/1', 'Type devis': 'Principal', Statut: 'Signé', Projet: ['recPRJ'], Client: ['recCLI'],
    'Lignes devis': ['recL1', 'recL2', 'recL3'],
    'Total HT articles': 801, 'Total HT après remise': 801, 'Livraison HT': 80, 'Livraison TVA taux': 20,
    'Pose HT': 200, 'Pose TVA taux': 20, 'Total HT final': 1081,
    'TVA taux 1 pourcentage': 20, 'TVA taux 1 base': 1081, 'TVA taux 1 montant': 216.2, 'Total TTC': 1297.2,
  });
  put(T.lignes, 'recL1', { Position: '1', 'Catégorie': 'Divers', 'Désignation': 'LAGO - Mécanisme d\'ouverture pousser-tirer', 'Montant HT': 45, Quantité: 1, 'TVA pourcentage': 20, Devis: ['recDEV'] });
  put(T.lignes, 'recL2', { Position: '2', 'Catégorie': 'Divers', 'Code produit': 'TEB207R', 'Désignation': 'LAGO - TEB207R CAISSON 36E8 PORTE ABATTANTE 736 x 184 x 270', 'Montant HT': 733, Quantité: 1, 'TVA pourcentage': 20, Devis: ['recDEV'] });
  put(T.lignes, 'recL3', { Position: '3', 'Catégorie': 'Divers', 'Code produit': 'TER7103', 'Désignation': 'LAGO - Barre de suspension entière pour placoplâtre', 'Montant HT': 23, Quantité: 1, 'TVA pourcentage': 20, Devis: ['recDEV'] });
  // Seul BC de la signature du 26/09 : « Plan de travail », vide par conception.
  put(T.commandes, 'recPT', {
    'Numéro': 'CLIENT TEST · PLAN DE TRAVAIL & CRÉDENCE · 650/1/1-1', Statut: 'Créée', 'Lignes BC': '[]', Projet: ['recPRJ'],
    Notes: '[Auto-généré depuis devis 650/1/1 signé le 26/09/2026]\n\nBC à compléter APRÈS prise de mesures sur chantier',
  });
  lier(T.commandes, get(T.commandes, 'recPT'));

  // Devis neuf à signer : garde-fou du déplacement de la fabrication des BC.
  put(T.projets, 'recPRJ2', { 'Référence': 'Cuisine', Client: ['recCLI'], 'Date pose prévue': '2027-03-01', Commandes: [] });
  put(T.zones, 'recZ1', { 'Nom zone': 'Cuisine', Ordre: 1, Marque: 'NOVA', 'Modèle': 'CUC', 'Coloris façade': 'Blanc' });
  put(T.devis, 'recDEV2', { 'Numéro devis': 'T-100', Statut: 'Brouillon', Projet: ['recPRJ2'], 'Lignes devis': ['recM1', 'recD1', 'recE1'], 'Zones devis': ['recZ1'] });
  put(T.lignes, 'recM1', { Position: '1', 'Catégorie': 'Meubles', 'Code produit': 'M1', 'Désignation': 'Caisson bas 60', 'Montant HT': 500, Quantité: 1 });
  put(T.lignes, 'recD1', { Position: '2', 'Catégorie': 'Divers', 'Code produit': 'D1', 'Désignation': 'Flexible', 'Montant HT': 40, Quantité: 1 });
  put(T.lignes, 'recE1', { Position: '3', 'Catégorie': 'Électroménager', 'Code produit': 'E1', 'Désignation': 'Four', 'Montant HT': 900, Quantité: 1 });
}

before(async () => {
  semer();
  const app = require('../server');
  srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => new Promise(r => srv.close(r)));

// ── 1 et 2 : éco-participation ──────────────────────────────────────────────
test('éco : « Enregistrer » écrit VRAIMENT le montant en base', async () => {
  const r = await appel('PATCH', '/api/data/devis/recDEV', { fields: { 'Éco-participation': 2.38 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.record.fields['Éco-participation'], 2.38, 'la réponse relit la valeur gardée');
  assert.equal(get(T.devis, 'recDEV').fields['Éco-participation'], 2.38, 'la base porte le montant');
  assert.equal(r.json.ignores, undefined);
});

test('éco : le brouillon Pennylane reçoit une ligne « Éco-participation » hors CA, total client inchangé', async () => {
  const r = await appel('POST', '/api/devis/recDEV/pennylane', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.eco, { ttc: 2.38, ht: 1.98 }, 'la réponse dit ce qui est parti');
  const q = pennylaneRecu.at(-1);
  assert.ok(q, 'Pennylane a reçu un devis');
  const eco = q.invoice_lines.filter(l => l.label === 'Éco-participation');
  assert.equal(eco.length, 1, 'une ligne éco, une seule');
  assert.equal(eco[0].raw_currency_unit_price, '1.98');
  assert.equal(eco[0].product_id, 109588803584, 'produit Pennylane « Éco-participation » (compte 70811, hors CA)');
  const totalHt = q.invoice_lines.reduce((t, l) => t + Number(l.raw_currency_unit_price) * (Number(l.quantity) || 1), 0);
  assert.equal(Math.round(totalHt * 100) / 100, 1081, 'éco sortie du prix produit, pas ajoutée par-dessus');
  assert.ok(q.invoice_lines.some(l => /dont éco-participation : 2\.38 € TTC/.test(l.description || '')), 'mention « dont » sur la ligne produit');
});

test('liste blanche : un champ refusé se DIT (422), rien n\'est écrit', async () => {
  const r = await appel('PATCH', '/api/data/devis/recDEV', { fields: { 'Total TTC': 1 } });
  assert.equal(r.status, 422);
  assert.match(r.json.error, /Total TTC/);
  assert.equal(get(T.devis, 'recDEV').fields['Total TTC'], 1297.2);
});

test('liste blanche : écriture partielle → le reste passe, le refusé revient dans « ignores »', async () => {
  const r = await appel('PATCH', '/api/data/devis/recDEV', { fields: { Notes: 'vu', 'Total TTC': 1 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.ignores, ['Total TTC']);
  assert.equal(get(T.devis, 'recDEV').fields.Notes, 'vu');
  assert.equal(get(T.devis, 'recDEV').fields['Total TTC'], 1297.2);
});

// ── 3 : la commande du devis 650/1/1 ────────────────────────────────────────
test('commande : la fiche du devis signé montre les 3 lignes qu\'aucun BC ne porte', async () => {
  const r = await appel('GET', '/api/devis/recDEV/lignes-sans-commande');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.commandes, 1, 'le BC « Plan de travail » vide est bien vu comme un BC du devis');
  assert.deepEqual(r.json.lignes.map(l => l.id), ['recL1', 'recL2', 'recL3']);
  assert.ok(r.json.lignes.every(l => l.famille === 'Divers'));
  assert.ok(r.json.categories.includes('Mobilier'));
});

test('commande : un non-admin ne crée pas de BC (aligné sur l\'ACL commandes)', async () => {
  const r = await appel('POST', '/api/devis/recDEV/commande-lignes', { ligneIds: ['recL1'], categorie: 'Mobilier' }, 'solene');
  assert.equal(r.status, 403);
});

test('commande : « Créer la commande » fait un BC Mobilier avec les 3 lignes, au fournisseur de la grille', async () => {
  const r = await appel('POST', '/api/devis/recDEV/commande-lignes', { ligneIds: ['recL1', 'recL2', 'recL3'], categorie: 'Mobilier' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.commande.numero, 'CLIENT TEST · MOBILIER · 650/1/1-2', 'numéro suivant celui du BC existant');
  assert.equal(r.json.commande.fournisseur, 'LAGO');
  const bc = get(T.commandes, r.json.commande.id);
  assert.deepEqual(JSON.parse(bc.fields['Lignes BC']).map(l => l.code), ['', 'TEB207R', 'TER7103']);
  assert.deepEqual(bc.fields.Fournisseur, ['recFOU']);
  assert.deepEqual(bc.fields.Projet, ['recPRJ']);
  assert.equal(bc.fields['Montant HT'], 801);
  assert.equal(bc.fields.Statut, 'Créée');
  assert.match(bc.fields.Notes, /Auto-généré depuis devis 650\/1\/1/, 'retrouvable par le nettoyage des artefacts du devis');
  assert.doesNotMatch(bc.fields.Notes, /733/, 'BC fournisseur sans montants');
});

test('commande : ensuite plus aucune ligne orpheline, et pas de doublon possible', async () => {
  const r = await appel('GET', '/api/devis/recDEV/lignes-sans-commande');
  assert.deepEqual(r.json.lignes, []);
  assert.equal(r.json.commandes, 2);
  const again = await appel('POST', '/api/devis/recDEV/commande-lignes', { ligneIds: ['recL2'], categorie: 'Mobilier' });
  assert.equal(again.status, 409, 'une ligne déjà dans un BC est refusée');
});

test('commande : devis non signé → refus clair (ses BC naissent à la signature)', async () => {
  const r = await appel('POST', '/api/devis/recDEV2/commande-lignes', { ligneIds: ['recM1'], categorie: 'Mobilier' });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /signature/);
});

// ── Signature : la fabrication des BC a déménagé dans services/commande-bc.js ─
test('signature : mêmes BC qu\'avant (Mobilier + Électroménager + Plan de travail vide), le Divers est dit', async () => {
  const r = await appel('POST', '/api/devis/recDEV2/sign', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.commandes_creees, 3);
  assert.deepEqual(r.json.sans_commande, [{ type: 'Divers', montant: 40, lignes: 1 }]);
  const bcs = (get(T.projets, 'recPRJ2').fields.Commandes || []).map(id => get(T.commandes, id).fields);
  const parRef = Object.fromEntries(bcs.map(f => [f['Référence courte'], f]));
  assert.deepEqual(Object.keys(parRef).sort(), ['ELECTRO', 'MOBILIER', 'PLAN_CRED']);
  assert.equal(parRef.PLAN_CRED['Numéro'], 'CLIENT TEST · PLAN DE TRAVAIL & CRÉDENCE · T-100-1');
  assert.equal(parRef.PLAN_CRED['Lignes BC'], '[]');
  assert.deepEqual(JSON.parse(parRef.MOBILIER['Lignes BC']).map(l => l.code), ['M1']);
  assert.equal(parRef.MOBILIER['Modèle choisi'], 'NOVA — CUC');
  assert.equal(parRef.MOBILIER['Détails modèle'], 'Coloris façade : Blanc');
  assert.deepEqual(parRef.MOBILIER.Fournisseur, ['recFOU']);
  assert.equal(parRef.MOBILIER['Date envoi'], '2026-11-16', 'rétro-planning pose − 105 j');
  assert.equal(parRef.ELECTRO['Montant HT'], 900);
  assert.equal(parRef.ELECTRO['Modèle choisi'], undefined);

  const orphelines = await appel('GET', '/api/devis/recDEV2/lignes-sans-commande');
  assert.deepEqual(orphelines.json.lignes.map(l => l.code), ['D1'], 'seul le Divers reste à commander, et la fiche le montre');
});
