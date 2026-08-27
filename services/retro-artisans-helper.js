/**
 * services/retro-artisans-helper.js — Rétro-commission 5 % sur les devis artisans
 *
 * RÈGLE UNIQUE, décidée le 29/07/2026 (PR #81) : la rétro de 5 % s'applique à
 * TOUS les devis artisans. Le filtre « artisan contractuel » a été retiré du
 * calcul — le champ Contractuel reste une information de contrat, pas une règle
 * de facturation.
 *
 * POURQUOI CE FICHIER (27/08/2026) : la règle n'avait été corrigée qu'à un seul
 * endroit. La fiche projet appliquait bien les 5 % à tous les devis, mais
 * l'écran admin des marges continuait de ne compter que les artisans
 * contractuels — deux écrans, deux marges différentes pour le même chantier,
 * sans que rien ne le signale. Trois divergences en tout :
 *   1. le filtre « Contractuel » (marge admin sous-estimée) ;
 *   2. l'absence de déduplication (un devis importé deux fois comptait double) ;
 *   3. le recalcul à 5 % au lieu de lire « Rétro-commission HT », que l'import
 *      stocke déjà — un montant négocié différemment était donc ignoré.
 *
 * Tout passe désormais par ici, pour que la règle n'ait plus qu'un seul endroit
 * où être juste.
 *
 * Logique PURE, testable sans Airtable (ADR-004).
 */

const TAUX_RETRO = 0.05;

/**
 * Déduplication des devis artisans (règle P-B du 24/06/2026) : un même devis
 * (même numéro ET même montant) a parfois été importé plusieurs fois. Les
 * numéros vides ou générés (« AUTO-… ») ne sont JAMAIS dédupliqués entre eux :
 * deux devis sans numéro sont deux devis distincts, pas un doublon.
 */
function dedupliquerDevisArtisans(devisArtisans) {
  const vus = new Set();
  return (devisArtisans || []).filter(d => {
    const f = d.fields || d;
    const numero = String(f['Numéro devis'] || '').trim();
    const montant = f['Montant HT'] || 0;
    const cle = (!numero || numero.startsWith('AUTO-')) ? `id:${d.id ?? Math.random()}` : `${numero}|${montant}`;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/**
 * Rétro d'UN devis artisan. Priorité au montant stocké par l'import
 * (« Rétro-commission HT ») : il peut différer de 5 % si la commission a été
 * négociée autrement. À défaut seulement, 5 % du montant HT.
 */
function retroDevis(devisArtisan) {
  const f = (devisArtisan && devisArtisan.fields) || devisArtisan || {};
  const stockee = f['Rétro-commission HT'];
  if (stockee != null && Number.isFinite(Number(stockee))) return Number(stockee);
  return (Number(f['Montant HT']) || 0) * TAUX_RETRO;
}

/**
 * Rétro totale d'un ensemble de devis artisans (déduplication comprise).
 * @param {Array} devisArtisans - records Airtable ou fields
 * @returns {{ total:number, devisRetenus:number, devisIgnores:number }}
 *          `devisIgnores` = doublons écartés, remonté pour que l'écran puisse
 *          le dire au lieu d'escamoter la différence.
 */
function retroTotale(devisArtisans) {
  const liste = devisArtisans || [];
  const uniques = dedupliquerDevisArtisans(liste);
  const total = uniques.reduce((s, d) => s + retroDevis(d), 0);
  return {
    total: Math.round(total * 100) / 100,
    devisRetenus: uniques.length,
    devisIgnores: liste.length - uniques.length,
  };
}

module.exports = { TAUX_RETRO, dedupliquerDevisArtisans, retroDevis, retroTotale };
