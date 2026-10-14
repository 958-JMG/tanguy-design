/**
 * Tests services/commande-bc.js — node --test natif.
 *
 * Cas réel servant de modèle : devis 650/1/1 (meuble LAGO, 14/10/2026). Ses 3
 * lignes, classées « Divers » à l'import, ne sont dans aucun BC ; le seul BC de la
 * signature était « Plan de travail », vide par conception (« Lignes BC » = "[]").
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  lignesSansCommande, prochainIndexBc, numeroBc, dateEnvoiDepuisPose,
  modeleDepuisZone, champsCommande, lignesBcStructurees, buildBcTableau,
} = require('./commande-bc');

const L = (id, Position, code, Catégorie, montant, extra = {}) =>
  ({ id, fields: { Position, 'Code produit': code, Catégorie, 'Désignation': `LAGO - ${code || 'article'}`, 'Montant HT': montant, Quantité: 1, Unité: 'pce', ...extra } });

// Forme réelle du devis 650/1/1 (positions, codes, catégories, montants).
const LIGNES_650 = [
  L('recL1', '1', undefined, 'Divers', 45),
  L('recL2', '2', 'TEB207R', 'Divers', 733),
  L('recL3', '3', 'TER7103', 'Divers', 23),
];

describe('lignesSansCommande()', () => {
  test('devis 650/1/1 : BC « Plan de travail » vide → les 3 lignes Divers sont sans commande', () => {
    const r = lignesSansCommande(LIGNES_650, ['[]']);
    assert.deepEqual(r.lignes.map(l => l.id), ['recL1', 'recL2', 'recL3']);
    assert.equal(r.bcIllisibles, 0);
    assert.equal(r.bcSansListe, 0);
    for (const l of r.lignes) {
      assert.equal(l.famille, 'Divers');
      assert.equal(l.commandeAuto, false, 'Divers : pas de BC automatique à la signature');
      assert.match(l.raison, /Divers/);
    }
  });

  test('une ligne portée par un BC (position + code) n\'est plus listée', () => {
    const bc = JSON.stringify([{ pos: '2', code: 'TEB207R', description: 'x' }]);
    const r = lignesSansCommande(LIGNES_650, ['[]', bc]);
    assert.deepEqual(r.lignes.map(l => l.id), ['recL1', 'recL3']);
  });

  test('ligne sans code : reconnue par sa position seule', () => {
    const bc = JSON.stringify([{ pos: '1', code: '' }]);
    const r = lignesSansCommande(LIGNES_650, [bc]);
    assert.deepEqual(r.lignes.map(l => l.id), ['recL2', 'recL3']);
  });

  test('même position, autre code : ce n\'est PAS la même ligne', () => {
    const bc = JSON.stringify([{ pos: '2', code: 'AUTRE' }]);
    const r = lignesSansCommande(LIGNES_650, [bc]);
    assert.ok(r.lignes.some(l => l.id === 'recL2'));
  });

  test('BC illisible ou sans liste : compté et dit, jamais pris pour « tout est commandé »', () => {
    const r = lignesSansCommande(LIGNES_650, ['{pas du json', undefined, '{"pos":"1"}']);
    assert.equal(r.bcIllisibles, 2, 'JSON invalide + JSON qui n\'est pas une liste');
    assert.equal(r.bcSansListe, 1, 'BC antérieur au champ « Lignes BC »');
    assert.equal(r.lignes.length, 3);
  });

  test('Dépose : listée (sans commande) mais identifiée comme telle', () => {
    const r = lignesSansCommande([L('recD', '9', '', 'Dépose', 300)], []);
    assert.equal(r.lignes[0].famille, 'Dépose');
    assert.equal(r.lignes[0].commandeAuto, false);
  });

  test('tri par position numérique (2 avant 10)', () => {
    const r = lignesSansCommande([L('a', '10', 'X', 'Meubles', 1), L('b', '2', 'Y', 'Meubles', 1)], []);
    assert.deepEqual(r.lignes.map(l => l.position), ['2', '10']);
  });
});

describe('numérotation des BC', () => {
  test('prochainIndexBc : suit le plus grand suffixe du devis, ignore les autres devis', () => {
    const nums = ['CLIENT · PLAN DE TRAVAIL & CRÉDENCE · 650/1/1-1', 'AUTRE · MOBILIER · 651/1/1-7'];
    assert.equal(prochainIndexBc(nums, '650/1/1'), 2);
    assert.equal(prochainIndexBc([], '650/1/1'), 1);
  });

  test('numeroBc : format « CLIENT · TYPE · num-idx », legacy sans client', () => {
    assert.equal(numeroBc({ clientNom: 'DUPONT', type: 'Mobilier', numeroDevis: '650/1/1', idx: 2 }), 'DUPONT · MOBILIER · 650/1/1-2');
    assert.equal(numeroBc({ clientNom: '', type: 'Mobilier', numeroDevis: '650/1/1', idx: 2 }), '650/1/1-MOB-2');
  });
});

describe('dateEnvoiDepuisPose()', () => {
  test('pose − 105 jours', () => {
    assert.equal(dateEnvoiDepuisPose('2027-03-01', '2026-10-14'), '2026-11-16');
  });
  test('dans le passé → aujourd\'hui ; sans pose → null', () => {
    assert.equal(dateEnvoiDepuisPose('2026-11-01', '2026-10-14'), '2026-10-14');
    assert.equal(dateEnvoiDepuisPose(null, '2026-10-14'), null);
    assert.equal(dateEnvoiDepuisPose('pas une date', '2026-10-14'), null);
  });
});

describe('modeleDepuisZone()', () => {
  test('marque — modèle, épaisseur, détails dans l\'ordre historique', () => {
    const m = modeleDepuisZone({ Marque: 'NOVA', 'Modèle': 'CUC', 'Porte épaisseur': '22', 'Coloris façade': 'Blanc', 'Modularité': 'M' });
    assert.equal(m.modeleHeader, 'NOVA — CUC\nPorte épaisseur 22');
    assert.equal(m.detailsModele, 'Modularité : M\nColoris façade : Blanc');
  });
  test('pas de zone → vide', () => {
    assert.deepEqual(modeleDepuisZone(undefined), { modeleHeader: '', detailsModele: '' });
  });
});

describe('champsCommande()', () => {
  const base = { numCmd: 'DUPONT · MOBILIER · 650/1/1-2', notes: 'n', clientNom: 'DUPONT', projetId: 'recP', today: '2026-10-14' };

  test('BC Mobilier : même forme que la signature (fournisseur, modèle, lignes, montant arrondi)', () => {
    const groupe = { type: 'Mobilier', ref: 'MOBILIER', canon: 'Mobilier', montant: 801.004, lignes: LIGNES_650, fournisseurId: 'recF' };
    const cf = champsCommande({ ...base, groupe, dateEnvoi: '2026-11-16', modele: { modeleHeader: 'LAGO', detailsModele: '' } });
    assert.deepEqual(Object.keys(cf).sort(), ['Contact Tanguy', 'Contremarque', 'Date création', 'Date envoi', 'Fournisseur',
      'Lignes BC', 'Modèle choisi', 'Montant HT', 'Notes', 'Numéro', 'Projet', 'Référence courte', 'Statut'].sort());
    assert.equal(cf['Statut'], 'Créée');
    assert.equal(cf['Montant HT'], 801);
    assert.deepEqual(cf['Fournisseur'], ['recF']);
    assert.deepEqual(cf['Projet'], ['recP']);
    assert.equal(cf['Modèle choisi'], 'LAGO');
    assert.equal(cf['Détails modèle'], undefined, 'champ vide retiré');
    assert.deepEqual(JSON.parse(cf['Lignes BC']), lignesBcStructurees(LIGNES_650));
    assert.equal(JSON.parse(cf['Lignes BC']).length, 3);
  });

  test('BC Plan de travail vide : pas de montant, pas de modèle, « Lignes BC » = []', () => {
    const groupe = { type: 'Plan de travail & crédence', ref: 'PLAN_CRED', canon: 'Plan de travail & crédence', montant: 0, lignes: [] };
    const cf = champsCommande({ ...base, groupe, dateEnvoi: null, modele: { modeleHeader: 'X', detailsModele: 'Y' } });
    assert.equal(cf['Montant HT'], undefined);
    assert.equal(cf['Modèle choisi'], undefined, 'modèle réservé au Mobilier');
    assert.equal(cf['Date envoi'], undefined);
    assert.equal(cf['Lignes BC'], '[]');
  });
});

test('buildBcTableau : sans montants, une ligne par article', () => {
  const { texte } = buildBcTableau(LIGNES_650);
  assert.match(texte, /TEB207R/);
  assert.doesNotMatch(texte, /733/);
  assert.equal(texte.split('\n').length, 2 + 3);
});
