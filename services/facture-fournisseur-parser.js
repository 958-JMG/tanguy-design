/**
 * services/facture-fournisseur-parser.js
 *
 * Parse une facture fournisseur PDF (Modulnova, électro, plans de travail, etc.)
 * via Claude API (vision). Retourne les infos pour créer un record dans la table
 * "Factures fournisseurs" + rapprochement automatique avec la commande liée.
 */

const { completer } = require('./ai');
const MODEL = 'claude-sonnet-4-5';

const SCHEMA_PROMPT = `Tu es l'assistante administrative de Tanguy Design (agence cuisine sur-mesure à Vannes). Tu saisis les factures reçues des fournisseurs (fabricants de meubles type Modulnova, électroménager, plans de travail, quincaillerie, transporteurs…).

Analyse ce PDF de facture fournisseur et retourne UNIQUEMENT un objet JSON valide (pas de texte avant/après, pas de markdown) selon ce schéma :

{
  "fournisseur": {
    "nom": "Raison sociale de l'émetteur de la facture (Modulnova, Miele, etc.)",
    "siret": "14 chiffres ou chaîne vide",
    "email": "",
    "telephone": ""
  },
  "metadata": {
    "numero_facture": "numéro exact de la facture (ex: FA-2026-0945)",
    "date_facture": "YYYY-MM-DD",
    "date_echeance": "YYYY-MM-DD ou null (si conditions de paiement type '30 jours fin de mois', calcule la date)",
    "reference_commande": "numéro de commande / BC référencé sur la facture, ou chaîne vide",
    "contremarque": "contremarque / référence chantier client si mentionnée (souvent un nom de famille), sinon chaîne vide"
  },
  "totaux": {
    "total_ht": 11222.86,
    "total_tva": 2244.57,
    "total_ttc": 13467.43
  },
  "lignes_resume": "Synthèse lisible en 2-5 lignes des postes facturés (ne liste PAS tout le détail)",
  "alertes_parsing": "texte libre si champs ambigus/illisibles (ex: 'date échéance non mentionnée'), sinon chaîne vide"
}

RÈGLES :
- Les montants sont des nombres (pas de chaîne), point décimal, pas de séparateur de milliers.
- Dates au format ISO YYYY-MM-DD. Si absente ou illisible : null.
- Si un champ est absent, mets "" ou null, ne l'invente jamais.
- Attention aux avoirs : si le document est un AVOIR, les montants sont négatifs et tu le signales dans alertes_parsing.
- Retourne UNIQUEMENT le JSON.`;

async function parseFactureFournisseurPdf(pdfBuffer) {

  const base64Pdf = pdfBuffer.toString('base64');

  const { texte: text } = await completer({
    niveau: 'standard',
    maxTokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        { type: 'text', text: SCHEMA_PROMPT }
      ]
    }]
  });
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Réponse Claude sans JSON: ' + text.slice(0, 200));
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new Error('JSON invalide: ' + e.message + '\n' + text.slice(0, 500));
  }
}

module.exports = { parseFactureFournisseurPdf };
