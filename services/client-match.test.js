/**
 * Tests du résolveur de client — node --test natif (ADR-004).
 *
 * Le module vit côté navigateur (ES module) ; on le charge ici en transposant
 * ses exports, pour que la règle soit testée dans la suite du projet plutôt que
 * vérifiée à la main dans un navigateur.
 *
 * Cas de référence : « Alglave Philippe » porte un ESPACE FINAL dans Airtable.
 * C'est ce qui le rendait « inexistant » à la sélection (retour JMG 27/08).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'public/v3/assets/js/core/client-match.js');
const code = fs.readFileSync(SRC, 'utf8').replace(/^export /gm, '');
// eslint-disable-next-line no-new-func
const { normaliserNom, resoudreClient, messageClientIntrouvable } =
  new Function(`${code}; return { normaliserNom, resoudreClient, messageClientIntrouvable };`)();

// Extrait réel de la base (599 clients), formes qui posaient problème.
const CLIENTS = [
  { id: 'c1', Nom: 'Alglave Philippe ', Ville: 'la trinité sur mer' }, // espace final
  { id: 'c2', Nom: 'LE MENTEC ', Ville: '' },                          // espace final
  { id: 'c3', Nom: 'LAMOTTE ', Ville: '' },                            // espace final
  { id: 'c4', Nom: 'MORALES', Ville: 'Vannes' },
  { id: 'c5', Nom: 'MÉNARD', Ville: 'Séné' },
  { id: 'c6', Nom: 'Philippe GUIDOUX', Ville: '' },
];

describe('normaliserNom()', () => {
  test('supprime l\'espace final — le défaut constaté', () => {
    assert.equal(normaliserNom('Alglave Philippe '), 'alglave philippe');
  });
  test('réduit les espaces multiples et insécables', () => {
    assert.equal(normaliserNom('Alglave   Philippe'), 'alglave philippe');
    assert.equal(normaliserNom('Alglave Philippe'), 'alglave philippe');
  });
  test('ignore les accents et la casse', () => {
    assert.equal(normaliserNom('MÉNARD'), normaliserNom('menard'));
  });
  test('valeur vide → chaîne vide', () => {
    assert.equal(normaliserNom(null), '');
  });
});

describe('resoudreClient() — le cas Alglave', () => {
  test('le nom saisi sans espace final retrouve le client', () => {
    const r = resoudreClient('Alglave Philippe', CLIENTS);
    assert.equal(r.client?.id, 'c1');
  });

  test('l\'ancienne comparaison stricte échouait bien sur ce cas', () => {
    // Reproduction du code d'origine : preuve que le test protège d'une régression.
    const saisie = 'Alglave Philippe';
    const ancien = CLIENTS.find(c => (c.Nom || '').toLowerCase() === saisie.toLowerCase());
    assert.equal(ancien, undefined, 'sans normalisation, le client est introuvable');
  });

  test('les deux autres clients à espace final sont retrouvés aussi', () => {
    assert.equal(resoudreClient('LE MENTEC', CLIENTS).client?.id, 'c2');
    assert.equal(resoudreClient('LAMOTTE', CLIENTS).client?.id, 'c3');
  });

  test('accents et casse ne bloquent plus', () => {
    assert.equal(resoudreClient('menard', CLIENTS).client?.id, 'c5');
    assert.equal(resoudreClient('morales', CLIENTS).client?.id, 'c4');
  });
});

describe('resoudreClient() — suggestions', () => {
  test('une lettre inversée propose le bon client', () => {
    // « Algalve » ↔ « Alglave » : exactement la forme dictée par JMG.
    const r = resoudreClient('Algalve Philippe', CLIENTS);
    assert.equal(r.client, null);
    assert.equal(r.suggestions[0].id, 'c1');
  });

  test('une faute de frappe simple est rattrapée', () => {
    assert.equal(resoudreClient('MORALE', CLIENTS).suggestions[0].id, 'c4');
  });

  test('un nom sans rapport ne propose rien plutôt que n\'importe quoi', () => {
    assert.deepEqual(resoudreClient('Zzzzzzzzzz', CLIENTS).suggestions, []);
  });

  test('saisie vide → aucun client, aucune suggestion', () => {
    const r = resoudreClient('', CLIENTS);
    assert.equal(r.client, null);
    assert.deepEqual(r.suggestions, []);
  });
});

describe('resoudreClient() — homonymes', () => {
  const avecHomonymes = [...CLIENTS, { id: 'c7', Nom: 'MORALES', Ville: 'Auray' }];

  test('deux clients de même nom : on ne choisit PAS à la place de l\'utilisateur', () => {
    const r = resoudreClient('MORALES', avecHomonymes);
    assert.equal(r.client, null);
    assert.equal(r.ambigu.length, 2);
  });

  test('le message nomme les villes pour départager', () => {
    const r = resoudreClient('MORALES', avecHomonymes);
    const m = messageClientIntrouvable(r, 'MORALES');
    assert.match(m, /Vannes/);
    assert.match(m, /Auray/);
  });
});

describe('messageClientIntrouvable()', () => {
  test('propose les noms proches au lieu d\'un simple « introuvable »', () => {
    const r = resoudreClient('Algalve Philippe', CLIENTS);
    assert.match(messageClientIntrouvable(r, 'Algalve Philippe'), /Alglave Philippe/);
  });
  test('sans piste, reste explicite', () => {
    const r = resoudreClient('Zzzzzzzzzz', CLIENTS);
    assert.match(messageClientIntrouvable(r, 'Zzzzzzzzzz'), /introuvable/);
  });
});
