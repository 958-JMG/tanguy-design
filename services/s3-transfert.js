/**
 * services/s3-transfert.js
 *
 * Chantier fichiers volumineux (2026-07) — relais Scaleway Object Storage pour
 * les pièces jointes projet > 5 Mo (limite de l'API d'upload direct Airtable).
 *
 * Flux : PUT de l'objet dans le bucket `tanguy-transfert` → URL présignée GET
 * (15 min) → Airtable ingère lui-même le fichier depuis cette URL (PATCH champ
 * attachment avec {url, filename}) → l'objet S3 est supprimé (best effort).
 *
 * Configuration (env) :
 *  - S3_TRANSFERT_BUCKET     : nom du bucket (ex. tanguy-transfert) — REQUIS
 *  - AWS_ACCESS_KEY_ID       : access key Scaleway (application IAM tanguy-s3) — REQUIS
 *  - AWS_SECRET_ACCESS_KEY   : secret key Scaleway — REQUIS
 *  - S3_TRANSFERT_ENDPOINT   : endpoint S3 (défaut https://s3.fr-par.scw.cloud)
 *  - S3_TRANSFERT_REGION     : région (défaut fr-par)
 *
 * Si la config est absente, isConfigured() renvoie false et le serveur répond
 * un 413 JSON clair (pas de 500 muet) — le chemin ≤ 5 Mo reste 100 % inchangé.
 *
 * Le client @aws-sdk/client-s3 est chargé en lazy (require au premier upload)
 * pour ne rien coûter au boot ni au chemin direct Airtable.
 *
 * L'URL présignée est générée à la main (SigV4 query, ~30 lignes, validée par
 * le vecteur de test officiel AWS dans s3-transfert.test.js) pour éviter la
 * dépendance supplémentaire @aws-sdk/s3-request-presigner.
 */

const crypto = require('crypto');
const logger = require('./logger');

const DEFAULT_ENDPOINT = 'https://s3.fr-par.scw.cloud';
const DEFAULT_REGION = 'fr-par';
const PRESIGN_EXPIRES_S = 15 * 60; // 15 min — Airtable ingère en quelques secondes

function getConfig() {
  return {
    bucket: process.env.S3_TRANSFERT_BUCKET || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    endpoint: process.env.S3_TRANSFERT_ENDPOINT || DEFAULT_ENDPOINT,
    region: process.env.S3_TRANSFERT_REGION || DEFAULT_REGION,
  };
}

function isConfigured() {
  const c = getConfig();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey);
}

// Client S3 lazy — créé au premier upload seulement.
let s3Client = null;
function getClient() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  const c = getConfig();
  s3Client = new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    forcePathStyle: true, // https://s3.fr-par.scw.cloud/<bucket>/<key> — marche aussi en local (mock)
  });
  return s3Client;
}

// --- SigV4 presign (query string), path-style GET -------------------------------

// RFC 3986 : encode tout sauf A-Za-z0-9 - _ . ~ (et on préserve les '/' du path).
function rfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}
function encodePath(path) {
  return path.split('/').map(rfc3986).join('/');
}

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
function sha256hex(data) { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

/**
 * Construit une URL présignée GET SigV4 (query auth, UNSIGNED-PAYLOAD).
 * Bas niveau, paramétrable pour les tests (vecteur officiel AWS).
 */
function presignGetRaw({ host, canonicalUri, accessKeyId, secretAccessKey, region, expiresS, now, protocol = 'https' }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // YYYYMMDD'T'HHMMSS'Z'
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresS)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = params
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .sort()
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  let key = hmac('AWS4' + secretAccessKey, dateStamp);
  key = hmac(key, region);
  key = hmac(key, 's3');
  key = hmac(key, 'aws4_request');
  const signature = hmac(key, stringToSign).toString('hex');

  return `${protocol}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** URL présignée GET (15 min) pour un objet du bucket transfert, path-style. */
function presignGetUrl(key, expiresS = PRESIGN_EXPIRES_S, now = new Date()) {
  const c = getConfig();
  const u = new URL(c.endpoint);
  return presignGetRaw({
    host: u.host,
    canonicalUri: encodePath(`/${c.bucket}/${key}`),
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    region: c.region,
    expiresS,
    now,
    protocol: u.protocol.replace(':', ''),
  });
}

// --- API haut niveau -------------------------------------------------------------

// Clé S3 : préfixe horodaté + aléa (pas de collision), nom de fichier assaini
// (le nom original part de son côté à Airtable via `filename`).
function makeKey(filename) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const rand = crypto.randomBytes(4).toString('hex');
  let safe = String(filename || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // accents → ASCII
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(-120);
  if (!/[A-Za-z0-9]/.test(safe)) safe = 'fichier';
  return `attachments/${stamp}-${rand}/${safe}`;
}

/**
 * Upload le buffer dans le bucket transfert et retourne { key, url } où url est
 * une URL présignée GET valable 15 min (à donner à Airtable pour ingestion).
 */
async function uploadToTransfert(buffer, filename, contentType = 'application/octet-stream') {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const c = getConfig();
  const key = makeKey(filename);
  await getClient().send(new PutObjectCommand({
    Bucket: c.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return { key, url: presignGetUrl(key) };
}

/** Supprime l'objet du bucket transfert (best effort — le caller log l'échec). */
async function deleteFromTransfert(key) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const c = getConfig();
  await getClient().send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key }));
  logger.info({ key, bucket: c.bucket }, '[s3-transfert] objet supprimé');
}

// Pour les tests : reset du client (les env changent entre tests).
function _resetClient() { s3Client = null; }

module.exports = {
  isConfigured,
  uploadToTransfert,
  deleteFromTransfert,
  presignGetUrl,
  presignGetRaw,
  makeKey,
  PRESIGN_EXPIRES_S,
  _resetClient,
};
