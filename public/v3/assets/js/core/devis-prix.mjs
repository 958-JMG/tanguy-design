// Montant du document = vente HT. L'éco est comptée une seule fois, sans coefficient.
export function calculPrixImport({ montantDocumentHt, ecoHt = 0, ecoIncluse } = {}) {
  const refuser = (message, champ) => { const e = new Error(message); e.champ = champ; throw e; };
  const montant = Number(montantDocumentHt), eco = Number(ecoHt);
  if (!Number.isFinite(montant) || montant <= 0) refuser('Le prix de vente HT du document doit être positif.', 'montantDocumentHt');
  if (!Number.isFinite(eco) || eco < 0) refuser('Éco-participation HT invalide.', 'ecoHt');
  if (eco > 0 && typeof ecoIncluse !== 'boolean') refuser('Précise si l’éco-participation est déjà incluse dans le montant du document.', 'ecoIncluse');
  if (ecoIncluse && eco > montant) refuser('L’éco-participation incluse dépasse le montant du document.', 'ecoHt');
  const arrondi = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const prixClientHt = arrondi(montant + (ecoIncluse ? 0 : eco));
  return { prixClientHt, horsEcoHt: arrondi(prixClientHt - eco), ecoHt: arrondi(eco) };
}
