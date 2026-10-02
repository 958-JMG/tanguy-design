// sonde-connecteurs.js — Santé des connecteurs du cockpit Tanguy Design, testée pour de vrai.
//
// Pourquoi : /api/health répond { ok:true } tant que le conteneur tourne, même si Airtable,
// l'IA, Pennylane ou le bucket de transfert derrière sont morts. L'écran se vide, personne
// n'est prévenu (rejoue cal.com 401 muet, backup 17 jours). Ici CHAQUE connecteur est exercé
// avec les secrets réels et sait ÉCHOUER : 200 + forme attendue = vert ; 401/403/404/timeout =
// rouge avec la cause ; non configuré = absent (jamais de faux rouge, jamais de silence).
//
// Lecture seule, sans effet de bord : endpoints les plus légers, jamais un POST. Chaque sonde
// a son propre timeout et ne peut pas faire tomber les autres (Promise.all + try/catch).
// Même contrat que cockpit-pilotage : { global, genere_a, connecteurs:[{cle,nom,etat,detail,ms}] }.

const absent = (raison) => ({ etat: 'absent', detail: raison });

async function httpCode(url, opts = {}, timeout = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), ...opts });
  let body = null; try { body = await r.text(); } catch { /* le code suffit */ }
  return { status: r.status, body };
}

function classer(status, { vert, cause401 = 'clé/jeton invalide ou expiré', cause403 = 'accès refusé', cause404 = 'ressource introuvable', body = '' } = {}) {
  if (status >= 200 && status < 300) return { etat: 'vert', detail: vert };
  if (status === 401) return { etat: 'rouge', detail: `401 ${cause401}` };
  if (status === 403) return { etat: 'rouge', detail: `403 ${cause403}` };
  if (status === 404) return { etat: 'rouge', detail: `404 ${cause404}` };
  const extrait = (body || '').replace(/\s+/g, ' ').slice(0, 80);
  // Un 5xx vient du fournisseur (pas de notre clé) : transitoire, donc réessayable.
  return { etat: 'rouge', detail: `HTTP ${status}${extrait ? ' — ' + extrait : ''}`, transitoire: status >= 500 };
}

// Un échec transitoire (timeout, coupure réseau, 5xx fournisseur) peut disparaître au réessai :
// ce n'est PAS une clé morte. On réessaie UNE fois avant de peindre un rouge, pour ne jamais
// crier au loup sur un simple pic de latence (leçon fail2ban / fonts.check qui mentent). Un
// échec FRANC (401/403/404) n'est jamais réessayé : il est déterministe.
const RE_TRANSITOIRE = /timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|und_err|epipe|network|fetch failed|socket|aborted/i;
function estErreurTransitoire(e) {
  if (!e) return false;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  const sig = `${e.name || ''} ${e.message || ''} ${e.code || ''} ${(e.cause && e.cause.code) || ''}`;
  return RE_TRANSITOIRE.test(sig);
}

// Exécute une sonde, et la rejoue une fois si l'échec est transitoire. ms = dernière tentative.
// Exporté pour être prouvé par un test qui sait échouer.
async function sonderAvecReessai(fn, arg, { tentatives = 2, delai = 800 } = {}) {
  let out, ms = 0;
  for (let i = 0; i < tentatives; i++) {
    const t0 = Date.now();
    let transitoire = false;
    try {
      out = await fn(arg);
      transitoire = out && out.etat === 'rouge' && out.transitoire === true;
    } catch (e) {
      transitoire = estErreurTransitoire(e);
      out = { etat: 'rouge', detail: (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'injoignable (timeout)' : (e.message || 'échec inattendu').slice(0, 100) };
    }
    ms = Date.now() - t0;
    if (out.etat !== 'rouge' || !transitoire || i === tentatives - 1) break;
    await new Promise((r) => setTimeout(r, delai));
  }
  if (out && 'transitoire' in out) delete out.transitoire;
  return { out, ms };
}

const SONDES = {
  // Airtable : la base de TOUT le cockpit (clients, projets, devis, commandes…). Si elle tombe,
  // chaque écran se vide. L'endpoint meta valide la clé ET l'accès à la base, sans rien écrire
  // et sans dépendre d'un id de table (qui peut changer). Même appel que le resolve e2e existant.
  async airtable() {
    const base = process.env.AIRTABLE_BASE_ID;
    const k = process.env.AIRTABLE_KEY;
    if (!base || !k) return absent('AIRTABLE_BASE_ID / AIRTABLE_KEY non posées');
    const { status, body } = await httpCode(
      `https://api.airtable.com/v0/meta/bases/${base}/tables`,
      { headers: { Authorization: 'Bearer ' + k } });
    if (status === 200) {
      let n = '?'; try { n = (JSON.parse(body).tables || []).length; } catch { return { etat: 'rouge', detail: '200 mais réponse sans tables' }; }
      return { etat: 'vert', detail: `base OK (${n} tables visibles)` };
    }
    return classer(status, { cause403: 'clé sans accès à la base (scope schema.bases:read ?)', cause404: 'base introuvable', body });
  },

  // IA : rédaction de descriptions, parsing de devis. GET /models valide la clé sans consommer.
  async ia() {
    const mistral = (process.env.AI_PROVIDER || 'anthropic').trim().toLowerCase() === 'mistral';
    const nomCle = mistral ? 'MISTRAL_API_KEY' : 'ANTHROPIC_API_KEY';
    const k = (process.env[nomCle] || '').trim();
    if (!k) return absent(`${nomCle} non posée`);
    const url = mistral ? 'https://api.mistral.ai/v1/models' : 'https://api.anthropic.com/v1/models';
    const headers = mistral
      ? { Authorization: 'Bearer ' + k }
      : { 'x-api-key': k, 'anthropic-version': '2023-06-01' };
    const { status, body } = await httpCode(url, { headers });
    return classer(status, { vert: `${mistral ? 'Mistral' : 'Anthropic'} OK (clé valide)`, body });
  },

  // Pennylane : brouillons de devis/factures. GET 1 facture valide la clé sans rien créer.
  async pennylane() {
    const k = process.env.PENNYLANE_API_KEY;
    if (!k) return absent('PENNYLANE_API_KEY non posée (facturation manuelle)');
    const { status, body } = await httpCode(
      'https://app.pennylane.com/api/external/v2/customer_invoices?per_page=1',
      { headers: { Authorization: 'Bearer ' + k, Accept: 'application/json' } }, 10000);
    return classer(status, { vert: 'API facturation OK', body });
  },

  // Object Storage (transfert) : les liens de fichiers envoyés aux clients. HeadBucket = test vif.
  async s3() {
    const bucket = process.env.S3_TRANSFERT_BUCKET;
    if (!bucket) return absent('S3_TRANSFERT_BUCKET non posé');
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return absent('clés S3 (AWS_ACCESS_KEY_ID/SECRET) non posées');
    const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region: process.env.S3_TRANSFERT_REGION || 'fr-par',
      endpoint: process.env.S3_TRANSFERT_ENDPOINT || 'https://s3.fr-par.scw.cloud',
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { etat: 'vert', detail: `bucket ${bucket} accessible` };
    } catch (e) {
      const code = e && e.$metadata && e.$metadata.httpStatusCode;
      if (code === 403) return { etat: 'rouge', detail: '403 clés S3 sans droit sur le bucket' };
      if (code === 404) return { etat: 'rouge', detail: `404 bucket ${bucket} introuvable` };
      return { etat: 'rouge', detail: ((e && e.name) || 'erreur S3') + (code ? ` (${code})` : '') };
    }
  },
};

// Ordre d'affichage : les plus critiques d'abord.
const ORDRE = ['airtable', 'ia', 'pennylane', 's3'];
const LIBELLE = {
  airtable: 'Airtable (base du cockpit)',
  ia: 'IA (Anthropic/Mistral)',
  pennylane: 'Pennylane (facturation)',
  s3: 'Object Storage (transfert fichiers)',
};

async function sonderConnecteurs() {
  const resultats = await Promise.all(ORDRE.map(async (cle) => {
    const { out, ms } = await sonderAvecReessai(SONDES[cle]);
    return { cle, nom: LIBELLE[cle] || cle, etat: out.etat, detail: out.detail, ms };
  }));
  const global = resultats.some(r => r.etat === 'rouge') ? 'rouge' : 'vert';
  return { global, genere_a: new Date().toISOString(), connecteurs: resultats };
}

module.exports = { sonderConnecteurs, sonderAvecReessai, classer, ORDRE, LIBELLE };
