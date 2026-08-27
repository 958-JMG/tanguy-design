/**
 * services/description-devis-helper.js — Descriptif commercial d'un devis
 *
 * Le devis Tanguy n'a pas de champ « Description » : ce qui décrit l'affaire vit
 * sur la ZONE (marque, modèle, coloris, finitions, gorges…). Ce descriptif était
 * déjà assemblé à la signature pour remplir « Modèle choisi » / « Détails modèle »
 * du bon de commande ; il est désormais partagé, pour que le BC et la facture
 * Pennylane racontent la MÊME chose.
 *
 * Demande JMG (27/08/2026) : sur les factures Pennylane, le libellé produit doit
 * rester constant (« Produit cuisine ») et c'est la DESCRIPTION qui doit reprendre
 * celle du devis — aujourd'hui elle n'est reprise nulle part.
 *
 * Logique PURE, testable sans Airtable (ADR-004) : on passe les `fields` des zones.
 */

// Ordre d'affichage : identique à celui du bon de commande, pour que les deux
// documents se lisent pareil.
const CHAMPS_DETAIL = [
  ['Modularité', 'Modularité'],
  ['Exécution façade', 'Exécution façade'],
  ['Coloris façade', 'Coloris façade'],
  ['Chant façade', 'Chant façade'],
  ['Coloris caisson', 'Coloris caisson'],
  ['Exécution côté finition', 'Exécution côté finition'],
  ['Coloris côté finition', 'Coloris côté finition'],
  ['Type de gorge', 'Type de gorge'],
  ['Exécution gorges', 'Exécution gorges'],
  ['Finition gorges', 'Finition gorges'],
  ['Profondeur', 'Profondeur'],
  ['Option ouverture', 'Option ouverture'],
  ['Finition socle', 'Finition socle'],
];

/** Zone principale = plus petit « Ordre ». Accepte des records Airtable ou des fields. */
function zonePrincipale(zones) {
  const list = (zones || []).map(z => (z && z.fields) ? { ...z.fields, _id: z.id } : z).filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => (a.Ordre ?? 999) - (b.Ordre ?? 999))[0];
}

/** Titre court : « Marque — Modèle ». */
function titreZone(z) {
  if (!z) return '';
  return [z['Marque'], z['Modèle']].filter(Boolean).join(' — ');
}

/** Lignes de détail « Libellé : valeur », dans l'ordre du bon de commande. */
function detailsZone(z) {
  if (!z) return [];
  return CHAMPS_DETAIL
    .filter(([champ]) => z[champ] != null && String(z[champ]).trim() !== '')
    .map(([champ, libelle]) => `${libelle} : ${String(z[champ]).trim()}`);
}

/**
 * Descriptif complet d'un devis.
 * @param {Array} zones - zones du devis (records Airtable ou fields)
 * @param {{ separateur?: string, maxLongueur?: number }} [opts]
 * @returns {{ titre:string, details:string[], texte:string, vide:boolean }}
 *          `vide` = aucun descriptif exploitable → l'appelant doit le DIRE
 *          plutôt que d'envoyer une description blanche sans prévenir.
 */
function descriptionDevis(zones, { separateur = '\n', maxLongueur = null } = {}) {
  const z = zonePrincipale(zones);
  const titre = titreZone(z);
  const details = detailsZone(z);
  let texte = [titre, ...details].filter(Boolean).join(separateur);
  if (maxLongueur && texte.length > maxLongueur) {
    texte = texte.slice(0, Math.max(0, maxLongueur - 1)).trimEnd() + '…';
  }
  return { titre, details, texte, vide: texte.trim() === '' };
}

/** Variante d'une seule ligne (pour un libellé ou un sujet de mail). */
function descriptionCourte(zones, maxLongueur = 120) {
  return descriptionDevis(zones, { separateur: ' · ', maxLongueur }).texte;
}

module.exports = { CHAMPS_DETAIL, zonePrincipale, titreZone, detailsZone, descriptionDevis, descriptionCourte };
