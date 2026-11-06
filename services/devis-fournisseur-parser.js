/**
 * services/devis-fournisseur-parser.js
 *
 * Chantier « Devis express » (P-H2, 2026-06).
 *
 * Parse un DEVIS FOURNISSEUR PDF (≠ facture) via Claude API (vision) pour
 * pré-remplir un devis client Tanguy Design. Couvre 3 familles de formats
 * réels rencontrées (cf. ~/958/tanguy-design/devis-fournisseurs) :
 *
 *   1. Granit Evolution (plans de travail) — devis commercial « propre » :
 *      sections PLANS DE TRAVAIL / USINAGES / SERVICES, colonnes
 *      Désignation | TVA | P.U. HT | Qté | Total HT, totaux HT/TVA/TTC.
 *      Deux variantes : « PRO » (prix d'achat magasin) et « CLIENT » (revente).
 *
 *   2. Novamobili (meubles/dressings, fournisseur IT) — nomenclature de
 *      fabrication : colonnes N./Q.ta/NG/Codice/Descrizione/FM/Lun/Alt/Prf
 *      [/Importo], totaux « Totale Netto / IVA / Totale ». Le prix par ligne
 *      (Importo) est parfois MASQUÉ → seul le total net est exploitable.
 *
 *   3. Metron (meubles, fournisseur IT) — nomenclature : colonnes
 *      code/description/x y z/qté/montant, total « total X € ». Le montant
 *      par ligne est parfois MASQUÉ → seul le total est exploitable.
 *
 * Depuis le 06/11/2026 : le montant du document est un prix de vente HT,
 * sans coefficient supplémentaire. L’éco est lue séparément avec son inclusion.
 * Le descriptif technique complet est conservé pour l’annexe Pennylane.
 * Devis commerciaux simples lus en texte ; nomenclatures et scans lus visuellement.
 */

const { completer } = require('./ai');
const { createHash } = require('node:crypto');

// Modèle aligné sur les autres parsers du cockpit (devis-parser, facture-fournisseur-parser).
const MODEL = 'claude-sonnet-4-5';

const SCHEMA_PROMPT = `Tu es l'assistante de chiffrage de Tanguy Design (agence cuisine sur-mesure à Vannes). Tu reçois un DEVIS FOURNISSEUR (et NON une facture) émis par un fabricant ou un sous-traitant (meubles type Novamobili/Modulnova/Metron, plans de travail type Granit Evolution, électroménager, etc.). Ton but : en extraire les données fiables pour pré-remplir un devis client.

Analyse ce PDF de devis fournisseur et retourne UNIQUEMENT un objet JSON valide (aucun texte avant/après, pas de markdown) selon ce schéma EXACT :

{
  "fournisseur": {
    "nom": "Raison sociale de l'émetteur du devis (Granit Evolution, Novamobili, Metron…). Si absent, déduis-le de la mise en page et mets ta meilleure hypothèse.",
    "type_detecte": "Granit Evolution | Novamobili | Metron | Autre"
  },
  "document": {
    "numero": "numéro/référence du devis fournisseur (ex: DI0000044050, Progetto n° 250308_1106, 2026/30641), ou chaîne vide",
    "date": "YYYY-MM-DD ou null",
    "reference_chantier": "nom du chantier/client de référence si mentionné (ex: DUPUY, Rochard, MACE), sinon chaîne vide",
    "devise": "EUR"
  },
  "variante_prix": "PRO | CLIENT | INCONNU",
  "produit_resume": "1 à 2 phrases décrivant CE QUE FOURNIT ce devis, au niveau vendable (ex: 'Dressing Night collection — 2 modules battants + portique maxi, finition Foglia mat'). PAS la liste des micro-pièces.",
  "descriptif_complet": "Descriptif technique COMPLET dans l’ordre du document : produits, repères, références, quantités, dimensions, finitions, options et prestations. Inclure aussi les composants des nomenclatures. Aucun prix, aucune remise, aucun coefficient, aucun montant d’achat ou de vente, aucune coordonnée bancaire ni condition commerciale.",
  "categorie_suggeree": "Meuble | Plan de travail | Évier | Robinetterie | Électroménager | Autre",
  "totaux": {
    "total_ht": 7762.00,
    "eco_ht": null,
    "eco_incluse": null,
    "tva_taux": 10,
    "tva_montant": 776.20,
    "total_ttc": 8538.20
  },
  "prix_par_ligne_disponible": true,
  "lignes_detail": [
    {
      "designation": "libellé de la ligne vendable",
      "quantite": 1,
      "pu_ht": 926.50,
      "total_ht": 926.50,
      "tva_taux": 20,
      "categorie": "Plan de travail | Meuble | Usinage | Service | Autre"
    }
  ],
  "pieces_eco_contribution": [
    {
      "designation": "libellé de la tablette / du panneau",
      "quantite": 2,
      "longueur_mm": 1800,
      "hauteur_mm": 300,
      "epaisseur_mm": 19,
      "materiau": "Bois massif | Panneaux de particules | Biosourcé | Inconnu"
    }
  ],
  "alertes_parsing": "texte libre si champs ambigus/illisibles, sinon chaîne vide"
}

RÈGLES :
- Le champ le plus important est totaux.total_ht (le montant HORS taxes imprimé sur le document, sans appliquer de marge ni le convertir en prix d’achat). C'est la donnée pivot. Cherche « Totale Netto », « TOTAL HT », « total … € ». Si seul un TTC est donné avec un taux de TVA, déduis le HT.
- totaux.eco_ht : montant total HT d’éco-participation explicitement imprimé ; null si absent. totaux.eco_incluse : true si ce montant est déjà dans total_ht, false si le document le présente comme supplément, null si ambigu. Ne jamais ajouter l’éco dans total_ht si elle n’y figure pas, ni compter deux fois une ligne « dont éco ».
- descriptif_complet : transcrire les détails techniques de TOUTES les pages, sans les condenser en deux phrases. Respecter les retours à la ligne. Le produit_resume reste un résumé séparé.
- Montants = nombres (point décimal, pas de séparateur de milliers). Les devis italiens écrivent « EUR 7 762,00 » → renvoie 7762.00.
- "prix_par_ligne_disponible" : mets false si le document ne montre PAS de prix unitaire/montant par ligne (cas fréquent des nomenclatures Novamobili « ADA » et Metron, où seul le total apparaît). Dans ce cas, "lignes_detail" doit être un tableau VIDE [].
- "lignes_detail" : ne le remplis QUE si le devis est déjà au niveau « vendable » avec un prix par ligne (typiquement Granit Evolution : Plans de travail / Usinages / Services). Pour les nomenclatures de fabrication (Novamobili, Metron) qui détaillent des dizaines de micro-composants (recoupe, côté, porte, tablette… souvent à 0), NE LISTE PAS ces pièces : laisse "lignes_detail" vide et résume dans "produit_resume".
- "variante_prix" : sur un devis Granit Evolution, « PRO » = version magasin (mention « exclusivement destiné au magasin », émetteur = le fournisseur) ; « CLIENT » = version destinée au client final (émetteur = TANGUY Design, prix plus élevés). Si tu ne peux pas trancher, mets « INCONNU ».
- "tva_taux" : le taux figurant sur le devis fournisseur (peut être 10 % pour un fournisseur italien, 20 % pour Granit Evolution). C'est la TVA du fournisseur, informative ; la TVA du devis client sera recalculée en aval.
- "categorie_suggeree" : déduis du contenu (plans de travail → « Plan de travail » ; meubles/dressing/cuisine → « Meuble » ; etc.). Sert au mapping éco-participation en aval.
- Si un champ est absent, mets "" ou null ou [] selon le type — n'invente jamais une valeur.
- "pieces_eco_contribution" : liste des TABLETTES et PANNEAUX revêtus (avec décor) avec leurs DIMENSIONS, pour le calcul de l'éco-contribution. Cette liste est INDÉPENDANTE de "lignes_detail" : remplis-la même sur une nomenclature de fabrication (Novamobili, Metron) où les micro-composants ne doivent PAS apparaître dans lignes_detail. Ce sont deux usages différents — lignes_detail sert au prix, pieces_eco_contribution sert à la déclaration environnementale.
- Dimensions : "longueur_mm" = la plus grande dimension du plan de la pièce, "hauteur_mm" = la seconde (largeur/profondeur du panneau), toutes deux en MILLIMÈTRES (convertis depuis cm ou m si besoin ; « 180 × 30 cm » → 1800 et 300). Ne DEVINE JAMAIS une dimension absente : mets null. Une dimension inventée fausse la déclaration.
- "materiau" : déduis-le des mentions du devis (panneau mélaminé/aggloméré/MDF → « Panneaux de particules » ; chêne/hêtre/bois massif → « Bois massif » ; mention biosourcé/certifié → « Biosourcé »). Si rien ne permet de trancher, mets « Inconnu » — surtout pas une hypothèse.
- Si le devis ne comporte aucune tablette ni panneau, "pieces_eco_contribution" doit être un tableau VIDE [].
- Vérification finale obligatoire : si le descriptif contient des tablettes, côtés, diviseurs, fonds, dessus, bas ou portes en panneau, ces pièces doivent aussi figurer dans pieces_eco_contribution, avec leurs quantités et dimensions lues. Leurs prix masqués ne justifient JAMAIS un tableau éco vide. N'ajoute pas le module complet en plus de ses composants. Les dimensions absentes restent null.
- Retourne UNIQUEMENT le JSON.`;

/**
 * Parse un PDF de devis fournisseur et retourne l'objet structuré.
 * @param {Buffer} pdfBuffer - contenu binaire du PDF
 * @returns {Promise<object>}
 */
// Le texte plat perd l'association quantité/dimensions des colonnes de
// nomenclature, même avec beaucoup de caractères : ces PDF restent visuels.
// Le chemin texte est réservé aux devis commerciaux simples et entièrement lisibles.
async function contenuPdf(pdfBuffer, extraire) {
  try {
    const extract = extraire || require('unpdf').extractText;
    const { text } = await extract(new Uint8Array(pdfBuffer), { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const nomenclature = /novamobili|metron|modulnova|night collection|\b(?:codice|descrizione|q\.ta|tablette|panneau|diviseur|ripiano|fianco|nomenclature)\b/i.test(pages.join('\n'));
    if (!nomenclature && pages.length && pages.every(t => typeof t === 'string' && t.trim().length >= 100)) {
      return { mode: 'texte', bloc: { type: 'text', text: pages.map((t, i) => `PAGE ${i + 1}\n${t}`).join('\n\n') } };
    }
  } catch { /* PDF scanné, chiffré ou texte indisponible : lecture visuelle */ }
  return { mode: 'pdf', bloc: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } } };
}

function creerLecteur({ ia = completer, extraire, ttlMs = 10 * 60_000 } = {}) {
  const termines = new Map(), enCours = new Map();
  return async function lire(pdfBuffer) {
    const cle = createHash('sha256').update(pdfBuffer).digest('hex');
    if (termines.has(cle)) return { ...structuredClone(termines.get(cle)), lecture_reutilisee: true };
    if (enCours.has(cle)) return structuredClone(await enCours.get(cle));
    const travail = (async () => {
      const debut = Date.now();
      const contenu = await contenuPdf(pdfBuffer, extraire);
      const { texte, arret } = await ia({ niveau: 'standard', maxTokens: 14000, lectureLongue: true,
        system: SCHEMA_PROMPT,
        messages: [{ role: 'user', content: [contenu.bloc, { type: 'text', text: 'Extrais les données de ce document selon le schéma demandé.' }] }] });
      if (arret === 'max_tokens') throw new Error('Le document contient trop de détails pour une seule analyse. Fais vérifier ou scinder le document ; aucun devis n’a été créé.');
      const result = { ...extractJson(texte), lecture_mode: contenu.mode, lecture_ms: Date.now() - debut };
      if (termines.size >= 8) termines.delete(termines.keys().next().value);
      termines.set(cle, result);
      const timer = setTimeout(() => { if (termines.get(cle) === result) termines.delete(cle); }, ttlMs);
      timer.unref?.();
      return result;
    })();
    enCours.set(cle, travail);
    try { return structuredClone(await travail); } finally { enCours.delete(cle); }
  };
}
const parseDevisFournisseurPdf = creerLecteur();

/**
 * Extraction robuste du premier objet JSON d'une réponse texte.
 * Exporté pour les tests (sans appel réseau).
 * @param {string} text
 * @returns {object}
 */
function extractJson(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Réponse Claude sans JSON: ' + String(text).slice(0, 200));
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new Error('JSON invalide: ' + e.message + '\n' + String(text).slice(0, 500));
  }
}

module.exports = { parseDevisFournisseurPdf, extractJson, MODEL, SCHEMA_PROMPT, contenuPdf, creerLecteur };
