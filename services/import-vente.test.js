'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banc = require('./fixtures/banc-serveur')();
const { T, put, get, table } = banc;
before(async () => {
  put(T.clients, 'recCLIENT', { Nom: 'CLIENT FICTIF', 'Pennylane customer ID': '555' });
  put(T.projets, 'recPROJET', { Client: ['recCLIENT'], Référence: 'Chantier fictif' });
  await banc.demarrer();
});
after(() => banc.arreter());

test('vente HT : aucun coefficient, éco incluse ou ajoutée une seule fois', async () => {
  const { calculPrixImport } = await import('../public/v3/assets/js/core/devis-prix.mjs');
  for (const coefficient of [1, 2, 3]) {
    assert.equal(calculPrixImport({ montantDocumentHt: 1010, ecoHt: 10, ecoIncluse: true, coefficient }).prixClientHt, 1010);
    assert.equal(calculPrixImport({ montantDocumentHt: 1000, ecoHt: 10, ecoIncluse: false, coefficient }).prixClientHt, 1010);
  }
  assert.throws(() => calculPrixImport({ montantDocumentHt: 1000, ecoHt: 10 }), /Précise/);
  assert.throws(() => calculPrixImport({ montantDocumentHt: 1000, ecoHt: -2 }), /invalide/);
  assert.throws(() => calculPrixImport({ montantDocumentHt: 1000, ecoHt: 2000, ecoIncluse: true }), /dépasse/);
});
let devisId;
test('création : serveur recalcule la vente, achat non inventé, descriptif complet conservé', async () => {
  const descriptif = 'Porte laquée, charnière invisible, largeur 600 mm.\n'.repeat(40) + 'DERNIER DETAIL';
  const r = await banc.appel('POST', '/api/devis-express/creer-devis', { projetId: 'recPROJET', designation: 'Meuble fictif', descriptif, montantDocumentHt: 1010, ecoHt: 10, ecoIncluse: true, prixClientHt: 3030, coefficient: 3, tvaTaux: 20, famille: 'Mobilier' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  devisId = r.json.devisId;
  const f = get(T.devis, devisId).fields;
  assert.equal(f['Total HT final'], 1010);
  assert.equal(f['Total TTC'], 1212);
  assert.equal(f['Éco-participation'], 12);
  const l = get(T.lignes, f['Lignes devis'][0]).fields;
  assert.equal(l['Prix achat HT'], undefined);
  assert.match(l.Désignation, /DERNIER DETAIL$/);
});
test('éco ambiguë : refus avant toute création', async () => {
  const avant = table(T.devis).size;
  const r = await banc.appel('POST', '/api/devis-express/creer-devis', { projetId: 'recPROJET', montantDocumentHt: 1010, ecoHt: 10, tvaTaux: 20 });
  assert.equal(r.status, 422);
  assert.equal(table(T.devis).size, avant);
});
test('Pennylane : annexe complète jointe, puis reprise sans doublon', async () => {
  const r = await banc.appel('POST', `/api/devis/${devisId}/pennylane`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.annexe.id);
  const attachments = banc.pennylaneAnnexes.get(r.json.quoteId);
  const { text } = await require('unpdf').extractText(new Uint8Array(attachments[0].pdf), { mergePages: true });
  assert.match(text, /DERNIER DETAIL/);
  const reprise = await banc.appel('POST', `/api/devis/${devisId}/pennylane/annexe`, {});
  assert.equal(reprise.json.annexe.already, true);
  assert.equal(attachments.length, 1);
});
test('annexe refusée : message explicite, devis Pennylane inchangé, reprise possible', async () => {
  const avant = banc.pennylaneRecu.length;
  banc.annexeErreur.status = 403;
  try {
    const r = await banc.appel('POST', `/api/devis/${devisId}/pennylane/annexe`, {});
    assert.equal(r.status, 502);
    assert.match(r.json.error, /téléchargeable/);
    assert.equal(banc.pennylaneRecu.length, avant);
  } finally { banc.annexeErreur.status = 0; }
});
test('recherche projet : nom client, accents, référence et mots dans un ordre différent', async () => {
  const { filtrerProjets } = await import('../public/v3/assets/js/core/projet-recherche.mjs');
  const projets = [{ id: 'p1', Client: ['c1'], Référence: 'Dressing Est' }, { id: 'p2', Client: ['c2'], Référence: 'Cuisine Sud' }];
  const clients = [{ id: 'c1', Nom: 'CLIENT ÉTÉ' }, { id: 'c2', Nom: 'CLIENT HIVER' }];
  assert.deepEqual(filtrerProjets(projets, clients, 'ete dressing').map(p => p.id), ['p1']);
  assert.deepEqual(filtrerProjets(projets, clients, 'inexistant'), []);
});
