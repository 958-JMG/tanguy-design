/**
 * services/devis-parser.js
 *
 * Parse un devis PDF Tanguy Design via Claude API (vision).
 * Retourne un objet JSON strict avec tous les champs structurés,
 * prêt à être inséré dans les tables Devis / Zones / Lignes / Échéances.
 */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-5';

const SCHEMA_PROMPT = `Tu es un expert en analyse de devis de cuisine Tanguy Design (agence cuisine Vannes).

Analyse ce PDF de devis et retourne UNIQUEMENT un objet JSON valide, sans aucun texte avant ou après, selon ce schéma exact :

{
  "client": {
    "civilite": "M. / Mme / M. & Mme / ...",
    "nom": "NOM EN MAJUSCULES",
    "adresse": "ligne complète",
    "cp": "56400",
    "ville": "VILLE",
    "email": "...",
    "telephone_domicile": "",
    "telephone_portable": ""
  },
  "metadata": {
    "numero_devis": "563/1/12",
    "milieu": "CUISINE | SDB | DRESSING | LIVING | AUTRE",
    "date_devis": "YYYY-MM-DD",
    "valable_jusquau": "YYYY-MM-DD"
  },
  "adresses": {
    "facturation": "adresse complète multi-lignes",
    "livraison": "adresse complète multi-lignes (si différente)"
  },
  "zones": [
    {
      "ordre": 1,
      "nom": "COTE EVIER ET ARMOIRES",
      "marque": "NOVA CUCINA",
      "modele": "Smart",
      "porte_epaisseur": "22 mm",
      "modularite": "Gorge sur socle H.6 cm",
      "execution_facade": "Stratifié opaco soft",
      "coloris_facade": "SF02 Beige ardenne",
      "chant_facade": "Chant ABS",
      "coloris_caisson": "Graphite",
      "execution_cote_finition": "Stratifié (2 faces)",
      "coloris_cote_finition": "SF02 Beige ardenne",
      "type_gorge": "Gorge classique",
      "execution_gorges": "Laqué mat Touch",
      "finition_gorges": "RAL mat Beige ardenne",
      "profondeur": "Profondeur 57",
      "option_ouverture": "Standard",
      "profondeur_element_bas_angle": "Prof. 57 L. 110",
      "finition_socle": "LAQUE H 6 cm : RAL mat Beige ardenne",
      "coloris_joues_panneaux": "SF02 Beige ardenne",
      "finition_etageres": "Beige ardenne"
    }
  ],
  "lignes": [
    {
      "position": "1",
      "position_parent": "",
      "zone_nom": "COTE EVIER ET ARMOIRES",
      "categorie": "Meubles | Panneaux de recouvrement | Produits de vente | Eviers et robinetterie | Electroménager | Sanitaires | Dépose | Divers",
      "code_produit": "ZPL22A",
      "designation": "description complète multi-lignes",
      "largeur_mm": 600,
      "hauteur_mm": 2400,
      "profondeur_mm": null,
      "sens": "D | G | null",
      "cote_visible": "D | G | null",
      "quantite": 1.440,
      "unite": "m² | pce | m | ml | PCE",
      "tva_pourcentage": 10,
      "montant_ht": 248.17,
      "eco_participation": 1.90,
      "cout_final": 250.07,
      "modele_override": "",
      "execution_facade_override": "",
      "coloris_facade_override": "",
      "coloris_cote_finition_override": "",
      "alertes": "texte rouge s'il y en a (ex: Modèle de poubelle non défini)",
      "notes": ""
    }
  ],
  "totaux": {
    "total_lignes_ht": 32879.64,
    "remise_pourcentage": 10,
    "montant_remise": 3287.96,
    "total_apres_remise": 29591.67,
    "livraison_ht": 329.17,
    "livraison_tva_taux": 20,
    "pose_ht": 2536.36,
    "pose_tva_taux": 10,
    "eco_participation_mobilier": 86.99,
    "eco_participation_electromenager": 45.25,
    "total_ht_final": 32589.45,
    "tva_taux_1_pourcentage": 20,
    "tva_taux_1_base": 6368.62,
    "tva_taux_1_montant": 1273.72,
    "tva_taux_2_pourcentage": 10,
    "tva_taux_2_base": 26220.83,
    "tva_taux_2_montant": 2622.08,
    "total_ttc": 36485.25
  },
  "echeances": [
    {
      "ordre": 1,
      "libelle": "A la commande",
      "montant_prevu": 10945.58,
      "date_prevue": null
    }
  ],
  "alertes_parsing": "texte libre si tu as détecté des incohérences ou des champs ambigus, sinon chaîne vide"
}

RÈGLES STRICTES :
- Toutes les lignes d'articles doivent être extraites, y compris les sous-lignes numérotées (ex: 2.1, 2.2) qui référencent la ligne parent via "position_parent": "2".
- Les sous-lignes n'ont généralement pas de zone (zone_nom = "").
- Les positions numériques peuvent aller jusqu'à 507 ou plus (lignes de finition, gorges, socles en fin de devis).
- Les catégories sont les titres de sections du devis. Respecte l'orthographe exacte ci-dessus (sans accents sur Eviers, Electroménager).
- Les montants sont en euros, toujours en nombre (pas de chaîne), avec point décimal. Ne mets jamais de séparateur de milliers.
- Les dates au format ISO YYYY-MM-DD. Si absente, mets null.
- Les dimensions en millimètres, en nombre entier. Si non mentionnées, null.
- Si un champ est absent du devis, mets chaîne vide "" ou null, ne l'invente jamais.
- Retourne UNIQUEMENT le JSON, pas de commentaire, pas de bloc markdown, pas de préambule.
- Si tu ne peux pas lire certaines parties, remplis "alertes_parsing" avec les détails.`;

/**
 * Parse un PDF devis et retourne l'objet structuré.
 * @param {Buffer} pdfBuffer - contenu binaire du PDF
 * @returns {Promise<object>}
 */
async function parseDevisPdf(pdfBuffer) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const client = new Anthropic({ apiKey });
  const base64Pdf = pdfBuffer.toString('base64');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 64000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf }
          },
          { type: 'text', text: SCHEMA_PROMPT }
        ]
      }
    ]
  });

  const text = response.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  // Extraction robuste du JSON (au cas où Claude ajoute un préambule malgré les consignes)
  let jsonStr = text.trim();
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Réponse Claude ne contient pas de JSON valide: ' + text.slice(0, 200));
  }
  jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('JSON invalide retourné par Claude: ' + e.message + '\n--- début réponse ---\n' + text.slice(0, 500));
  }
}

/**
 * Parse une transcription Plaud brute (texte) en structure 6 sections.
 * @param {string} transcript
 * @returns {Promise<object>}
 */
async function parsePlaudTranscript(transcript) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const client = new Anthropic({ apiKey });

  const prompt = `Tu analyses une transcription de réunion (enregistrement Plaud) pour Tanguy Design, agence cuisine à Vannes.

Retourne UNIQUEMENT un JSON strict avec cette structure :
{
  "titre": "titre court du sujet principal de la réunion",
  "date_heure": "YYYY-MM-DDTHH:MM:SS ou null",
  "lieu": "lieu de la réunion ou chaîne vide",
  "client_nom": "nom du client mentionné ou chaîne vide",
  "synthese": "paragraphe récapitulatif (5-10 lignes)",
  "contexte": "paragraphes thématiques sur le contexte (maison, famille, projet global)",
  "points_douleur": "liste markdown des points de douleur avec impact : [Titre]\\n\\ndescription\\n\\nImpact: ...",
  "attentes": "liste markdown des attentes client structurées par thème",
  "autres_informations": "informations annexes importantes",
  "taches_identifiees": "liste markdown des actions/tâches à effectuer par Tanguy Design"
}

Transcription à analyser :
---
${transcript}
---

Retourne UNIQUEMENT le JSON, sans aucun texte avant ou après.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1) throw new Error('Pas de JSON dans la réponse');
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

module.exports = { parseDevisPdf, parsePlaudTranscript };
