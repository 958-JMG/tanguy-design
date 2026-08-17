/**
 * services/artisan-devis-parser.js
 *
 * Parse un devis d'artisan PDF (format simple, hors Winner/Métron)
 * via Claude API (vision). Retourne les infos essentielles pour créer
 * un record dans la table "Devis Artisans" + calculer la rétro-commission 5%.
 */

const { completer } = require('./ai');
const MODEL = 'claude-sonnet-4-5';

const SCHEMA_PROMPT = `Tu es un expert en analyse de devis d'artisans du bâtiment (carreleur, plombier, électricien, peintre, menuisier, etc.) destinés à Tanguy Design (agence cuisine à Vannes, qui coordonne des chantiers).

Analyse ce PDF de devis artisan et retourne UNIQUEMENT un objet JSON valide (pas de texte avant/après, pas de markdown) selon ce schéma :

{
  "artisan": {
    "entreprise": "Raison sociale de l'artisan (SAS VACHERY CARRELAGES, Plakome, MTLR, etc.)",
    "siret": "14 chiffres ou chaîne vide",
    "adresse": "adresse complète",
    "telephone": "",
    "email": ""
  },
  "client": {
    "nom": "Nom du client final (Mr et Mme LIVET, etc.)",
    "adresse_facturation": "adresse complète multi-lignes",
    "email": ""
  },
  "chantier": {
    "adresse": "adresse complète du chantier (si différente de la facturation, sinon reprendre facturation)"
  },
  "metadata": {
    "numero_devis": "ex: DV3754",
    "date_devis": "YYYY-MM-DD",
    "date_validite": "YYYY-MM-DD ou null"
  },
  "description_travaux": "Résumé en 3-8 lignes des prestations principales (ex: 'Rénovation maison — Cuisine: dépose sol, ragréage, pose carrelage 60x60 + faïence 30x60. Salle d'eau: douche, banc WEDI, protection à l'eau, faïence par-dessus faïence. Salle d'eau bleue: baignoire conservée, reprise murs et sol.'). Ne liste PAS toutes les lignes, fais une synthèse lisible.",
  "totaux": {
    "total_ht": 11222.86,
    "total_tva": 1126.71,
    "total_ttc": 12349.57,
    "acompte_montant": 3704.87,
    "acompte_pourcentage": 30
  },
  "alertes_parsing": "texte libre si champs ambigus/illisibles, sinon chaîne vide"
}

RÈGLES :
- Les montants sont des nombres (pas de chaîne), point décimal, pas de séparateur de milliers.
- Dates au format ISO YYYY-MM-DD. Si absente ou illisible : null.
- Si un champ est absent, mets "" ou null, ne l'invente jamais.
- Retourne UNIQUEMENT le JSON.`;

async function parseArtisanDevisPdf(pdfBuffer) {

  const base64Pdf = pdfBuffer.toString('base64');

  const { texte: text } = await completer({
    niveau: 'standard',
    maxTokens: 8000,
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

module.exports = { parseArtisanDevisPdf };
