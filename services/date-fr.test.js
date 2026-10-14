'use strict';
// services/date-fr.js — le formatage des dates « pour un humain », à l'heure de Paris.
// Processus en UTC comme le conteneur Scaleway ; certains tests changent le fuseau
// du processus pour prouver que le résultat n'en dépend pas.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dateFr, dateHeureFr, jourMoisHeureFr, horodatageJournal, partiesParis } = require('./date-fr');

test('été (UTC+2) : 22:30 UTC le 13 = 00:30 le 14 à Paris', () => {
  const d = new Date('2026-10-13T22:30:00Z');
  assert.equal(dateFr(d), '14/10/2026');
  assert.equal(dateHeureFr(d), '14/10/2026 00:30:00');
  assert.equal(jourMoisHeureFr(d), '14/10 00:30:00');
  assert.equal(horodatageJournal(d), '2026-10-14 00:30');
});

test('hiver (UTC+1) : 23:30 UTC le 31/12 = 00:30 le 01/01 à Paris', () => {
  const d = '2026-12-31T23:30:00.000Z';
  assert.equal(dateFr(d), '01/01/2027');
  assert.equal(dateHeureFr(d), '01/01/2027 00:30:00');
});

test('changement d\'heure du 25/10/2026 : 02:30 deux fois, puis 03:30', () => {
  assert.equal(dateHeureFr('2026-10-25T00:30:00Z'), '25/10/2026 02:30:00'); // encore à l'heure d'été
  assert.equal(dateHeureFr('2026-10-25T01:30:00Z'), '25/10/2026 02:30:00'); // déjà à l'heure d'hiver
  assert.equal(dateHeureFr('2026-10-25T02:30:00Z'), '25/10/2026 03:30:00');
});

test('minuit s\'écrit 00, jamais 24', () => {
  assert.equal(horodatageJournal(new Date('2026-06-14T22:00:00Z')), '2026-06-15 00:00');
});

test('date Airtable SANS heure : jamais décalée, quel que soit le fuseau du processus', () => {
  const avant = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(dateFr('2026-10-14'), '14/10/2026', tz);
      assert.equal(dateHeureFr('2026-10-14'), '14/10/2026', `${tz} : pas d'heure inventée`);
      assert.equal(dateFr('2027-01-01'), '01/01/2027', tz);
    }
  } finally { process.env.TZ = avant; }
});

test('un instant donne le même résultat quel que soit le fuseau du processus', () => {
  const avant = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(dateHeureFr(new Date('2026-10-13T22:30:00Z')), '14/10/2026 00:30:00', tz);
    }
  } finally { process.env.TZ = avant; }
});

test('vide → la valeur choisie ; illisible → la valeur brute, jamais « Invalid Date »', () => {
  assert.equal(dateFr(null), '');
  assert.equal(dateFr('', '—'), '—');
  assert.equal(dateFr(undefined, '—'), '—');
  assert.equal(dateFr('pas une date'), 'pas une date');
  assert.equal(dateHeureFr('2026-13-45T99:00'), '2026-13-45T99:00');
  assert.equal(partiesParis('n\'importe quoi'), null);
});

test('sans argument : maintenant, à Paris', () => {
  assert.match(horodatageJournal(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(jourMoisHeureFr(), /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
});
