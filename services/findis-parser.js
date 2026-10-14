'use strict';
/**
 * services/findis-parser.js — Lecture d'une page « Projet » FINDIS (espace pro
 * Cuiseo) pour le Devis express électroménager (demande JMG du 14/10/2026).
 *
 * Deux chemins, choisis fichier par fichier, mesurés le 14/10 sur 6 projets
 * réels (45 articles) contre une vérité terrain extraite indépendamment :
 *   - PDF imprimé depuis FINDIS → lecture du TEXTE (unpdf + findis-texte.js),
 *     sans IA : 0 écart, instantané, et rien ne quitte le serveur ;
 *   - capture d'écran (ou PDF dont la mise en page n'est pas reconnue) → lecture
 *     par le modèle PREMIUM : 0 écart sur 45 articles, quand le modèle standard
 *     en faisait 13 (prix d'achat faux, promo inventée). L'écran le signale.
 *
 * Ce service ne fait que LIRE : montants recopiés tels qu'affichés, conversion,
 * promo, contrôles et marges en aval (services/devis-electro.js).
 *
 * Données personnelles : la page FINDIS affiche le client (nom, adresse,
 * téléphone, e-mail). La lecture du texte commence APRÈS ce bloc ; le schéma
 * demandé au modèle n'a aucun champ client. Rien n'en est conservé.
 */

const { completer } = require('./ai');
const { extractJson } = require('./devis-fournisseur-parser');
const { articlesDepuisTexte } = require('./findis-texte');

const TYPES_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// Limite de l'API pour une image : au-delà, on le dit avant l'appel.
const IMAGE_MAX_OCTETS = 5 * 1024 * 1024;

const PROMPT = `Tu es l'assistante de chiffrage de Tanguy Design (cuisiniste à Vannes). Tu reçois la page « Projet » du site du grossiste FINDIS (espace pro Cuiseo), en PDF imprimé ou en une ou plusieurs captures d'écran, annoncées dans l'ordre (« Fichier 0 », « Fichier 1 »…).

Retourne UNIQUEMENT un objet JSON valide (aucun texte avant ou après, pas de markdown) :
{
  "projet_findis": "35789",
  "articles": [
    {
      "source": 0,
      "type_findis": "Piano de cuisson induction",
      "marque": "SMEG",
      "libelle": "Piano de cuisson induction",
      "reference": "SCD90IMX9-1",
      "hors_tarif": false,
      "quantite": 1,
      "prix_public_ttc": "1 999,00",
      "prix_vente_ttc": "1 999,00",
      "prix_achat_ht": "1 166,56",
      "promo_ht": "1 118,72",
      "eco_part_ht": "12,20",
      "stock": 11,
      "cde": 0,
      "delai": null,
      "sur_commande": false,
      "remplace_par": null
    }
  ],
  "alertes": []
}

RÈGLES STRICTES :
- N'écris RIEN du bloc « Client » (civilité, prénom, nom, e-mail, adresse, téléphones, date) : ce sont des données personnelles, elles ne servent pas.
- Un article = un bloc avec un titre rouge « Type | MARQUE Libellé RÉFÉRENCE ». "type_findis" = le texte AVANT « | ». "marque" = la marque en majuscules au début du titre après « | » (ex. « BOSCH ACCENT LINE », « MIELE PRESTIGE »). "reference" = le code produit en fin de titre, sans « [Hors Tarif] » ; chaîne vide s'il n'y en a pas. "hors_tarif" = true si le titre contient « [Hors Tarif] ».
- Les articles affichés après « Observations » ou « Lignes de cadeaux » sont des articles du projet comme les autres : transcris-les.
- MONTANTS : recopie EXACTEMENT le texte affiché, chiffre par chiffre, sans calcul ni arrondi, sans « € », « HT », « TTC » : "prix_public_ttc" (« Votre prix public »), "prix_vente_ttc" (« P.Vente »), "prix_achat_ht" (« P.Achat »), "promo_ht" (« Promo » en vert, null s'il n'y a PAS de ligne « Promo » pour cet article), "eco_part_ht" (« éco-part. »).
- "quantite" = le nombre dans la petite case sous le prix public. "stock" et "cde" = les nombres de « Stock : X / Cde : Y ». "delai" = le texte après « Délai : », sinon null. "sur_commande" = true si « Sur commande » est affiché.
- « Article remplacé par la référence X » : "remplace_par" = "X" et tous les prix à null.
- Plusieurs fichiers : un article visible sur deux captures ne figure QU'UNE fois, avec la "source" (numéro du fichier) où ses prix sont lisibles. Un prix coupé ou illisible = null, et une phrase dans "alertes" qui nomme l'article. N'INVENTE JAMAIS un montant.
- "projet_findis" = le numéro de « Projet n° … » s'il est visible, sinon null.`;

/** Type réel d'un fichier d'après ses premiers octets (le type déclaré est manipulable). */
function typeReel(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buffer.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

/**
 * Contrôle des fichiers AVANT toute lecture : on dit ce qui ne va pas, plutôt
 * que de laisser l'API répondre une erreur obscure.
 * @returns {{ types: Array<string|null>, erreurs: string[] }}
 */
function controlerFichiers(fichiers) {
  const erreurs = [];
  const types = (fichiers || []).map((f, i) => {
    const nom = f.originalname || `fichier ${i + 1}`;
    const type = typeReel(f.buffer);
    if (!type) erreurs.push(`« ${nom} » n'est ni un PDF ni une image (PNG, JPEG, WebP).`);
    else if (TYPES_IMAGES.includes(type) && f.buffer.length > IMAGE_MAX_OCTETS) {
      erreurs.push(`« ${nom} » pèse ${(f.buffer.length / 1048576).toFixed(1)} Mo : au-delà de 5 Mo, recadre la capture ou enregistre-la en JPEG.`);
    }
    return type;
  });
  if (!types.length) erreurs.push('Aucun fichier reçu.');
  return { types, erreurs };
}

let _unpdf = null;
/** Texte d'un PDF, pages jointes par « \n ». */
async function texteDuPdf(buffer) {
  _unpdf ||= require('unpdf');
  const pdf = await _unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await _unpdf.extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n');
}

/** Lecture par le modèle des fichiers `indexes` (numérotés comme à l'écran). */
async function lireParIA(fichiers, types, indexes, niveau, ia = completer) {
  const blocs = [];
  for (const i of indexes) {
    blocs.push({ type: 'text', text: `Fichier ${i} :` });
    const data = fichiers[i].buffer.toString('base64');
    blocs.push(types[i] === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: types[i], data } });
  }
  const { texte, modele } = await ia({
    niveau,
    maxTokens: 16000,
    system: PROMPT,
    messages: [{ role: 'user', content: [...blocs, { type: 'text', text: 'Transcris les articles de ce projet FINDIS selon le schéma.' }] }],
  });
  return { ...extractJson(texte), modele };
}

/**
 * Lit un projet FINDIS (un PDF ou plusieurs captures). Renvoie la forme brute
 * (montants en texte) à passer à normaliserArticles(), plus la façon dont
 * chaque fichier a été lu (« texte » ou « ia »).
 * @param {Array<{buffer:Buffer, originalname?:string}>} fichiers
 * @param {{ niveau?: string, lireTexte?: Function, ia?: Function }} [opts] - lireTexte et ia :
 *        injectables pour les tests (aucun réseau en CI)
 */
async function lireProjetFindis(fichiers, { niveau = 'premium', lireTexte = texteDuPdf, ia = completer } = {}) {
  const { types, erreurs } = controlerFichiers(fichiers);
  if (erreurs.length) { const e = new Error(erreurs.join(' ')); e.statusCode = 400; throw e; }

  const articles = [];
  const alertes = [];
  const lectures = [];
  let projet = null;
  const pourIA = [];

  for (let i = 0; i < fichiers.length; i++) {
    const nom = fichiers[i].originalname || `fichier ${i + 1}`;
    if (types[i] !== 'application/pdf') { pourIA.push(i); continue; }
    let lu = null;
    try {
      lu = articlesDepuisTexte(await lireTexte(fichiers[i].buffer));
    } catch (e) {
      alertes.push(`« ${nom} » : texte du PDF illisible (${e.message}).`);
    }
    if (lu && lu.articles.length) {
      projet = projet || lu.projet_findis;
      lu.articles.forEach(a => articles.push({ ...a, source: i }));
      alertes.push(...lu.alertes);
      lectures.push({ fichier: nom, mode: 'texte', articles: lu.articles.length });
    } else {
      alertes.push(`« ${nom} » : mise en page FINDIS non reconnue dans le texte du PDF, lu par l'IA — vérifie les prix.`);
      pourIA.push(i);
    }
  }

  if (pourIA.length) {
    const lu = await lireParIA(fichiers, types, pourIA, niveau, ia);
    projet = projet || lu.projet_findis || null;
    (lu.articles || []).forEach(a => articles.push({ ...a, source: pourIA.includes(a.source) ? a.source : pourIA[0] }));
    alertes.push(...(lu.alertes || []));
    for (const i of pourIA) {
      lectures.push({ fichier: fichiers[i].originalname || `fichier ${i + 1}`, mode: 'ia', modele: lu.modele,
        articles: (lu.articles || []).filter(a => (pourIA.includes(a.source) ? a.source : pourIA[0]) === i).length });
    }
  }
  return { projet_findis: projet, articles, alertes, lectures };
}

module.exports = { lireProjetFindis, controlerFichiers, typeReel, texteDuPdf, PROMPT };
