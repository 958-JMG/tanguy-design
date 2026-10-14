'use strict';
// ────────────────────────────────────────────────────────────────────────────
// services/devis-electro.js — Devis express ÉLECTROMÉNAGER (projets FINDIS)
//
// Demande JMG (14/10/2026) : l'électroménager s'achète chez un grossiste
// (FINDIS) qui donne, article par article, le PRIX DE VENTE TTC, le PRIX
// D'ACHAT HT (et parfois un prix PROMO plus bas) et l'ÉCO-PARTICIPATION HT.
// On lit la page « Projet » FINDIS (PDF imprimé ou captures d'écran), on
// retient les articles choisis, et on en fait :
//   - un devis client Tanguy (une ligne par article) → Pennylane : vente + éco
//     hors chiffre d'affaires, par la chaîne existante ;
//   - le prix d'achat sur chaque ligne → marge de la partie électroménager.
//
// Ce que montrent les 6 projets réels étudiés (35449, 35658, 35757, 35789,
// 35859, 32470) :
//   - Un projet est souvent un COMPARATIF (3 fours, 3 réfrigérateurs…) : rien
//     n'est retenu sans que quelqu'un l'ait coché, et les doublons de type sont
//     signalés.
//   - « Article remplacé par la référence … » : aucun prix → non sélectionnable.
//   - « Promo : … € HT » (environ un article sur trois) : c'est le prix payé.
//   - « [Hors Tarif] », « Sur commande », « Délai : … » : gardés en note.
//
// Module PUR (aucun réseau, aucune dépendance Airtable) → testable seul. La
// lecture du document (Claude) vit dans services/findis-parser.js.
// ────────────────────────────────────────────────────────────────────────────

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Nombre au format FINDIS / français → Number. « 1 166,56 € HT » → 1166.56.
 * Accepte un nombre déjà numérique. Renvoie null si rien d'exploitable.
 */
function nombreFr(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/[  \s]/g, '')   // espaces, insécables, fines insécables
    .replace(/€|HT|TTC/gi, '')
    .replace(/,(?=\d{1,2}$)/, '.')        // virgule décimale finale
    .replace(/,/g, '');                   // séparateurs de milliers éventuels
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Famille Tanguy d'un article FINDIS. Lue sur le TYPE FINDIS (« Mitigeur sans
// douchette », « Four encastrable »…) et le libellé — jamais sur la description,
// où « Eclairage LED » ferait passer un réfrigérateur pour un luminaire.
// Les valeurs sont celles du champ « Catégorie » des lignes de devis, que la
// signature route ensuite (services/fournisseur-grille.js).
const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function familleFindis(typeFindis, libelle) {
  const n = normalize(`${typeFindis || ''} ${libelle || ''}`);
  if (/mitigeur|robinet|douchette|evier|cuve|bonde/.test(n)) return 'Robinetterie';
  if (/luminaire|applique|suspension|spot|reglette|bandeau led/.test(n)) return 'Luminaire';
  return 'Électroménager';
}

/**
 * Articles lus (sortie brute du lecteur) → articles normalisés, contrôlés.
 * @param {object} lu - { articles: [{ source, type_findis, marque, libelle, reference,
 *        hors_tarif, quantite, prix_public_ttc, prix_vente_ttc, prix_achat_ht,
 *        promo_ht, eco_part_ht, stock, cde, delai, sur_commande, remplace_par }] }
 * @param {{ nbFichiers?: number }} [opts]
 * @returns {{ articles: Array, alertes: string[], comparatifs: Array }}
 */
function normaliserArticles(lu, { nbFichiers = 1 } = {}) {
  const alertes = [];
  const bruts = Array.isArray(lu && lu.articles) ? lu.articles : [];
  const articles = [];
  const vus = new Map(); // empreinte → article (dédoublonnage entre captures)

  for (const a of bruts) {
    const reference = String(a.reference || '').trim();
    const libelle = String(a.libelle || '').trim();
    const marque = String(a.marque || '').trim();
    const typeFindis = String(a.type_findis || '').trim();
    const quantite = Math.max(1, Math.round(nombreFr(a.quantite) || 1));
    const venteTtcUnit = nombreFr(a.prix_vente_ttc);
    const achatHtUnit = nombreFr(a.prix_achat_ht);
    const promoHtUnit = nombreFr(a.promo_ht);
    const ecoHtUnit = nombreFr(a.eco_part_ht);
    const source = Number.isInteger(a.source) ? a.source : 0;

    // Même article sur deux captures qui se chevauchent : compté UNE fois, et dit.
    // Dans un même fichier, deux lignes identiques restent deux lignes (signalées).
    const empreinte = [reference || libelle, venteTtcUnit, achatHtUnit, promoHtUnit, quantite].join('|');
    const deja = vus.get(empreinte);
    if (deja && deja.source !== source && nbFichiers > 1) {
      alertes.push(`« ${marque} ${reference || libelle} » lu sur deux captures : compté une fois.`);
      continue;
    }

    const notes = [];
    const raisons = [];
    if (a.remplace_par) raisons.push(`Article remplacé par la référence ${String(a.remplace_par).trim()} : aucun prix sur FINDIS`);
    if (!(venteTtcUnit > 0) && !a.remplace_par) raisons.push('Prix de vente absent');
    if (!(achatHtUnit > 0) && !(promoHtUnit > 0) && !a.remplace_par) raisons.push('Prix d\'achat absent');
    if (a.hors_tarif) notes.push('Hors tarif FINDIS');
    if (a.sur_commande) notes.push('Sur commande');
    if (a.delai) notes.push(`Délai : ${String(a.delai).trim()}`);
    if (a.stock != null || a.cde != null) notes.push(`Stock ${a.stock ?? '—'} / Cde ${a.cde ?? '—'}`);

    const promoRetenue = promoHtUnit > 0 && (!(achatHtUnit > 0) || promoHtUnit <= achatHtUnit);
    if (promoHtUnit > 0 && achatHtUnit > 0 && promoHtUnit > achatHtUnit) {
      notes.push(`Promo (${promoHtUnit}) supérieure au prix d'achat (${achatHtUnit}) : prix d'achat retenu`);
    }
    const achatRetenuHtUnit = promoRetenue ? promoHtUnit : (achatHtUnit > 0 ? achatHtUnit : null);
    if (ecoHtUnit == null && !a.remplace_par) notes.push('Éco-participation non lue : 0 retenu');

    const art = {
      id: articles.length,
      source,
      typeFindis, marque, libelle, reference,
      horsTarif: !!a.hors_tarif,
      quantite,
      prixPublicTtc: nombreFr(a.prix_public_ttc),
      venteTtcUnit,
      achatHtUnit,
      promoHtUnit: promoHtUnit > 0 ? promoHtUnit : null,
      promoRetenue,
      achatRetenuHtUnit,
      ecoHtUnit: ecoHtUnit != null ? ecoHtUnit : 0,
      famille: familleFindis(typeFindis, libelle),
      notes,
      selectionnable: raisons.length === 0,
      raisonNonSelectionnable: raisons.join(' · ') || null,
    };
    articles.push(art);
    vus.set(empreinte, art);
  }

  // Comparatifs : plusieurs appareils de même NATURE (premier mot du type FINDIS :
  // « Réfrigérateur intégrable » et « Réfrigérateur intégrable combiné » sont deux
  // réfrigérateurs) → c'est un choix à faire, rien n'est coché d'office.
  const parType = new Map();
  for (const a of articles) {
    if (!a.selectionnable || !a.typeFindis) continue;
    const mot = a.typeFindis.trim().split(/\s+/)[0];
    const k = normalize(mot);
    if (!parType.has(k)) parType.set(k, { type: mot, ids: [] });
    parType.get(k).ids.push(a.id);
  }
  const comparatifs = [...parType.values()].filter(g => g.ids.length > 1);
  if (!articles.length) alertes.push('Aucun article lu sur ce document.');
  return { articles, alertes, comparatifs };
}

/**
 * Montants d'une ligne (prix unitaires × quantité) pour un taux de TVA.
 * Vente HT « éco comprise » = vente TTC / (1 + TVA) ; l'éco est comprise dans le
 * prix public (« dont »), on la sort pour la marge : elle est reversée.
 */
function montantsLigne(a, tvaPct) {
  const t = Number(tvaPct) / 100;
  const q = Number(a.quantite) || 1;
  const venteTtc = round2((Number(a.venteTtcUnit) || 0) * q);
  const venteHt = round2(venteTtc / (1 + t));
  const ecoHt = round2((Number(a.ecoHtUnit) || 0) * q);
  const venteHtHorsEco = round2(venteHt - ecoHt);
  const achatHt = round2((Number(a.achatRetenuHtUnit) || 0) * q);
  const marge = round2(venteHtHorsEco - achatHt);
  const margePct = venteHtHorsEco > 0 ? round2((marge / venteHtHorsEco) * 100) : null;
  return { venteTtc, venteHt, ecoHt, venteHtHorsEco, achatHt, marge, margePct };
}

/**
 * Totaux par famille et global des articles retenus. Calculés sur les SOMMES
 * (TTC, éco, achat) puis convertis, comme le devis lui-même (Total HT final =
 * TTC / (1 + TVA)) : la marge annoncée est celle du devis, au centime.
 */
function totauxArticles(articles, tvaPct) {
  const t = Number(tvaPct) / 100;
  const acc = () => ({ venteTtc: 0, ecoHt: 0, achatHt: 0, nb: 0 });
  const global = acc();
  const parFamille = {};
  for (const a of articles || []) {
    const m = montantsLigne(a, tvaPct);
    for (const cible of [global, (parFamille[a.famille] ||= acc())]) {
      cible.venteTtc = round2(cible.venteTtc + m.venteTtc);
      cible.ecoHt = round2(cible.ecoHt + m.ecoHt);
      cible.achatHt = round2(cible.achatHt + m.achatHt);
      cible.nb += 1;
    }
  }
  const fin = o => {
    const venteHt = round2(o.venteTtc / (1 + t));
    const venteHtHorsEco = round2(venteHt - o.ecoHt);
    const marge = round2(venteHtHorsEco - o.achatHt);
    return { ...o, venteHt, venteHtHorsEco, marge, margePct: venteHtHorsEco > 0 ? round2((marge / venteHtHorsEco) * 100) : null };
  };
  const pf = {};
  for (const [k, v] of Object.entries(parFamille)) pf[k] = fin(v);
  return { global: fin(global), parFamille: pf };
}

/**
 * Champs du devis client Tanguy + ses lignes, depuis les articles RETENUS.
 * Totaux calculés depuis les BASES DE TVA (comme le Devis express fournisseur) :
 * signature, échéances et Pennylane les relisent ; on refuse un devis incohérent.
 *
 * @param {object} p
 * @param {string} p.numero
 * @param {Array}  p.articles      - articles normalisés retenus (éventuellement corrigés à l'écran)
 * @param {number} p.tvaTaux       - en %, ex. 20
 * @param {string} p.dateDevis     - AAAA-MM-JJ (fourni par l'appelant)
 * @param {'Principal'|'Additif'} [p.typeDevis]
 * @param {string} [p.projetFindis] - n° de projet FINDIS (traçabilité)
 * @param {string|null} [p.fournisseurId] - fiche Fournisseurs « Findis »
 * @returns {{ fields, lignes, coherence, avertissements, totaux }}
 */
function construireDevisElectro({ numero, articles, tvaTaux, dateDevis, typeDevis = 'Principal', projetFindis = '', fournisseurId = null }) {
  const avertissements = [];
  const tva = Number(tvaTaux);
  const tvaOk = Number.isFinite(tva) && tva >= 0;
  if (!tvaOk) avertissements.push('Taux de TVA absent');
  const retenus = (articles || []).filter(a => a && Number(a.venteTtcUnit) > 0);
  if (retenus.length !== (articles || []).length) avertissements.push(`${(articles || []).length - retenus.length} article(s) sans prix de vente écarté(s)`);
  if (!retenus.length) avertissements.push('Aucun article retenu');

  const t = tvaOk ? tva : 20;
  const ml = retenus.map(a => ({ a, m: montantsLigne(a, t) }));
  const totalTtcArticles = round2(ml.reduce((s, x) => s + x.m.venteTtc, 0));
  const totalHtFinal = round2(totalTtcArticles / (1 + t / 100));
  const tvaMontant = round2(totalHtFinal * t / 100);
  const totalTtc = round2(totalHtFinal + tvaMontant);
  const ecoHt = round2(ml.reduce((s, x) => s + x.m.ecoHt, 0));
  const achatHt = round2(ml.reduce((s, x) => s + x.m.achatHt, 0));
  if (totalTtc !== totalTtcArticles) {
    avertissements.push(`Arrondi de TVA : total TTC ${totalTtc} € pour ${totalTtcArticles} € de prix FINDIS (écart ${round2(totalTtc - totalTtcArticles)} €)`);
  }

  // Lignes : « Montant HT » HORS éco + « Eco-participation » HT, comme les lignes
  // Winner (Montant + éco = coût final). La dernière ligne absorbe l'arrondi pour
  // que la somme retombe exactement sur le Total HT final du devis.
  const lignes = ml.map(({ a, m }, i) => {
    const desig = [a.marque, a.libelle].filter(Boolean).join(' ') || a.typeFindis || 'Article';
    // Le type FINDIS en 2e ligne seulement s'il apporte quelque chose : « Piano de
    // cuisson induction » répété sous « SMEG Piano de cuisson induction », non.
    const typeUtile = a.typeFindis && !normalize(desig).includes(normalize(a.typeFindis));
    return {
      'Position': String(i + 1),
      'Catégorie': a.famille,
      'Code produit': a.reference || '',
      'Désignation': `${desig}${typeUtile ? `\n${a.typeFindis}` : ''}`,
      'Quantité': Number(a.quantite) || 1,
      'Unité': 'pce',
      'TVA pourcentage': t,
      'Montant HT': m.venteHtHorsEco,
      'Eco-participation': m.ecoHt,
      'Prix achat HT': m.achatHt,
      ...(fournisseurId ? { 'Fournisseur': [fournisseurId] } : {}),
      'Notes': [
        a.promoRetenue ? `Promo FINDIS retenue : ${a.promoHtUnit} € HT (au lieu de ${a.achatHtUnit} € HT)` : '',
        ...(a.notes || []),
      ].filter(Boolean).join(' · '),
    };
  });
  const sommeLignes = round2(lignes.reduce((s, l) => s + l['Montant HT'] + l['Eco-participation'], 0));
  const residu = round2(totalHtFinal - sommeLignes);
  if (lignes.length && residu !== 0) lignes[lignes.length - 1]['Montant HT'] = round2(lignes[lignes.length - 1]['Montant HT'] + residu);
  const totalArticles = round2(lignes.reduce((s, l) => s + l['Montant HT'], 0));

  const totaux = totauxArticles(retenus, t);
  const fmt = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fields = {
    'Numéro devis': numero,
    'Type devis': typeDevis === 'Additif' ? 'Additif' : 'Principal',
    'Statut': 'Brouillon',
    'Date devis': dateDevis || null,
    'Total HT articles': totalArticles,
    'Total HT après remise': totalArticles,
    'Eco-participation électroménager': ecoHt,
    'Total HT final': totalHtFinal,
    'TVA taux 1 pourcentage': t,
    'TVA taux 1 base': totalHtFinal,
    'TVA taux 1 montant': tvaMontant,
    'Total TTC': totalTtc,
    // « dont éco » TTC : lu par le brouillon Pennylane (ligne hors CA, compte 70811).
    ...(ecoHt > 0 ? { 'Éco-participation': round2(ecoHt * (1 + t / 100)) } : {}),
    'Notes internes': [
      'Devis créé depuis le Devis express électroménager (FINDIS).',
      projetFindis ? `Projet FINDIS n° ${projetFindis}.` : '',
      `Achat : ${fmt(achatHt)} € HT + éco ${fmt(ecoHt)} € HT · marge prévue ${fmt(totaux.global.marge)} € HT${totaux.global.margePct != null ? ` (${String(totaux.global.margePct).replace('.', ',')} %)` : ''}.`,
    ].filter(Boolean).join('\n'),
  };

  const recompute = round2(totalHtFinal + tvaMontant);
  const coherence = { totalTtc, recompute, ok: retenus.length > 0 && Math.abs(totalTtc - recompute) < 0.01 && round2(totalArticles + ecoHt) === totalHtFinal };
  if (!coherence.ok && retenus.length) avertissements.push('Totaux incohérents : lignes et bases de TVA ne se retrouvent pas');
  return { fields, lignes, coherence, avertissements, totaux };
}

module.exports = {
  nombreFr, familleFindis, normaliserArticles, montantsLigne, totauxArticles, construireDevisElectro,
};
