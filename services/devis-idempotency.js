'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// devis-idempotency — anti-doublon à l'import d'un devis Winner (2026-07-28)
// ─────────────────────────────────────────────────────────────────────────────
// Problème résolu : /api/devis/import parse le PDF via Claude (60-120s) PUIS crée
// le Devis + Zones + Lignes + Échéances. Aucune protection : si l'utilisatrice
// annule / ferme / rafraîchit puis recommence, le 1er appel a déjà (ou va) créer
// le devis côté serveur ET le retry en crée un SECOND → devis en double.
//
// Fix : on calcule une empreinte (sha256) des OCTETS du PDF. Avant de parser, on
// cherche un Devis portant déjà cette empreinte. S'il existe → on renvoie
// l'existant sans rien recréer (et sans re-parser : le retry devient instantané).
// Sinon on parse, on crée, et on stocke l'empreinte sur le nouveau Devis.
//
// L'empreinte est stockée dans un champ Airtable dédié (voir
// scripts/setup-devis-import-hash-field.js). Le code dégrade proprement si le
// champ n'existe pas encore (import possible, simplement sans dédup) — cf.
// server.js /api/devis/import.
const crypto = require('crypto');

// Nom du champ Airtable (table Devis) qui stocke l'empreinte du PDF importé.
const DEVIS_IMPORT_HASH_FIELD = 'Empreinte import';

// Empreinte stable et déterministe du contenu du PDF (sha256 hex, 64 car.).
// Le même fichier octet-pour-octet → la même empreinte, quel que soit le nom du
// fichier ou le moment de l'upload. Un fichier différent (même d'1 octet) → une
// empreinte différente.
function computeImportHash(buffer) {
  if (!buffer || !(buffer instanceof Buffer) && !ArrayBuffer.isView(buffer)) {
    throw new Error('computeImportHash: buffer requis');
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Formule Airtable pour retrouver un Devis par son empreinte.
// L'empreinte est un hex sûr (0-9a-f), aucun échappement de quote nécessaire, mais
// on refuse toute valeur non conforme par prudence (jamais d'injection de formule).
function buildHashFilterFormula(hash) {
  if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) {
    throw new Error('buildHashFilterFormula: empreinte sha256 hex attendue');
  }
  return `{${DEVIS_IMPORT_HASH_FIELD}}='${hash}'`;
}

// Parmi des records Devis déjà récupérés, retourne le 1er portant cette empreinte
// (ou null). Fonction pure — utile pour tester la logique sans Airtable.
function findDevisByImportHash(records, hash) {
  if (!Array.isArray(records)) return null;
  return records.find(r => r && r.fields && r.fields[DEVIS_IMPORT_HASH_FIELD] === hash) || null;
}

module.exports = {
  DEVIS_IMPORT_HASH_FIELD,
  computeImportHash,
  buildHashFilterFormula,
  findDevisByImportHash,
};
