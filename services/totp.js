/**
 * services/totp.js
 *
 * 2FA TOTP RFC 6238 (Google Authenticator, 1Password, Authy…) pour le cockpit Tanguy.
 *
 * Pattern repris de cockpit-manoria (otplib + qrcode), adapté au modèle dynamique
 * de Tanguy : le secret base32 par utilisateur vit dans Airtable (table "Users
 * cockpit", champ "TOTP secret"), CHIFFRÉ au repos.
 *
 * Chiffrement : AES-256-GCM, clé dérivée de SESSION_SECRET via scrypt.
 *   → pas de nouveau secret Scaleway à gérer (SESSION_SECRET existe déjà).
 *   → si SESSION_SECRET tourne, les secrets TOTP existants deviennent illisibles
 *     et l'enrôlement repart à zéro (acceptable : break-glass admin + Airtable).
 *
 * Fenêtre de tolérance : ±1 step (90 s) pour absorber la dérive d'horloge entre
 * le téléphone et le serveur (RFC 6238 §5.2). La rate-limit login reste active.
 */

'use strict';

const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const logger = require('./logger');

// Tolérance horloge : 1 step de 30 s avant/après.
authenticator.options = { window: 1 };

const ISSUER = 'Tanguy Design';
const SESSION_SECRET_FALLBACK = 'dev-only-change-me';

// --- Clé de chiffrement dérivée de SESSION_SECRET -------------------------------
let _key = null;
function encKey() {
  if (_key) return _key;
  const secret = process.env.SESSION_SECRET || SESSION_SECRET_FALLBACK;
  // scrypt déterministe (sel fixe lié au domaine) → même clé entre redéploiements.
  _key = crypto.scryptSync(secret, 'tanguy-totp-enc-v1', 32);
  return _key;
}

/**
 * Chiffre un secret base32 → chaîne "v1:<iv_b64>:<tag_b64>:<cipher_b64>".
 */
function encryptSecret(plainBase32) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plainBase32), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * Déchiffre une valeur produite par encryptSecret(). Retourne null si illisible
 * (clé changée, donnée corrompue) — l'appelant traitera comme "pas de 2FA".
 */
function decryptSecret(stored) {
  try {
    if (!stored || typeof stored !== 'string') return null;
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    logger.warn({ err: e.message }, '[totp] decryptSecret failed (clé changée ?)');
    return null;
  }
}

/** Génère un nouveau secret base32 (compatible apps Authenticator). */
function generateSecret() {
  return authenticator.generateSecret();
}

/** URL otpauth:// standard à encoder en QR (issuer=Tanguy Design, account=label). */
function keyuri(accountLabel, secretBase32) {
  return authenticator.keyuri(accountLabel || 'utilisateur', ISSUER, secretBase32);
}

/** Data-URI PNG du QR code (rendu serveur → compatible CSP script-src 'self'). */
async function qrDataUri(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: { dark: '#1A1916', light: '#F7F4EF' },
  });
}

/**
 * Vérifie un code à 6 chiffres contre un secret base32 EN CLAIR.
 * Tolère espaces (ex. "123 456"). Retourne false sur toute exception.
 */
function verify(code, secretBase32) {
  try {
    if (!code || !secretBase32) return false;
    const clean = String(code).replace(/\s+/g, '').trim();
    if (!/^\d{6}$/.test(clean)) return false;
    return authenticator.check(clean, secretBase32);
  } catch (e) {
    logger.error({ err: e.message }, '[totp] verify exception');
    return false;
  }
}

module.exports = {
  generateSecret,
  keyuri,
  qrDataUri,
  verify,
  encryptSecret,
  decryptSecret,
  ISSUER,
};
