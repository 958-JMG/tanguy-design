// Événements de pose en saisie libre (onglet Pose), de bout en bout sur le VRAI
// serveur : table absente (repli propre), création/validation, liste, mise à
// jour et suppression. Demande Sébastien via JMG (2026-11-02).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banc = require('./fixtures/banc-serveur')({ secret: 'secret-de-test-pose-evenements-2026' });

const EV_TABLE_ID = 'tblEVPOSE';

before(() => banc.demarrer());
after(() => banc.arreter());

test('table « Événements pose » absente → GET répond vide, POST guide vers la migration', async () => {
  const g = await banc.appel('GET', '/api/pose/evenements');
  assert.equal(g.status, 200);
  assert.equal(g.json.exists, false);
  assert.deepEqual(g.json.evenements, []);

  const p = await banc.appel('POST', '/api/pose/evenements', { titre: 'Livraison', dateDebut: '2026-11-03' });
  assert.equal(p.status, 400);
  assert.match(p.json.error, /n’existe pas encore|setup-evenements-pose-table/);
});

test('création, liste, mise à jour et suppression d\'un événement libre', async () => {
  banc.declarerTableMeta('Événements pose', EV_TABLE_ID);

  // Création minimale (titre + premier jour) + champs facultatifs.
  const creation = await banc.appel('POST', '/api/pose/evenements', {
    titre: 'Livraison cuisine Martin',
    dateDebut: '2026-11-03',
    dateFin: null,
    heureDebut: '09:00',
    heureFin: '11:00',
    equipe: 'Équipe 1',
    note: 'Réceptionner au dépôt',
  });
  assert.equal(creation.status, 200);
  const ev = creation.json.evenement;
  assert.ok(ev.id, 'un id est renvoyé');
  assert.equal(ev.titre, 'Livraison cuisine Martin');
  assert.equal(ev.dateDebut, '2026-11-03');
  assert.equal(ev.dateFin, null);
  assert.equal(ev.heureDebut, '09:00');
  assert.equal(ev.equipe, 'Équipe 1');

  // Il apparaît dans la liste.
  const liste = await banc.appel('GET', '/api/pose/evenements');
  assert.equal(liste.status, 200);
  assert.equal(liste.json.exists, true);
  assert.equal(liste.json.evenements.length, 1);
  assert.equal(liste.json.evenements[0].titre, 'Livraison cuisine Martin');

  // Déplacement (dates + heures) via PATCH.
  const maj = await banc.appel('PATCH', `/api/pose/evenements/${ev.id}`, {
    dateDebut: '2026-11-05',
    dateFin: '2026-11-06',
    heureDebut: '08:00',
    heureFin: '12:00',
  });
  assert.equal(maj.status, 200);
  assert.equal(maj.json.evenement.dateDebut, '2026-11-05');
  assert.equal(maj.json.evenement.dateFin, '2026-11-06');
  assert.equal(maj.json.evenement.heureFin, '12:00');
  // Le titre n'a pas été touché par ce PATCH partiel.
  assert.equal(maj.json.evenement.titre, 'Livraison cuisine Martin');

  // Suppression.
  const del = await banc.appel('DELETE', `/api/pose/evenements/${ev.id}`);
  assert.equal(del.status, 200);
  const apres = await banc.appel('GET', '/api/pose/evenements');
  assert.equal(apres.json.evenements.length, 0);
});

test('validations refusées : titre vide, dates et heures incohérentes', async () => {
  banc.declarerTableMeta('Événements pose', EV_TABLE_ID);

  const sansTitre = await banc.appel('POST', '/api/pose/evenements', { titre: '   ', dateDebut: '2026-11-03' });
  assert.equal(sansTitre.status, 400);
  assert.match(sansTitre.json.error, /titre/i);

  const sansDate = await banc.appel('POST', '/api/pose/evenements', { titre: 'Congé' });
  assert.equal(sansDate.status, 400);
  assert.match(sansDate.json.error, /premier jour/i);

  const datesInversees = await banc.appel('POST', '/api/pose/evenements', {
    titre: 'Congé', dateDebut: '2026-11-06', dateFin: '2026-11-03',
  });
  assert.equal(datesInversees.status, 400);
  assert.match(datesInversees.json.error, /dernier jour est avant/i);

  const heuresInversees = await banc.appel('POST', '/api/pose/evenements', {
    titre: 'Réception', dateDebut: '2026-11-03', heureDebut: '14:00', heureFin: '09:00',
  });
  assert.equal(heuresInversees.status, 400);
  assert.match(heuresInversees.json.error, /fin doit être après/i);
});
