/**
 * services/couts-helper.js — Coûts additionnels de chantier + retenue client
 *
 * Chantier « Coûts chantier & retenue » (paquet 1, 2026-08).
 *
 * Deux besoins métier récurrents non couverts jusqu'ici (dossiers GUERRIER,
 * CHARTIN, MORALES, DUPUY) :
 *
 *  1. Coûts ADDITIONNELS non prévus au devis : SAV / reprise (ex. peintre 250 €),
 *     transport / livraison (ex. 350 €), commandes complémentaires (oublis),
 *     frais divers. Aujourd'hui seule une commande fournisseur avec « Montant AR »
 *     alimente le coût réel → aucun endroit propre pour ces frais.
 *
 *  2. Retenue client : le client conserve une somme en fin de chantier
 *     (ex. GUERRIER 500 € le temps d'un SAV). Ce n'est PAS un impayé classique.
 *
 * Règle comptable pro appliquée ici : ce qui compte pour la MARGE, c'est QUI
 * supporte le coût.
 *   - « Tanguy (sur marge) »  → erreur/aléa interne (poseur qui abîme, oubli
 *     Solène non refacturé). Ampute la marge de Tanguy. C'est l'« impact des
 *     erreurs » que JMG veut voir.
 *   - « Refacturé client »    → répercuté au client (avenant / devis additif).
 *     Décaissé par Tanguy mais recouvré → neutre sur la marge.
 *
 * Retenue :
 *   - « En cours »          → argent DÛ, pas perdu. N'ampute pas la marge, mais
 *     s'affiche en « reste à encaisser ». Cadre : retenue de garantie légale
 *     (loi n° 71-584 du 16/07/1971, plafond 5 %, levée à 1 an sauf réserves,
 *     remplaçable par caution) OU retenue conservatoire liée à des réserves /
 *     SAV (garantie de parfait achèvement, art. 1792-6 du Code civil).
 *   - « Levée / encaissée »  → soldée, neutre.
 *   - « Abandonnée »         → le client ne paiera pas → perte sèche → ampute la
 *     marge (geste commercial définitif).
 *
 * Logique PURE, testable sans Airtable (ADR-004). Les routes normalisent les
 * records Airtable en objets simples avant d'appeler ici.
 */

// Valeurs de référence (dupliquées côté front v3 — CJS non importable en ESM).
const COUT_TYPES = ['SAV / reprise', 'Transport / livraison', 'Complément commande', 'Frais divers'];
const COUT_IMPUTATIONS = ['Tanguy (sur marge)', 'Refacturé client'];
const COUT_STATUTS = ['Prévu', 'Engagé', 'Payé'];

const RETENUE_TYPES = ['Retenue de garantie (loi 1971)', 'Retenue SAV / réserves', 'Autre'];
const RETENUE_STATUTS = ['En cours', 'Levée / encaissée', 'Abandonnée'];

/** Nombre sûr : convertit en Number fini, sinon 0. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Agrège une liste de coûts additionnels.
 * @param {Array<{montant:number, imputation?:string, type?:string, statut?:string}>} couts
 * @returns {{total:number, surMarge:number, refactureClient:number, parType:Object, count:number}}
 */
function sumCouts(couts) {
  const list = Array.isArray(couts) ? couts : [];
  let total = 0, surMarge = 0, refactureClient = 0;
  const parType = {};
  for (const c of list) {
    const m = num(c && c.montant);
    total += m;
    if ((c && c.imputation) === 'Refacturé client') refactureClient += m;
    else surMarge += m; // défaut prudent : sans imputation explicite → sur la marge Tanguy
    const t = (c && c.type) || 'Autre';
    parType[t] = num(parType[t]) + m;
  }
  return { total, surMarge, refactureClient, parType, count: list.length };
}

/**
 * Part d'une retenue qui ampute la marge (uniquement si abandonnée = perte sèche).
 * @param {{montant?:number, statut?:string}|null} retenue
 */
function retenuePerte(retenue) {
  if (!retenue) return 0;
  return retenue.statut === 'Abandonnée' ? num(retenue.montant) : 0;
}

/**
 * Montant encore à récupérer auprès du client au titre d'une retenue en cours.
 * @param {{montant?:number, statut?:string}|null} retenue
 */
function retenueResteAEncaisser(retenue) {
  if (!retenue) return 0;
  return retenue.statut === 'En cours' ? num(retenue.montant) : 0;
}

/**
 * Marge chantier intégrant coûts additionnels + retenue.
 *
 * Reprend la formule historique (caHT - coutFourn + rétro artisans) puis :
 *   - retranche les coûts imputés « Tanguy (sur marge) »,
 *   - retranche une retenue ABANDONNÉE (perte sèche),
 *   - laisse une retenue « En cours » hors marge (juste « reste à encaisser »).
 *
 * @param {{caHT:number, coutFourn:number, retro?:number, couts?:Array, retenue?:Object|null}} p
 * @returns {{margeAbs:number, margePct:number|null, coutReelChantier:number,
 *            coutsSurMarge:number, coutsRefactures:number, resteAEncaisser:number,
 *            retenuePerte:number}}
 */
function computeMarge({ caHT, coutFourn, retro = 0, couts = [], retenue = null }) {
  const ca = num(caHT);
  const cf = num(coutFourn);
  const rt = num(retro);
  const agg = sumCouts(couts);
  const perte = retenuePerte(retenue);

  const margeAbs = ca - cf + rt - agg.surMarge - perte;
  const margePct = ca > 0 ? (margeAbs / ca) * 100 : null;

  return {
    margeAbs,
    margePct,
    // Coût réellement supporté par Tanguy = fournisseurs confirmés + coûts sur marge.
    coutReelChantier: cf + agg.surMarge,
    coutsSurMarge: agg.surMarge,
    coutsRefactures: agg.refactureClient,
    resteAEncaisser: retenueResteAEncaisser(retenue),
    retenuePerte: perte,
  };
}

/**
 * Date de levée prévue d'une retenue. Pour une retenue de garantie (loi 1971),
 * défaut = date + 1 an (délai de la garantie de parfait achèvement). Sinon null.
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} type l'un de RETENUE_TYPES
 * @returns {string|null} YYYY-MM-DD
 */
function leveePrevue(dateStr, type) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  if (type !== 'Retenue de garantie (loi 1971)') return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  COUT_TYPES, COUT_IMPUTATIONS, COUT_STATUTS, RETENUE_TYPES, RETENUE_STATUTS,
  num, sumCouts, retenuePerte, retenueResteAEncaisser, computeMarge, leveePrevue,
};
