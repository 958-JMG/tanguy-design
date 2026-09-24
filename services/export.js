// Brique Export / Réversibilité 9·58 — version Airtable + S3 (Tanguy).
//
// Un cockpit, ses données. On produit un ZIP autonome :
//   donnees/json/<table>.json   une table Airtable = un fichier
//   donnees/csv/<table>.csv     les mêmes données, ouvrables dans un tableur
//   donnees/tout.json           l'ensemble en un seul fichier
//   LISEZ-MOI.txt · reversibilite.html   le kit de réversibilité
//
// Le code source N'EST PAS dans le ZIP (remis en cas de sortie). Les champs de
// secrets (Hash bcrypt, TOTP secret, jetons) sont retirés. Le ZIP est déposé
// dans le bucket S3 et remis par un lien signé (token) valable 24 h ; un sidecar
// JSON tient la trace (créé / téléchargé / révoqué) — l'équivalent d'une ligne
// de base pour un cockpit sans Postgres. Aucune dépendance externe (zlib).
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const s3 = require('./s3-transfert');
const logger = require('./logger');

const TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'exports/';

// --- CRC32 + ZIP (deflate, repli sur stocké) ------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const yr = Math.max(0, d.getFullYear() - 1980);
  const date = ((yr & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}
function buildZip(entries, when = new Date()) {
  const { time, date } = dosDateTime(when);
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(raw);
    let method = 8, comp = zlib.deflateRawSync(raw, { level: 9 });
    if (comp.length >= raw.length) { method = 0; comp = raw; }
    const flags = 0x0800;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(flags, 6); lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(time, 10); lfh.writeUInt16LE(date, 12); lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26); lfh.writeUInt16LE(0, 28);
    parts.push(lfh, nameBuf, comp);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(flags, 8);
    cdh.writeUInt16LE(method, 10); cdh.writeUInt16LE(time, 12); cdh.writeUInt16LE(date, 14); cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20); cdh.writeUInt32LE(raw.length, 24); cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34); cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

// --- Redaction + CSV ------------------------------------------------------
const SECRET = /(pass|mdp|secret|token|hash)/i;
function redactFields(fields) {
  const o = {};
  for (const k of Object.keys(fields)) {
    o[k] = SECRET.test(k) && fields[k] ? '[secret retiré de l’export]' : fields[k];
  }
  return o;
}
function csvCell(v) {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set())];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
function slug(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return s || 'table';
}

// --- Collecte Airtable (fetch injectable pour les tests) ------------------
function atCfg(opts = {}) {
  return {
    key: opts.key || process.env.AIRTABLE_KEY || '',
    baseId: opts.baseId || process.env.AIRTABLE_BASE_ID || '',
    fetchImpl: opts.fetchImpl || fetch,
    sleep: opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms))),
  };
}
async function listTables(opts) {
  const { key, baseId, fetchImpl } = atCfg(opts);
  const r = await fetchImpl(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: { Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('Airtable meta HTTP ' + r.status);
  const j = await r.json();
  return (j.tables || []).map(t => ({ id: t.id, name: t.name }));
}
async function dumpTable(opts, tableId) {
  const { key, baseId, fetchImpl, sleep } = atCfg(opts);
  const rows = []; let offset = null, guard = 0;
  do {
    const qs = new URLSearchParams(); qs.set('pageSize', '100'); if (offset) qs.set('offset', offset);
    const r = await fetchImpl(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}?${qs}`, { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) throw new Error('Airtable HTTP ' + r.status + ' (' + tableId + ')');
    const j = await r.json();
    for (const rec of (j.records || [])) rows.push({ id: rec.id, createdTime: rec.createdTime, ...redactFields(rec.fields || {}) });
    offset = j.offset || null;
    if (offset) await sleep(220); // sous la limite Airtable (5 req/s)
  } while (offset && ++guard < 500);
  return rows;
}
async function collect(opts) {
  const tables = await listTables(opts);
  const seen = new Set();
  const out = [];
  for (const t of tables) {
    let sl = slug(t.name); if (seen.has(sl)) sl = sl + '-' + t.id; seen.add(sl);
    out.push({ table: t.name, slug: sl, rows: await dumpTable(opts, t.id) });
  }
  return out;
}

// --- Documents du kit -----------------------------------------------------
function buildReadme({ cabinet, when, tables, totalRows }) {
  const liste = tables.map(t => `  - ${t.table} : ${t.lignes} ligne(s)`).join('\n');
  return `EXPORT DE VOS DONNÉES — ${cabinet}
Généré le ${when.toLocaleString('fr-FR')}

Ce dossier contient l'intégralité des données de votre cockpit, à vous.
Vous pouvez le conserver, le relire et le ré-importer sans aucun outil de 9·58.

CE QUE VOUS TROUVEZ ICI
  donnees/json/  une table = un fichier .json (le format le plus fidèle)
  donnees/csv/   les mêmes données en .csv (ouvrables dans Excel ou LibreOffice)
  donnees/tout.json  l'ensemble des données réuni dans un seul fichier
  reversibilite.html votre document de réversibilité (vos droits, la sortie)

TABLES EXPORTÉES (${totalRows} ligne(s) au total)
${liste}

CE QUI N'EST PAS DANS CE FICHIER, ET POURQUOI
  - Les secrets (mots de passe, codes de sécurité) sont retirés : un export ne
    doit jamais faire fuiter un secret. Vos comptes restent protégés.
  - Les pièces jointes sont référencées (nom + lien) dans les données ; les
    fichiers eux-mêmes restent dans votre coffre de dépôt.
  - Le code source du cockpit n'est pas ici. Il vous est remis en cas de sortie,
    selon la procédure décrite dans reversibilite.html. Vous n'êtes pas enfermé.
`;
}
function buildReversibilite({ cabinet, when, tables, totalRows }) {
  const d = when.toLocaleDateString('fr-FR');
  const rows = tables.map(t => `<tr><td>${t.table}</td><td style="text-align:right">${t.lignes}</td></tr>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Réversibilité — ${cabinet}</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b;max-width:760px;margin:40px auto;padding:0 20px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:28px 0 8px}.muet{color:#777}
table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ddd;padding:6px 10px;font-size:.95rem}
.cadre{border:1px solid #ddd;border-radius:10px;padding:16px 20px;margin:16px 0;background:#faf9f7}@media print{body{margin:0}}</style></head><body>
<h1>Votre réversibilité</h1><p class="muet">${cabinet} — document établi le ${d}</p>
<div class="cadre"><b>Le principe.</b> Vos données vous appartiennent. Vous pouvez les récupérer à tout moment,
dans un format ouvert, sans dépendre d'un outil de 9·58. Le présent export en est la preuve concrète.</div>
<h2>Ce que vous venez d'exporter</h2>
<p>${totalRows} enregistrement(s) répartis sur ${tables.length} table(s), au format JSON et CSV.</p>
<table><thead><tr><th>Table</th><th style="text-align:right">Lignes</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Le code source, en cas de sortie</h2>
<p>Le code qui fait tourner votre cockpit reste maintenu par 9·58 tant que vous êtes accompagné. En cas d'arrêt
de la collaboration, 9·58 vous remet le code source de votre cockpit et un guide de reprise, pour que vous puissiez
le faire héberger par le prestataire de votre choix. Il ne vous est pas livré en téléchargement permanent, afin de
garantir que la version qui tourne reste celle que 9·58 maintient et sécurise.</p></body></html>
`;
}

// --- Assemblage du ZIP ----------------------------------------------------
function assembleZip(data, { cabinet = 'Tanguy Design', when = new Date() } = {}) {
  const entries = [];
  const combined = {};
  let totalRows = 0;
  for (const { table, slug: sl, rows } of data) {
    combined[table] = rows;
    totalRows += rows.length;
    entries.push({ name: `donnees/json/${sl}.json`, data: JSON.stringify(rows, null, 2) });
    entries.push({ name: `donnees/csv/${sl}.csv`, data: toCsv(rows) });
  }
  entries.push({ name: 'donnees/tout.json', data: JSON.stringify({ cabinet, export_le: when.toISOString(), tables: combined }, null, 2) });
  const meta = { cabinet, when, tables: data.map(d => ({ table: d.table, lignes: d.rows.length })), totalRows };
  entries.push({ name: 'LISEZ-MOI.txt', data: buildReadme(meta) });
  entries.push({ name: 'reversibilite.html', data: buildReversibilite(meta) });
  const buffer = buildZip(entries, when);
  return { buffer, stats: { tables: data.length, lignes: totalRows, taille: buffer.length } };
}

// --- Stockage S3 (le sidecar JSON = la ligne de trace) --------------------
const zipKey = (t) => `${PREFIX}${t}.zip`;
const metaKey = (t) => `${PREFIX}${t}.json`;
const estExpire = (m) => !m || m.revoque || new Date(m.expire_le).getTime() < Date.now();

async function purgeExpires() {
  const keys = await s3.listKeys(PREFIX);
  for (const k of keys.filter(k => k.endsWith('.json'))) {
    const raw = await s3.getObject(k);
    if (!raw) continue;
    let m; try { m = JSON.parse(raw.toString()); } catch { continue; }
    if (new Date(m.expire_le).getTime() < Date.now()) {
      try { await s3.deleteFromTransfert(zipKey(m.token)); } catch { /* déjà purgé */ }
    }
  }
}

/** Construit le ZIP, le dépose en S3, renvoie { token, stats, expire_le }. */
async function createExport({ cabinet = 'Tanguy Design' } = {}) {
  const when = new Date();
  const data = await collect();
  const { buffer, stats } = assembleZip(data, { cabinet, when });
  const token = crypto.randomBytes(24).toString('hex');
  const expire_le = new Date(when.getTime() + TTL_MS).toISOString();
  await s3.putObject(zipKey(token), buffer, 'application/zip');
  const meta = { token, cree_le: when.toISOString(), expire_le, nb_tables: stats.tables, nb_lignes: stats.lignes, taille: stats.taille, telecharge_le: null, revoque: false };
  await s3.putObject(metaKey(token), Buffer.from(JSON.stringify(meta)), 'application/json');
  purgeExpires().catch(e => logger.warn({ err: e.message }, '[export] purge KO'));
  return { token, stats, expire_le };
}

async function listExports() {
  const keys = await s3.listKeys(PREFIX);
  const metas = [];
  for (const k of keys.filter(k => k.endsWith('.json'))) {
    const raw = await s3.getObject(k);
    if (!raw) continue;
    try { const m = JSON.parse(raw.toString()); metas.push({ ...m, expire: estExpire(m) }); } catch { /* ignore */ }
  }
  return metas.sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
}

/** Renvoie { buffer, filename } ou { gone:true } / { missing:true }. */
async function getForDownload(token) {
  const raw = await s3.getObject(metaKey(token));
  if (!raw) return { missing: true };
  let m; try { m = JSON.parse(raw.toString()); } catch { return { missing: true }; }
  if (estExpire(m)) return { gone: true };
  const buffer = await s3.getObject(zipKey(token));
  if (!buffer) return { gone: true };
  if (!m.telecharge_le) {
    m.telecharge_le = new Date().toISOString();
    await s3.putObject(metaKey(token), Buffer.from(JSON.stringify(m)), 'application/json');
  }
  return { buffer, filename: `export-tanguy-${String(m.cree_le).slice(0, 10)}.zip` };
}

async function revoke(token) {
  const raw = await s3.getObject(metaKey(token));
  if (raw) {
    let m; try { m = JSON.parse(raw.toString()); } catch { m = null; }
    if (m) { m.revoque = true; await s3.putObject(metaKey(token), Buffer.from(JSON.stringify(m)), 'application/json'); }
  }
  try { await s3.deleteFromTransfert(zipKey(token)); } catch { /* déjà parti */ }
  return { ok: true };
}

module.exports = {
  // pur (testable sans réseau)
  buildZip, toCsv, redactFields, slug, assembleZip,
  // collecte + stockage
  listTables, dumpTable, collect, createExport, listExports, getForDownload, revoke,
  TTL_MS, PREFIX,
};
