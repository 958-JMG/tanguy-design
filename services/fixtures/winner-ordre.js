'use strict';
// Données entièrement fictives. Le déroulé reproduit les cas structurels du PDF
// fourni le 06/11 : grands repères de meubles, puis 20, 15, et 2.1/4.2 à la fin.
const sections = [
  ['Meubles', ['1', '2', '3', '3.1', '4', '5', '6', '6.1', '7', '7.3', '8', '9', '9.3', '9.4', '10', '11', '11.1', '11.2', '11.3', '12', '13', '13.1', '14', '18', '19', '450', '451', '502', '503'], 'Atelier Test', 'Catalogue Test'],
  ['Plans de travail', ['20'], 'Pierre Test', ''],
  ['Panneaux de recouvrement', ['15'], 'Atelier Test', 'Catalogue Test'],
  ['Electroménager', ['16', '17', '23', '25'], 'Électro Test', 'Marque Électro'],
  ['Sanitaires', ['21', '22', '24'], 'Eau Test', 'Marque Eau'],
  ['Accessoires', ['2.1', '4.2'], 'Accessoires Test', 'Marque Accessoires'],
];
const lignes = sections.flatMap(([section, positions, fournisseur, marque]) => positions.map(position => ({
  position, position_parent: position.includes('.') ? position.split('.')[0] : '',
  section, categorie: section, fournisseur, marque,
  zone_nom: section === 'Meubles' && !position.includes('.') ? 'Cuisine test' : '',
  code_produit: position === '7.3' ? '' : `TEST-${position}`,
  designation: `Article fictif ${position}`, quantite: 1, unite: 'pce', montant_ht: position === '7.3' ? 0 : 100,
})));
module.exports = {
  client: {}, metadata: { numero_devis: 'TEST-WINNER-01' },
  zones: [{ ordre: 1, nom: 'Cuisine test', marque: 'Catalogue Test', modele: 'Modèle test' }],
  lignes, totaux: {}, echeances: [],
};
