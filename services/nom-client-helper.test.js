/**
 * Tests services/nom-client-helper.js — node --test natif (ADR-004).
 *
 * Les cas couvrent les formes réellement relevées dans la base Tanguy
 * (60 clients particuliers). Le test qui compte : « DUPUY » seul ne doit
 * JAMAIS atterrir dans le prénom — c'est le défaut signalé par Virginie.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { estCapitales, splitNomClient, prenomDepuisContact, payloadIndividuPennylane } = require('./nom-client-helper');

describe('estCapitales()', () => {
  test('reconnaît les capitales, accents compris', () => {
    assert.equal(estCapitales('DUPUY'), true);
    assert.equal(estCapitales('LEGOFF-MARTIN'), true);
    assert.equal(estCapitales('MÉNARD'), true);
  });
  test('rejette tout ce qui contient une minuscule', () => {
    assert.equal(estCapitales('Dupuy'), false);
    assert.equal(estCapitales('de'), false);
  });
  test('rejette ce qui n\'est pas un mot', () => {
    assert.equal(estCapitales('&'), false);
    assert.equal(estCapitales(''), false);
  });
});

describe('splitNomClient() — le défaut signalé par Virginie', () => {
  test('« DUPUY » seul → NOM, jamais prénom', () => {
    const r = splitNomClient('DUPUY');
    assert.equal(r.lastName, 'DUPUY');
    assert.equal(r.firstName, '');
    assert.equal(r.incertain, true);
  });

  test('« DUPUY MARTIN » tout en capitales → tout dans le nom', () => {
    const r = splitNomClient('DUPUY MARTIN');
    assert.equal(r.lastName, 'DUPUY MARTIN');
    assert.equal(r.firstName, '');
  });

  test('l\'ancien comportement (1er mot = prénom) ne doit plus se produire', () => {
    for (const nom of ['DUPUY', 'MORALES', 'GUERRIER', 'CHARTIN']) {
      assert.notEqual(splitNomClient(nom).firstName, nom, `${nom} rangé en prénom`);
      assert.equal(splitNomClient(nom).lastName, nom);
    }
  });
});

describe('splitNomClient() — convention française', () => {
  test('« Jean DUPUY » → prénom Jean, nom DUPUY', () => {
    const r = splitNomClient('Jean DUPUY');
    assert.equal(r.firstName, 'Jean');
    assert.equal(r.lastName, 'DUPUY');
    assert.equal(r.incertain, false);
  });

  test('« Jean Pierre DUPUY » → prénom composé', () => {
    const r = splitNomClient('Jean Pierre DUPUY');
    assert.equal(r.firstName, 'Jean Pierre');
    assert.equal(r.lastName, 'DUPUY');
  });

  test('couple : « Jean et Marie DUPUY »', () => {
    const r = splitNomClient('Jean et Marie DUPUY');
    assert.equal(r.firstName, 'Jean et Marie');
    assert.equal(r.lastName, 'DUPUY');
  });

  test('particule rattachée au patronyme : « Jean de LA TOUR »', () => {
    const r = splitNomClient('Jean de LA TOUR');
    assert.equal(r.firstName, 'Jean');
    assert.equal(r.lastName, 'de LA TOUR');
  });

  test('nom composé en capitales : « Marie LE GOFF-MARTIN »', () => {
    const r = splitNomClient('Marie LE GOFF-MARTIN');
    assert.equal(r.firstName, 'Marie');
    assert.equal(r.lastName, 'LE GOFF-MARTIN');
  });

  test('sans capitales : « Jean Dupuy » → dernier mot = patronyme', () => {
    const r = splitNomClient('Jean Dupuy');
    assert.equal(r.firstName, 'Jean');
    assert.equal(r.lastName, 'Dupuy');
    assert.equal(r.source, 'convention-francaise');
  });

  test('mot unique sans capitales : « Dupuy » → patronyme, pas prénom', () => {
    const r = splitNomClient('Dupuy');
    assert.equal(r.firstName, '');
    assert.equal(r.lastName, 'Dupuy');
  });
});

describe('prenomDepuisContact()', () => {
  test('un prénom simple et capitalisé est retenu', () => {
    assert.equal(prenomDepuisContact('Jean'), 'Jean');
  });
  test('mail, téléphone, phrase ou patronyme → rien', () => {
    assert.equal(prenomDepuisContact('jean@exemple.fr'), '');
    assert.equal(prenomDepuisContact('06 12 34 56 78'), '');
    assert.equal(prenomDepuisContact('Jean, le mari'), '');
    assert.equal(prenomDepuisContact('DUPUY'), '');
    assert.equal(prenomDepuisContact(''), '');
  });
});

describe('splitNomClient() — appoint par le champ Contact', () => {
  test('« DUPUY » + contact « Jean » → prénom récupéré, doute levé', () => {
    const r = splitNomClient('DUPUY', 'Jean');
    assert.equal(r.firstName, 'Jean');
    assert.equal(r.lastName, 'DUPUY');
    assert.equal(r.incertain, false);
  });

  test('un contact douteux ne contamine pas le prénom', () => {
    const r = splitNomClient('DUPUY', 'contact@exemple.fr');
    assert.equal(r.firstName, '');
    assert.equal(r.lastName, 'DUPUY');
    assert.equal(r.incertain, true);
  });
});

describe('payloadIndividuPennylane()', () => {
  test('« DUPUY » → last_name rempli, first_name vide', () => {
    const p = payloadIndividuPennylane('DUPUY');
    assert.equal(p.last_name, 'DUPUY');
    assert.equal(p.first_name, '');
    assert.equal(p._diagnostic.incertain, true);
  });

  test('« Jean DUPUY » → les deux champs à leur place', () => {
    const p = payloadIndividuPennylane('Jean DUPUY');
    assert.equal(p.first_name, 'Jean');
    assert.equal(p.last_name, 'DUPUY');
  });

  test('nom vide → jamais de last_name vide (Pennylane l\'exige)', () => {
    assert.equal(payloadIndividuPennylane('').last_name, 'Client');
  });

  test('espaces multiples normalisés', () => {
    const p = payloadIndividuPennylane('  Jean   DUPUY  ');
    assert.equal(p.first_name, 'Jean');
    assert.equal(p.last_name, 'DUPUY');
  });
});
