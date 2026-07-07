// Tests services/s3-transfert.js — presign SigV4 + config + clés S3.
// Lancés par `npm test` (node --test services/*.test.js).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const ENV_KEYS = ['S3_TRANSFERT_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_TRANSFERT_ENDPOINT', 'S3_TRANSFERT_REGION'];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const { isConfigured, presignGetRaw, presignGetUrl, makeKey } = require('./s3-transfert');

// ── Vecteur de test OFFICIEL AWS ────────────────────────────────────────────────
// Docs S3 « Authenticating Requests: Using Query Parameters (AWS Signature V4) » :
// GET examplebucket/test.txt, us-east-1, 24 h, creds d'exemple AWS, 2013-05-24.
// Signature attendue publiée par AWS. Valide l'algorithme SigV4 complet
// (canonical request UNSIGNED-PAYLOAD + string-to-sign + dérivation de clé).
test('presignGetRaw reproduit le vecteur officiel AWS SigV4', () => {
  const url = presignGetRaw({
    host: 'examplebucket.s3.amazonaws.com',
    canonicalUri: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    expiresS: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.match(url, /X-Amz-Date=20130524T000000Z/);
  assert.match(url, /X-Amz-Expires=86400/);
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});

test('presignGetUrl construit une URL path-style Scaleway avec défauts fr-par', () => {
  process.env.S3_TRANSFERT_BUCKET = 'tanguy-transfert';
  process.env.AWS_ACCESS_KEY_ID = 'SCWTESTKEY123';
  process.env.AWS_SECRET_ACCESS_KEY = 'testsecret';
  const url = presignGetUrl('attachments/x/plan.pdf', 900, new Date('2026-07-07T12:00:00Z'));
  assert.ok(url.startsWith('https://s3.fr-par.scw.cloud/tanguy-transfert/attachments/x/plan.pdf?'));
  assert.match(url, /X-Amz-Expires=900/);
  assert.match(url, /fr-par%2Fs3%2Faws4_request/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}$/);
});

test('presignGetUrl encode les caractères spéciaux du path (RFC 3986)', () => {
  process.env.S3_TRANSFERT_BUCKET = 'tanguy-transfert';
  process.env.AWS_ACCESS_KEY_ID = 'k';
  process.env.AWS_SECRET_ACCESS_KEY = 's';
  const url = presignGetUrl("attachments/x/plan (1) d'été.pdf", 900, new Date('2026-07-07T12:00:00Z'));
  const path = new URL(url).pathname;
  // encodeURI* : espace → %20, parenthèses → %28/%29, apostrophe → %27
  assert.ok(path.includes('plan%20%281%29%20d%27%C3%A9t%C3%A9.pdf'), path);
});

test('isConfigured : false sans env, true avec les 3 requis', () => {
  assert.strictEqual(isConfigured(), false);
  process.env.S3_TRANSFERT_BUCKET = 'tanguy-transfert';
  assert.strictEqual(isConfigured(), false);
  process.env.AWS_ACCESS_KEY_ID = 'SCWXXX';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  assert.strictEqual(isConfigured(), true);
});

test('makeKey : préfixe attachments/, horodaté, nom assaini sans collision', () => {
  const k1 = makeKey('Plan cuisine étage (v2) final.pdf');
  const k2 = makeKey('Plan cuisine étage (v2) final.pdf');
  assert.match(k1, /^attachments\/\d{8}-\d{6}-[0-9a-f]{8}\/Plan_cuisine_etage_v2_final\.pdf$/);
  assert.notStrictEqual(k1, k2, 'aléa anti-collision');
  assert.match(makeKey(''), /\/fichier$/);
  assert.match(makeKey('///'), /\/fichier$/);
});
