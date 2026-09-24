// Preuve de la brique Export / Réversibilité (Tanguy, Airtable + S3).
// Aucun réseau : S3 en mémoire (on remplace les helpers du module s3-transfert
// AVANT de charger export.js) et fetch Airtable stubé. On prouve : ZIP intègre
// (lecture par le répertoire central), collecte des tables, secrets retirés,
// stockage S3 + lien signé, expiration/révocation.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');

// --- S3 en mémoire (injecté sur le module partagé avant require d'export) ---
const s3 = require('./s3-transfert');
const STORE = new Map();
s3.putObject = async (k, body) => { STORE.set(k, Buffer.isBuffer(body) ? body : Buffer.from(body)); return { key: k }; };
s3.getObject = async (k) => (STORE.has(k) ? STORE.get(k) : null);
s3.listKeys = async (p) => [...STORE.keys()].filter(k => k.startsWith(p));
s3.deleteFromTransfert = async (k) => { STORE.delete(k); };

const ex = require('./export');

// --- Fetch Airtable stubé ---
function fakeFetch(url) {
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  if (url.includes('/meta/bases/')) return Promise.resolve(ok({ tables: [{ id: 'tblA', name: 'Clients' }, { id: 'tblU', name: 'Users cockpit' }] }));
  if (url.includes('/tblA')) return Promise.resolve(ok({ records: [{ id: 'rec1', createdTime: '2026-01-01', fields: { Nom: 'Durand, & Fils', Ville: 'Vannes' } }] }));
  if (url.includes('/tblU')) return Promise.resolve(ok({ records: [{ id: 'rec2', createdTime: '2026-01-02', fields: { Login: 'jm', 'Hash bcrypt': 'HASHVAL', 'TOTP secret': 'SECRETVAL' } }] }));
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}
process.env.AIRTABLE_KEY = 'k';
process.env.AIRTABLE_BASE_ID = 'b';
global.fetch = fakeFetch;

// --- Lecteur ZIP via l'EOCD + répertoire central ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function readZip(buf) {
  const eocd = buf.length - 22;
  assert.strictEqual(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD');
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  assert.strictEqual(cdOff + cdSize, eocd, 'offset répertoire central');
  const out = {}; let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, 'entrée centrale');
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const method = buf.readUInt16LE(lho + 8), crc = buf.readUInt32LE(lho + 14), csize = buf.readUInt32LE(lho + 18);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + csize)) : Buffer.from(buf.subarray(start, start + csize));
    assert.strictEqual(crc32(raw), crc, 'CRC ' + name);
    out[name] = raw; p += 46 + nlen + elen + clen;
  }
  return out;
}

test('ZIP intègre : round-trip store + deflate', () => {
  const gros = 'abc'.repeat(5000);
  const files = readZip(ex.buildZip([{ name: 'a.txt', data: gros }, { name: 'b.txt', data: 'x' }]));
  assert.strictEqual(files['a.txt'].toString(), gros);
  assert.strictEqual(files['b.txt'].toString(), 'x');
});

test('CSV : union des colonnes, échappement, vide', () => {
  assert.strictEqual(ex.toCsv([]), '');
  const csv = ex.toCsv([{ a: 'x,y' }, { b: 'li"gne' }]);
  assert.match(csv, /^a,b\r\n/);
  assert.match(csv, /"x,y"/);
  assert.match(csv, /"li""gne"/);
});

test('redactFields retire les champs sensibles', () => {
  const r = ex.redactFields({ Login: 'jm', 'Hash bcrypt': 'H', 'TOTP secret': 'S', Nom: 'ok' });
  assert.strictEqual(r.Login, 'jm');
  assert.strictEqual(r.Nom, 'ok');
  assert.match(r['Hash bcrypt'], /secret retiré/);
  assert.match(r['TOTP secret'], /secret retiré/);
});

test('collect + assembleZip : tables balayées, secrets retirés, kit inclus', async () => {
  const data = await ex.collect();
  assert.strictEqual(data.length, 2);
  const { buffer, stats } = ex.assembleZip(data, { cabinet: 'Tanguy Design' });
  assert.strictEqual(stats.tables, 2);
  assert.strictEqual(stats.lignes, 2);
  const files = readZip(buffer);
  assert.ok(files['LISEZ-MOI.txt'] && files['reversibilite.html'] && files['donnees/tout.json'], 'kit + tout.json');
  assert.ok(files['donnees/json/clients.json'], 'table Clients → slug clients');
  assert.match(files['donnees/csv/clients.csv'].toString(), /"Durand, & Fils"/, 'échappement CSV');
  const users = files['donnees/json/users-cockpit.json'].toString();
  assert.ok(!users.includes('HASHVAL') && !users.includes('SECRETVAL'), 'secrets retirés');
  assert.match(users, /secret retiré/);
});

test('createExport → listExports → download → revoke (S3 en mémoire)', async () => {
  const { token, stats, expire_le } = await ex.createExport({ cabinet: 'Tanguy Design' });
  assert.ok(token && stats.tables === 2 && new Date(expire_le) > new Date());
  assert.ok(STORE.has(`exports/${token}.zip`) && STORE.has(`exports/${token}.json`), 'zip + sidecar déposés');

  const liste = await ex.listExports();
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].expire, false);
  assert.strictEqual(liste[0].telecharge_le, null);

  const dl = await ex.getForDownload(token);
  assert.ok(dl.buffer && /export-tanguy-\d{4}-\d{2}-\d{2}\.zip/.test(dl.filename));
  const files = readZip(dl.buffer);
  assert.ok(files['donnees/json/clients.json'], 'ZIP téléchargé lisible');
  // le téléchargement est tracé
  const after = await ex.listExports();
  assert.ok(after[0].telecharge_le, 'telecharge_le posé');

  // révocation → plus téléchargeable (410 côté route)
  await ex.revoke(token);
  const gone = await ex.getForDownload(token);
  assert.strictEqual(gone.gone, true);
  assert.ok(!STORE.has(`exports/${token}.zip`), 'zip supprimé à la révocation');

  // lien inconnu
  const miss = await ex.getForDownload('inexistant');
  assert.strictEqual(miss.missing, true);
});
