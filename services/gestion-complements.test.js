'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banc = require('./fixtures/banc-serveur')();
const { T, put } = banc;
const ECH = 'tblML7D7MXeWnMcxy';
before(async () => {
  put(T.clients, 'recClientA', { Nom: 'CLIENT FICTIF A' });
  put(T.clients, 'recClientB', { Nom: 'CLIENT FICTIF B' });
  put(T.projets, 'recProjetA', { Client: ['recClientA'] });
  put(T.devis, 'recDevisA', { Projet: ['recProjetA'], Client: ['recClientB'], Numéro: 'TEST-1' });
  put(T.devis, 'recDevisB', { Client: ['recClientB'], Numéro: 'TEST-2' });
  for (const [id, devis] of [['recEchA', 'recDevisA'], ['recEchB', 'recDevisB'], ['recEchC', 'recAbsent']]) {
    put(ECH, id, { Devis: [devis], Libellé: 'Solde fictif', 'Montant prévu': 100, 'Date prévue': '2000-01-01' });
  }
  put(ECH, 'recPayee', { Devis: ['recDevisA'], 'Montant prévu': 100, 'Date prévue': '2000-01-01', Statut: 'Encaissé' });
  await banc.demarrer();
});
after(() => banc.arreter());
test('échéances : client du projet, repli devis et lien manquant explicite, sans perdre une ligne', async () => {
  const r = await banc.appel('GET', '/api/factures-clients/impayes');
  assert.equal(r.status, 200);
  assert.equal(r.json.echeancesAFacturer.length, 3);
  const parId = Object.fromEntries(r.json.echeancesAFacturer.map(e => [e.id, e]));
  assert.equal(parId.recEchA.clientNom, 'CLIENT FICTIF A');
  assert.equal(parId.recEchA.devisNumero, 'TEST-1');
  assert.equal(parId.recEchB.clientNom, 'CLIENT FICTIF B');
  assert.equal(parId.recEchC.clientNom, 'Client non renseigné');
});
test('tâches : création puis changement de colonne et effacement des affectations', async () => {
  const r = await banc.appel('POST', '/api/data/taches', { fields: { Titre: 'Tâche fictive', Statut: 'À faire', Projet: ['recProjetA'], 'Assignées à': ['Virginie'], 'Assignée à': 'Virginie', Échéance: '2026-12-01' } });
  assert.equal(r.status, 200);
  const id = r.json.record.id;
  const m = await banc.appel('PATCH', `/api/data/taches/${id}`, { fields: { Statut: 'En cours', 'Assignées à': [], 'Assignée à': null, Échéance: null } });
  assert.equal(m.status, 200);
  assert.equal(m.json.record.fields.Statut, 'En cours');
  assert.deepEqual(m.json.record.fields['Assignées à'], []);
  assert.equal(m.json.record.fields['Assignée à'], null);
  assert.equal(m.json.record.fields.Échéance, null);
});
