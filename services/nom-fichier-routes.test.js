/**
 * Bout en bout : un nom de fichier accentué, envoyé comme par un navigateur,
 * traverse les routes de server.js. On regarde ce qu'Airtable REÇOIT, et ce que
 * le navigateur relit dans la réponse.
 *
 * Le vrai server.js est chargé (require('../server'), sans ouvrir son port) puis
 * écoute sur un port de test. Aucun service réel n'est joint : fetch est
 * intercepté (Airtable simulé, tout autre hôte refusé), et le relais S3 et les
 * parseurs Claude sont remplacés AVANT le chargement du serveur.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Keygrip = require('keygrip');

// Posé avant le chargement de server.js, qui lit l'environnement au démarrage.
// Aucune vraie clé, même si le shell en a sourcé.
const SECRET = 'secret-de-test-nom-fichier-0123456789abcdef';
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AIRTABLE_BASE_ID: 'appTEST',
  AIRTABLE_KEY: 'patTEST',
  SESSION_SECRET: SECRET,
  ADMIN_LOGINS: 'virginie',
  ANTHROPIC_API_KEY: 'sk-test-jamais-appele',
});

// ── Relais S3 et parseurs Claude simulés ────────────────────────────────────
const s3 = require('./s3-transfert');
const s3Recus = [];
s3.isConfigured = () => true;
s3.uploadToTransfert = async (buffer, filename) => {
  s3Recus.push({ filename, octets: buffer.length });
  return { key: 'attachments/test/objet', url: 'https://s3.fr-par.scw.cloud/tanguy-transfert/attachments/test/objet?X-Amz-Signature=test' };
};
s3.deleteFromTransfert = async () => {};

require('./artisan-devis-parser').parseArtisanDevisPdf = async () => ({
  artisan: {}, metadata: { numero_devis: 'DA-TEST' }, totaux: { total_ht: 1000, total_ttc: 1200 },
});
require('./facture-fournisseur-parser').parseFactureFournisseurPdf = async () => ({
  fournisseur: {}, metadata: { numero_facture: 'FF-TEST' }, totaux: { total_ht: 100, total_tva: 20, total_ttc: 120 },
});

// ── Airtable simulé ─────────────────────────────────────────────────────────
const vraiFetch = globalThis.fetch;
const airtable = { uploads: [], patches: [], pieces: {} }; // pieces : champ → pièces jointes du projet
let compteur = 0;

function reponse(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return vraiFetch(url, options);
  const methode = (options.method || 'GET').toUpperCase();
  const corps = options.body ? JSON.parse(options.body) : null;

  if (u.hostname === 'content.airtable.com' && u.pathname.endsWith('/uploadAttachment')) {
    airtable.uploads.push(corps);
    return reponse({ id: u.pathname.split('/')[3], fields: {} });
  }
  if (u.hostname === 'api.airtable.com') {
    const [, , , , recordId] = u.pathname.split('/'); // /v0/appTEST/<table>/<record>
    if (methode === 'GET' && !recordId) return reponse({ records: [] });
    if (methode === 'GET') return reponse({ id: recordId, fields: { ...airtable.pieces } });
    if (methode === 'POST') return reponse({ id: `recCREE${++compteur}`, fields: corps.fields });
    if (methode === 'PATCH') {
      airtable.patches.push(corps);
      // Airtable ingère l'URL présignée et re-héberge la pièce sur son domaine.
      for (const [champ, pieces] of Object.entries(corps.fields)) {
        airtable.pieces[champ] = pieces.map((p) => (p.id ? p : {
          id: `att${++compteur}`, url: `https://v5.airtableusercontent.com/att${compteur}`, filename: p.filename,
        }));
      }
      return reponse({ id: recordId, fields: corps.fields });
    }
  }
  throw new Error(`réseau interdit dans ce test : ${methode} ${url}`);
};

const app = require('../server');

// Session de Virginie (admin), signée comme le fait cookie-session.
const valeur = Buffer.from(JSON.stringify({ user: 'virginie' })).toString('base64');
const COOKIE = `tanguy.sid=${valeur}; tanguy.sid.sig=${new Keygrip([SECRET]).sign(`tanguy.sid=${valeur}`)}`;

let serveur;
let base;
before(async () => {
  await new Promise((ok) => { serveur = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${serveur.address().port}`;
});
after(() => new Promise((ok) => serveur.close(ok)));

const PDF = Buffer.from('%PDF-1.4\n% banc nom de fichier\n');

// Envoi comme un navigateur : FormData écrit le nom en octets UTF-8 bruts.
async function envoyer(chemin, champFichier, nom, contenu, type, champs = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.append(k, v);
  fd.append(champFichier, new File([contenu], nom, { type }));
  const r = await vraiFetch(`${base}${chemin}`, { method: 'POST', body: fd, headers: { Cookie: COOKIE } });
  const texte = await r.text(); // withKeepAlive : espaces en tête, puis le JSON
  return { status: r.status, json: JSON.parse(texte) };
}

function dernierUpload() {
  return airtable.uploads[airtable.uploads.length - 1];
}

describe('Pièce jointe projet (POST /api/projets/:id/attachments)', () => {
  test('≤ 5 Mo : Airtable reçoit « devis-été Ça.pdf », la réponse aussi', async () => {
    const r = await envoyer('/api/projets/recPROJET/attachments', 'file', 'devis-été Ça.pdf', PDF,
      'application/pdf', { field: 'Documents projet' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(dernierUpload().filename, 'devis-été Ça.pdf');
    assert.equal(r.json.filename, 'devis-été Ça.pdf');
  });

  test('≤ 5 Mo : un nom ASCII passe inchangé', async () => {
    const r = await envoyer('/api/projets/recPROJET/attachments', 'file', 'IMG_1234.HEIC', Buffer.from('image'),
      'image/heic', { field: 'Documents projet' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(dernierUpload().filename, 'IMG_1234.HEIC');
    assert.equal(r.json.filename, 'IMG_1234.HEIC');
  });

  test('> 5 Mo (relais S3) : S3 et Airtable reçoivent « plan façade.dwg »', async () => {
    const gros = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const r = await envoyer('/api/projets/recPROJET/attachments', 'file', 'plan façade.dwg', gros,
      'application/acad', { field: 'Documents projet' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(s3Recus.at(-1).filename, 'plan façade.dwg');
    const ajout = airtable.patches.at(-1).fields['Documents projet'].at(-1);
    assert.equal(ajout.filename, 'plan façade.dwg');
    assert.equal(r.json.filename, 'plan façade.dwg');
    assert.equal(r.json.ingested, true, 'la pièce doit être retrouvée sous son vrai nom après ingestion');
  });
});

describe('Imports de PDF qui attachent le fichier d\'origine', () => {
  test('devis artisan (POST /api/artisan-devis/import) : Airtable reçoit le bon nom', async () => {
    const r = await envoyer('/api/artisan-devis/import', 'pdf', 'Devis Leroy – cuisine été.pdf', PDF, 'application/pdf');
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(dernierUpload().filename, 'Devis Leroy – cuisine été.pdf');
  });

  test('facture fournisseur (POST /api/factures-fournisseurs/import) : Airtable reçoit le bon nom', async () => {
    const r = await envoyer('/api/factures-fournisseurs/import', 'pdf', 'Facture Hêtre & Chêne n°42.pdf', PDF, 'application/pdf');
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(dernierUpload().filename, 'Facture Hêtre & Chêne n°42.pdf');
  });
});
