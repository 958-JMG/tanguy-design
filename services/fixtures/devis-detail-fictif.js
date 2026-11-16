'use strict';
// Données entièrement fictives, sans identité ni document client.
module.exports = function documentFictif() {
  return { document: { numero: 'SOURCE-FICTIVE', date: '2026-11-01' }, produit_resume: 'Cuisine de démonstration',
    descriptif_complet: 'Finitions : gris fictif. Toutes les dimensions sont des exemples.',
    totaux: { total_ht: 900, total_ttc: 1080, tva_taux: 20, tva_montant: 180, eco_ht: 12, eco_incluse: true, remise_globale_ht: 112 },
    lignes_detail: [
      { section: 'Appareils', code_produit: 'APP-TEST', designation: 'Appareil de démonstration', quantite: 1, pu_ht: 800, remise_pct: 25, remise_ht: 200, total_ht: 600, categorie: 'Électroménager', tva_taux: 20 },
      { section: 'Meubles', code_produit: '0000123 + TEST-02 (×2)', designation: 'Meuble de démonstration, avec tous ses composants', quantite: 2, pu_ht: 200, total_ht: 400, categorie: 'Mobilier', tva_taux: 20 },
      { type: 'eco', designation: 'Éco-participation totale', quantite: 1, pu_ht: 12, total_ht: 12, tva_taux: 20 },
    ] };
};
