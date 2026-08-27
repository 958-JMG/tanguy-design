/**
 * services/devis-express-helper.js — Devis client issu du Devis express (P-H4)
 *
 * Le Devis express partait d'un devis FOURNISSEUR (PDF), en déduisait un prix
 * client (coefficient de marge + éco-contribution)… et s'arrêtait là : le bouton
 * « Créer le devis client » était désactivé depuis l'origine. Ce helper porte la
 * construction du devis, en logique pure, pour qu'elle soit vérifiable sans
 * Airtable (ADR-004).
 *
 * COHÉRENCE DES TOTAUX — le point délicat. Un devis Tanguy alimente ensuite la
 * signature (bons de commande), les échéances et les brouillons Pennylane, qui
 * lisent tous les BASES DE TVA. Un devis créé sans elles produirait des factures
 * bancales bien plus tard, sans que rien ne le signale au moment de la création.
 * D'où le contrôle de cohérence renvoyé avec les champs.
 *
 * L'éco-contribution est DÉJÀ COMPRISE dans le prix client calculé par l'écran
 * (prix = total fournisseur × coefficient + éco-contribution). Elle est donc
 * reportée pour information dans « Eco-participation mobilier », et surtout PAS
 * ajoutée une seconde fois au total.
 */

const arrondi = n => Math.round(n * 100) / 100;

/**
 * Numéro séquentiel EXP-YYYY-NNN, sur le modèle des factures clients (FC-YYYY-NNN).
 * @param {string[]} numerosExistants - tous les numéros de devis déjà en base
 * @param {number|string} annee
 */
function numeroDevisExpress(numerosExistants, annee) {
  const an = String(annee);
  const prefixe = `EXP-${an}-`;
  // On prend le PLUS GRAND numéro existant, pas le nombre de devis : un devis
  // supprimé rendrait sinon un numéro déjà utilisé.
  const max = (numerosExistants || [])
    .map(n => String(n || ''))
    .filter(n => n.startsWith(prefixe))
    .map(n => parseInt(n.slice(prefixe.length), 10))
    .filter(Number.isFinite)
    .reduce((m, n) => Math.max(m, n), 0);
  return `${prefixe}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Champs du devis client à créer.
 * @param {object} p
 * @param {string} p.numero        - numéro du devis (cf. numeroDevisExpress)
 * @param {string} p.designation   - libellé de la ligne client
 * @param {number} p.prixClientHt  - prix client HT, éco-contribution COMPRISE
 * @param {number} p.tvaTaux       - taux de TVA en %, ex. 20
 * @param {number} [p.ecoHt]       - part éco-contribution comprise dans le prix
 * @param {string} [p.dateDevis]   - AAAA-MM-JJ ; obligatoire (aucune date « aujourd'hui »
 *                                   implicite : l'appelant la fournit, c'est testable)
 * @param {string} [p.origine]     - trace du devis fournisseur d'origine
 * @returns {{ fields:object, ligne:object, coherence:object, avertissements:string[] }}
 */
function construireDevisClient({ numero, designation, prixClientHt, tvaTaux, ecoHt = 0, dateDevis, origine = '' }) {
  const avertissements = [];
  const prix = Number(prixClientHt);
  const tva = Number(tvaTaux);
  const eco = Number(ecoHt) || 0;

  if (!Number.isFinite(prix) || prix <= 0) avertissements.push('Prix client HT absent ou nul');
  if (!Number.isFinite(tva) || tva < 0) avertissements.push('Taux de TVA absent');
  if (eco > prix) avertissements.push(`Éco-contribution (${eco} €) supérieure au prix client (${prix} €)`);

  const prixOk = Number.isFinite(prix) && prix > 0;
  const tvaOk = Number.isFinite(tva) && tva >= 0;

  // Part produit = prix client moins l'éco-contribution déjà comprise dedans.
  const totalArticles = prixOk ? arrondi(prix - Math.min(eco, prix)) : null;
  const totalHtFinal = prixOk ? arrondi(prix) : null;
  const tvaMontant = (prixOk && tvaOk) ? arrondi(prix * tva / 100) : null;
  const totalTtc = (prixOk && tvaOk) ? arrondi(prix + tvaMontant) : null;

  const fields = {
    'Numéro devis': numero,
    'Type devis': 'Principal',
    'Statut': 'Brouillon',
    'Date devis': dateDevis || null,
    'Total HT articles': totalArticles,
    'Total HT final': totalHtFinal,
    // Bases de TVA : lues par la signature, les échéances et Pennylane. Un devis
    // sans elles produit des factures bancales bien plus tard.
    'TVA taux 1 pourcentage': tvaOk ? tva : null,
    'TVA taux 1 base': totalHtFinal,
    'TVA taux 1 montant': tvaMontant,
    'Total TTC': totalTtc,
    ...(eco > 0 ? { 'Eco-participation mobilier': arrondi(eco) } : {}),
    'Notes internes': [
      'Devis créé depuis le Devis express.',
      origine ? `Devis fournisseur d'origine : ${origine}` : '',
      eco > 0 ? `Éco-contribution comprise dans le prix : ${arrondi(eco)} € HT` : '',
    ].filter(Boolean).join('\n'),
  };

  const ligne = {
    'Position': '1',
    'Désignation': designation || 'Prestation',
    'Quantité': 1,
    'Montant HT': totalHtFinal,
    'TVA pourcentage': tvaOk ? tva : null,
    ...(eco > 0 ? { 'Eco-participation': arrondi(eco) } : {}),
  };

  // Le TTC doit se retrouver à partir des bases — même garde-fou que sur les
  // factures Pennylane, appliqué dès la création.
  const recompute = (totalHtFinal != null && tvaMontant != null) ? arrondi(totalHtFinal + tvaMontant) : null;
  const coherence = {
    totalTtc,
    recompute,
    ok: totalTtc != null && recompute != null && Math.abs(totalTtc - recompute) < 0.01,
  };
  if (!coherence.ok) avertissements.push('Totaux incohérents : le TTC ne se retrouve pas depuis les bases de TVA');

  return { fields, ligne, coherence, avertissements };
}

/** Référence d'un projet créé à la volée depuis un chiffrage express. */
function referenceProjet(nomClient, designation) {
  const c = String(nomClient || '').trim();
  const d = String(designation || '').trim();
  return [c || 'Projet', d].filter(Boolean).join(' · ').slice(0, 100);
}

module.exports = { numeroDevisExpress, construireDevisClient, referenceProjet };
