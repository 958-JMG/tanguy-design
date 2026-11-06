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
  put(T.devis, 'recDevisA', { Statut: 'Signé', Projet: ['recProjetA'], Client: ['recClientB'], 'Numéro devis': 'TEST-1' });
  put(T.devis, 'recDevisB', { Statut: 'Signé', Client: ['recClientB'], 'Numéro devis': 'TEST-2' });
  put(T.devis, 'recDevisC', { Statut: 'Signé', 'Numéro devis': 'TEST-3' });
  for (const [id, devis] of [['recEchA', 'recDevisA'], ['recEchB', 'recDevisB'], ['recEchC', 'recDevisC'], ['recOrpheline', 'recAbsent']]) {
    put(ECH, id, { Devis: [devis], Libellé: 'Solde fictif', 'Montant prévu': 100, 'Date prévue': '2000-01-01' });
  }
  put(ECH, 'recPayee', { Devis: ['recDevisA'], 'Montant prévu': 100, 'Date prévue': '2000-01-01', Statut: 'Encaissé' });
  for (const [i, statut] of ['Brouillon', 'Présenté', 'En attente', 'Refusé', null].entries()) {
    put(T.devis, `recNonSigne${i}`, { Statut: statut, Client: ['recClientA'] });
    put(ECH, `recPrevision${i}`, { Devis: [`recNonSigne${i}`], 'Montant prévu': 900, 'Date prévue': '2000-01-01', Statut: 'À encaisser' });
  }
  await banc.demarrer();
});
after(() => banc.arreter());
test('échéances dues : devis signé uniquement, client du projet ou du devis et absence explicite', async () => {
  const r = await banc.appel('GET', '/api/factures-clients/impayes');
  assert.equal(r.status, 200);
  assert.equal(r.json.echeancesAFacturer.length, 3);
  const parId = Object.fromEntries(r.json.echeancesAFacturer.map(e => [e.id, e]));
  assert.equal(parId.recEchA.clientNom, 'CLIENT FICTIF A');
  assert.equal(parId.recEchA.devisNumero, 'TEST-1');
  assert.equal(parId.recEchB.clientNom, 'CLIENT FICTIF B');
  assert.equal(parId.recEchC.clientNom, 'Client non renseigné');
});
test('la trésorerie ne compte pas les échéances de devis non signés ou introuvables', async () => {
  const r = await banc.appel('GET', '/api/tresorerie/plan');
  assert.equal(r.status, 200);
  assert.equal(r.json.enRetard.encaissements, 300);
  assert.deepEqual(r.json.enRetard.entrees.map(e => e.id).sort(), ['recEchA', 'recEchB', 'recEchC']);
});
test('facturer une échéance non signée est refusé sans création de facture', async () => {
  const taille = banc.table('tblUdblJl5bohxcTd').size;
  for (const echeanceId of ['recPrevision0', 'recPrevision1', 'recPrevision2', 'recPrevision3', 'recPrevision4', 'recOrpheline']) {
    const r = await banc.appel('POST', '/api/factures-clients/from-echeance', { echeanceId });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /doit être signé/);
  }
  assert.equal(banc.table('tblUdblJl5bohxcTd').size, taille);
});
test('un devis signé permet toujours la création de sa facture, sans doublon', async () => {
  const r = await banc.appel('POST', '/api/factures-clients/from-echeance', { echeanceId: 'recEchA' });
  assert.equal(r.status, 200);
  assert.equal(r.json.facture['Montant TTC'], 100);
  const doublon = await banc.appel('POST', '/api/factures-clients/from-echeance', { echeanceId: 'recEchA' });
  assert.equal(doublon.status, 409);
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
