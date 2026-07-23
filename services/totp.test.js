/**
 * Tests services/totp.js — node --test natif.
 *
 * Usage : node --test services/totp.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { authenticator } = require('otplib');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-0123456789abcdef';
const totp = require('./totp');

describe('chiffrement du secret au repos', () => {
  test('roundtrip encrypt → decrypt rend le secret original', () => {
    const secret = totp.generateSecret();
    const enc = totp.encryptSecret(secret);
    assert.notEqual(enc, secret);                 // c'est bien chiffré
    assert.match(enc, /^v1:/);                     // format versionné
    assert.equal(totp.decryptSecret(enc), secret); // déchiffrable
  });

  test('deux chiffrements du même secret diffèrent (IV aléatoire)', () => {
    const secret = totp.generateSecret();
    assert.notEqual(totp.encryptSecret(secret), totp.encryptSecret(secret));
  });

  test('decrypt sur donnée invalide → null (pas d\'exception)', () => {
    assert.equal(totp.decryptSecret('nimporte quoi'), null);
    assert.equal(totp.decryptSecret(''), null);
    assert.equal(totp.decryptSecret(null), null);
    assert.equal(totp.decryptSecret('v1:aaa:bbb:ccc'), null); // tag/iv bidons
  });
});

describe('vérification du code TOTP', () => {
  test('un code généré par otplib pour ce secret est accepté', () => {
    const secret = totp.generateSecret();
    const code = authenticator.generate(secret);
    assert.equal(totp.verify(code, secret), true);
  });

  test('tolère les espaces dans le code', () => {
    const secret = totp.generateSecret();
    const code = authenticator.generate(secret);
    const spaced = code.slice(0, 3) + ' ' + code.slice(3);
    assert.equal(totp.verify(spaced, secret), true);
  });

  test('rejette un mauvais code', () => {
    const secret = totp.generateSecret();
    const bad = authenticator.generate(secret) === '000000' ? '111111' : '000000';
    assert.equal(totp.verify(bad, secret), false);
  });

  test('rejette format invalide / vide', () => {
    const secret = totp.generateSecret();
    assert.equal(totp.verify('', secret), false);
    assert.equal(totp.verify('12345', secret), false);   // 5 chiffres
    assert.equal(totp.verify('abcdef', secret), false);
    assert.equal(totp.verify('123456', ''), false);       // pas de secret
  });
});

describe('keyuri / QR', () => {
  test('keyuri contient issuer et compte', () => {
    const uri = totp.keyuri('Virginie', 'JBSWY3DPEHPK3PXP');
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /Tanguy%20Design/);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  });

  test('qrDataUri rend un PNG base64', async () => {
    const uri = totp.keyuri('Test', totp.generateSecret());
    const dataUri = await totp.qrDataUri(uri);
    assert.match(dataUri, /^data:image\/png;base64,/);
  });
});
