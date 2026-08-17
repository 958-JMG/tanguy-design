// Passerelle fournisseur de modèle — convention 9·58 (`AI_PROVIDER`, cf. cockpit-manoria).
//
// Avant : six `new Anthropic()` dispersés dans cinq fichiers, chacun avec sa
// vérification de clé, son modèle en dur et aucun délai de garde. Un seul point
// d'entrée désormais — changer de fournisseur, de modèle ou de délai se fait ici.
//
// ⚠️ CE QUI NE BASCULE PAS VERS MISTRAL : les quatre parseurs (devis client,
// devis fournisseur, devis artisan, facture fournisseur) envoient les PDF en
// blocs NATIFS Anthropic (`{type:'document', source:{type:'base64',
// media_type:'application/pdf'}}`). C'est le cœur du cockpit, et Mistral ne lit
// pas les documents de cette façon (son OCR est un produit séparé, au schéma
// différent). En mode mistral, un appel portant un document est REFUSÉ avec son
// motif, plutôt que d'échouer obscurément au premier devis déposé.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODELES = {
  anthropic: { premium: 'claude-opus-4-7', standard: 'claude-sonnet-4-5', rapide: 'claude-haiku-4-5-20251001' },
  mistral: { premium: 'mistral-large-latest', standard: 'mistral-large-latest', rapide: 'mistral-small-latest' },
};

/** Fournisseur actif. Défaut : anthropic (aucune variable à poser). */
function fournisseur() {
  return (process.env.AI_PROVIDER || 'anthropic').trim().toLowerCase() === 'mistral' ? 'mistral' : 'anthropic';
}

function nomDeLaCle() {
  return fournisseur() === 'mistral' ? 'MISTRAL_API_KEY' : 'ANTHROPIC_API_KEY';
}

/** La clé du fournisseur actif est-elle posée ? */
function estConfigure() {
  return Boolean((process.env[nomDeLaCle()] || '').trim());
}

/** Le fournisseur actif sait-il lire un PDF joint ? */
function litLesDocuments() {
  return fournisseur() === 'anthropic';
}

function modele(niveau = 'standard') {
  return MODELES[fournisseur()][niveau] || MODELES[fournisseur()].standard;
}

// Sans délai dur, un appel qui ne répond jamais laisse la requête HTTP pendre.
const DELAI_MS = Number(process.env.AI_TIMEOUT_MS) || 120_000;

let clientAnthropic = null;
function anthropic() {
  const cle = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!cle) throw new Error('ANTHROPIC_API_KEY non configurée.');
  clientAnthropic ||= new Anthropic({ apiKey: cle });
  return clientAnthropic;
}

function contientUnDocument(messages) {
  return (messages || []).some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c && (c.type === 'document' || c.type === 'image')),
  );
}

async function appelMistral({ niveau, system, messages, maxTokens }) {
  const cle = (process.env.MISTRAL_API_KEY || '').trim();
  if (!cle) throw new Error('MISTRAL_API_KEY manquante (AI_PROVIDER=mistral).');

  const ac = new AbortController();
  const minuteur = setTimeout(() => ac.abort(), DELAI_MS);
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: modele(niveau),
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages.map((m) => ({
            role: m.role,
            content: Array.isArray(m.content)
              ? m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
              : m.content,
          })),
        ],
      }),
    });
    if (!res.ok) throw new Error(`Mistral ${res.status} : ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    return {
      texte: data.choices?.[0]?.message?.content || '',
      modele: data.model,
      usage: data.usage,
      fournisseur: 'mistral',
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Appel IA interrompu (délai de ${DELAI_MS} ms dépassé)`);
    throw e;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Appel unique, quel que soit le fournisseur.
 * Renvoie `{ texte, modele, usage, fournisseur }` — le texte est déjà concaténé,
 * les appelants n'ont plus à démonter la réponse eux-mêmes.
 */
async function completer({ niveau = 'standard', system, messages, maxTokens = 8192 } = {}) {
  if (!estConfigure()) throw new Error(`${nomDeLaCle()} non configurée.`);

  if (fournisseur() === 'mistral') {
    if (contientUnDocument(messages)) {
      throw new Error(
        "Ce traitement envoie un PDF au modèle, ce que le fournisseur actif (mistral) " +
          "ne sait pas lire de cette façon. Repassez à Anthropic (retirer AI_PROVIDER) " +
          "ou branchez un service d'OCR.",
      );
    }
    return appelMistral({ niveau, system, messages, maxTokens });
  }

  const r = await anthropic().messages.create({
    model: modele(niveau),
    max_tokens: maxTokens,
    ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
    messages,
  });
  return {
    texte: (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
    modele: r.model,
    usage: r.usage,
    fournisseur: 'anthropic',
  };
}

module.exports = { completer, fournisseur, estConfigure, litLesDocuments, modele, MODELES };
