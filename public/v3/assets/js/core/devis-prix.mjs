// Montant du document = vente HT. L'éco est comptée une seule fois, sans coefficient.
export function calculPrixImport({ montantDocumentHt, ecoHt = 0, ecoIncluse } = {}) {
  const montant = Number(montantDocumentHt), eco = Number(ecoHt);
  if (!Number.isFinite(montant) || montant <= 0) throw new Error('Le prix de vente HT du document doit être positif.');
  if (!Number.isFinite(eco) || eco < 0) throw new Error('Éco-participation HT invalide.');
  if (eco > 0 && typeof ecoIncluse !== 'boolean') throw new Error('Précise si l’éco-participation est déjà incluse dans le montant du document.');
  if (ecoIncluse && eco > montant) throw new Error('L’éco-participation incluse dépasse le montant du document.');
  const arrondi = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const prixClientHt = arrondi(montant + (ecoIncluse ? 0 : eco));
  return { prixClientHt, horsEcoHt: arrondi(prixClientHt - eco), ecoHt: arrondi(eco) };
}
