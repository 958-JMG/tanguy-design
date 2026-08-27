/**
 * Tests services/devis-express-helper.js — node --test natif (ADR-004).
 *
 * Enjeu principal : un devis créé ici alimentera plus tard la signature (bons de
 * commande), les échéances et les brouillons Pennylane, qui lisent tous les
 * BASES DE TVA. Un devis sans elles ne casse rien tout de suite — il produit des
 * factures fausses des semaines après. D'où les tests sur les totaux.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { numeroDevisExpress, construireDevisClient, referenceProjet } = require('./devis-express-helper');

describe('numeroDevisExpress()', () => {
  test('premier devis de l\'année', () => {
    assert.equal(numeroDevisExpress([], 2026), 'EXP-2026-001');
  });

  test('incrémente à partir du plus grand existant', () => {
    assert.equal(numeroDevisExpress(['EXP-2026-001', 'EXP-2026-002'], 2026), 'EXP-2026-003');
  });

  test('PIÈGE : compter les devis rendrait un numéro déjà pris', () => {
    // 3 devis émis, le n° 002 supprimé → il en reste 2. Un compteur donnerait
    // « 003 », qui existe déjà.
    assert.equal(numeroDevisExpress(['EXP-2026-001', 'EXP-2026-003'], 2026), 'EXP-2026-004');
  });

  test('ignore les autres années et les autres formats', () => {
    const nums = ['EXP-2025-009', 'FC-2026-014', 'D-2026-101', 'EXP-2026-001'];
    assert.equal(numeroDevisExpress(nums, 2026), 'EXP-2026-002');
  });

  test('résiste aux entrées vides ou absurdes', () => {
    assert.equal(numeroDevisExpress([null, '', 'EXP-2026-abc'], 2026), 'EXP-2026-001');
    assert.equal(numeroDevisExpress(undefined, 2026), 'EXP-2026-001');
  });

  test('passe à 4 chiffres au-delà de 999 sans casser', () => {
    assert.equal(numeroDevisExpress(['EXP-2026-999'], 2026), 'EXP-2026-1000');
  });
});

describe('construireDevisClient() — totaux', () => {
  const base = { numero: 'EXP-2026-001', designation: 'Cuisine sur-mesure', prixClientHt: 12000, tvaTaux: 20, dateDevis: '2026-08-27' };

  test('les bases de TVA sont renseignées (lues par la signature et Pennylane)', () => {
    const { fields } = construireDevisClient(base);
    assert.equal(fields['TVA taux 1 pourcentage'], 20);
    assert.equal(fields['TVA taux 1 base'], 12000);
    assert.equal(fields['TVA taux 1 montant'], 2400);
    assert.equal(fields['Total TTC'], 14400);
  });

  test('le TTC se retrouve depuis les bases', () => {
    const { coherence, avertissements } = construireDevisClient(base);
    assert.equal(coherence.ok, true);
    assert.deepEqual(avertissements, []);
  });

  test('TVA à 10 %', () => {
    const { fields } = construireDevisClient({ ...base, tvaTaux: 10 });
    assert.equal(fields['TVA taux 1 montant'], 1200);
    assert.equal(fields['Total TTC'], 13200);
  });

  test('arrondis au centime', () => {
    const { fields, coherence } = construireDevisClient({ ...base, prixClientHt: 1234.567, tvaTaux: 20 });
    assert.equal(fields['Total HT final'], 1234.57);
    assert.equal(fields['TVA taux 1 montant'], 246.91);
    assert.equal(coherence.ok, true);
  });
});

describe('construireDevisClient() — éco-contribution', () => {
  const base = { numero: 'EXP-2026-001', designation: 'Cuisine', prixClientHt: 12000, tvaTaux: 20, dateDevis: '2026-08-27' };

  test('déjà comprise dans le prix : jamais ajoutée une seconde fois', () => {
    const { fields } = construireDevisClient({ ...base, ecoHt: 3.92 });
    assert.equal(fields['Total HT final'], 12000, 'le total ne doit pas gonfler');
    assert.equal(fields['Total HT articles'], 11996.08, 'la part produit est le prix moins l\'éco');
    assert.equal(fields['Eco-participation mobilier'], 3.92);
  });

  test('sans éco-contribution, le champ n\'est pas envoyé du tout', () => {
    const { fields } = construireDevisClient(base);
    assert.equal('Eco-participation mobilier' in fields, false);
    assert.equal(fields['Total HT articles'], 12000);
  });

  test('une éco supérieure au prix est signalée, pas absorbée en silence', () => {
    const { avertissements, fields } = construireDevisClient({ ...base, prixClientHt: 100, ecoHt: 150 });
    assert.match(avertissements.join(' '), /supérieure au prix/);
    assert.equal(fields['Total HT articles'], 0, 'la part produit ne devient jamais négative');
  });

  test('l\'origine et l\'éco sont tracées dans les notes', () => {
    const { fields } = construireDevisClient({ ...base, ecoHt: 3.92, origine: 'DI0000044050' });
    assert.match(fields['Notes internes'], /Devis express/);
    assert.match(fields['Notes internes'], /DI0000044050/);
    assert.match(fields['Notes internes'], /3\.92 € HT/);
  });
});

describe('construireDevisClient() — données manquantes', () => {
  test('prix absent → signalé, aucun total inventé', () => {
    const { fields, avertissements } = construireDevisClient({ numero: 'EXP-2026-001', designation: 'X', tvaTaux: 20 });
    assert.match(avertissements.join(' '), /Prix client HT absent/);
    assert.equal(fields['Total HT final'], null);
    assert.equal(fields['Total TTC'], null);
  });

  test('TVA absente → bases nulles plutôt qu\'un taux supposé', () => {
    const { fields, avertissements } = construireDevisClient({ numero: 'EXP-2026-001', designation: 'X', prixClientHt: 1000 });
    assert.match(avertissements.join(' '), /Taux de TVA absent/);
    assert.equal(fields['TVA taux 1 pourcentage'], null);
    assert.equal(fields['Total TTC'], null);
  });

  test('le devis part toujours en Brouillon, jamais signé d\'office', () => {
    const { fields } = construireDevisClient({ numero: 'EXP-2026-001', designation: 'X', prixClientHt: 1000, tvaTaux: 20 });
    assert.equal(fields['Statut'], 'Brouillon');
    assert.equal(fields['Type devis'], 'Principal');
  });

  test('désignation vide → libellé de repli, jamais de ligne sans intitulé', () => {
    const { ligne } = construireDevisClient({ numero: 'EXP-2026-001', prixClientHt: 1000, tvaTaux: 20 });
    assert.equal(ligne['Désignation'], 'Prestation');
  });
});

describe('referenceProjet()', () => {
  test('assemble client et désignation', () => {
    assert.equal(referenceProjet('MORALES', 'Cuisine sur-mesure'), 'MORALES · Cuisine sur-mesure');
  });
  test('client manquant → repli lisible', () => {
    assert.equal(referenceProjet('', 'Cuisine'), 'Projet · Cuisine');
  });
  test('tronque les références à rallonge', () => {
    assert.ok(referenceProjet('X'.repeat(80), 'Y'.repeat(80)).length <= 100);
  });
});
