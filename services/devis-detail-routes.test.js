'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fictif = require('./fixtures/devis-detail-fictif');
const fetchReel = global.fetch;
const banc = require('./fixtures/banc-serveur')();
const { T, put, get, table } = banc;
const route = '/api/devis-express/detail/creer';
const payload = () => ({ projetId: 'recPROJET', document: fictif(), source: { nom: 'devis-fictif.pdf' }, verifie: true, famille: 'Mobilier' });
let base;
before(async () => {
  put(T.clients, 'recCLIENT', { Nom: 'CLIENT FICTIF', 'Pennylane customer ID': '555' });
  put(T.projets, 'recPROJET', { Client: ['recCLIENT'], Référence: 'Projet fictif' });
  put(T.projets, 'recAUTRE', { Client: ['recCLIENT'], Référence: 'Autre projet fictif' });
  base = await banc.demarrer();
});
after(() => banc.arreter());
let devisId;
test('modèle Excel : téléchargement authentifié non conservé par les caches partagés', async () => {
  for (const path of ['/api/devis-express/detail/modele', '/api/devis-express/detail/modele.csv']) {
    const r = await fetchReel(base + path, { headers: { cookie: banc.cookiePour('virginie') } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.match(r.headers.get('content-disposition'), /filename="modele-devis-detail.csv"/);
    assert.match(await r.text(), /Référence/);
    const anonyme = await fetchReel(base + path);
    assert.equal(anonyme.status, 401); assert.equal(anonyme.headers.get('cache-control'), 'private, no-store');
    assert.equal((await anonyme.json()).error, 'not authenticated');
  }
});
test('lecture CSV authentifiée sans IA : nom accentué et détail conservés sans créer de devis', async () => {
  const csv = 'Total HT document;10\nTotal TTC document;12\nTotal eco HT;0\nTaux TVA;20\nRéférence;Désignation;Quantité;PU HT;Net HT\n0000123;Article fictif;1;10;10\n';
  const f = new FormData(); f.append('fichier', new Blob([csv], { type: 'text/csv' }), 'devis-démo.csv');
  const avant = table(T.devis).size;
  const r = await banc.envoyer('/api/devis-express/detail/excel', f);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.source.nom, 'devis-démo.csv');
  assert.equal(r.json.parsed.lignes_detail[0].code_produit, '0000123'); assert.equal(table(T.devis).size, avant);
  assert.equal((await banc.envoyer('/api/devis-express/detail/excel', f, 'non-admin')).status, 403);
});
test('import détaillé : rattachement au projet/client, toutes les lignes, zéro prix d’achat inventé', async () => {
  const r = await banc.appel('POST', route, payload()); assert.equal(r.status, 200, JSON.stringify(r.json));
  devisId = r.json.devisId; const d = get(T.devis, devisId).fields;
  assert.deepEqual(d.Projet, ['recPROJET']); assert.deepEqual(d.Client, ['recCLIENT']); assert.equal(d['Lignes devis'].length, 3);
  assert.equal(JSON.parse(d['Détail import']).etat, 'complet'); assert.equal(d['Montant remise'], 112); assert.equal(d['Total TTC'], 1080);
  assert.equal(get(T.lignes, d['Lignes devis'][1]).fields['Code produit'], '0000123 + TEST-02 (×2)');
  assert.ok(d['Lignes devis'].every(id => !Object.hasOwn(get(T.lignes, id).fields, 'Prix achat HT')));
});
test('reprise concurrente : même devis ; autre projet : nouveau devis correctement rattaché', async () => {
  const size = table(T.devis).size;
  const rs = await Promise.all([banc.appel('POST', route, payload()), banc.appel('POST', route, payload())]);
  assert.ok(rs.every(r => r.json.devisId === devisId && r.json.already)); assert.equal(table(T.devis).size, size);
  const r = await banc.appel('POST', route, { ...payload(), projetId: 'recAUTRE' });
  assert.equal(r.status, 200); assert.notEqual(r.json.devisId, devisId); assert.deepEqual(get(T.devis, r.json.devisId).fields.Projet, ['recAUTRE']);
});
test('refus avant écriture : montants, confirmation, accès et champ absent', async () => {
  const avant = table(T.devis).size, projets = table(T.projets).size;
  const faux = payload(); faux.document.totaux.total_ht = 999;
  assert.equal((await banc.appel('POST', route, faux)).status, 422);
  assert.equal((await banc.appel('POST', route, { ...payload(), verifie: false })).status, 422);
  assert.equal((await banc.appel('POST', route, payload(), 'non-admin')).status, 403);
  banc.champsInconnus.set(T.devis, new Set(['Détail import']));
  try { assert.equal((await banc.appel('POST', route, { ...payload(), projetId: undefined, clientId: 'recCLIENT' })).status, 500); }
  finally { banc.champsInconnus.clear(); }
  assert.equal(table(T.devis).size, avant); assert.equal(table(T.projets).size, projets);
});
test('lot partiel puis reprise sans doublon, même après réponse perdue après écriture', async () => {
  for (const perteReponse of [false, true]) {
    const b = payload(); b.document.produit_resume = `Reprise fictive ${perteReponse}`;
    b.document.lignes_detail = Array.from({ length: 14 }, (_, i) => ({ code_produit: `FICTIF-${i}`, designation: `Article fictif ${i}`, quantite: 1, pu_ht: 10, total_ht: 10, tva_taux: 20, categorie: 'Mobilier' }));
    b.document.totaux = { total_ht: 140, total_ttc: 168, tva_montant: 28, eco_ht: 0, remise_globale_ht: 0 };
    banc.erreursAirtable.push({ table: T.lignes, method: 'POST', apres: 1, perteReponse });
    const r = await banc.appel('POST', route, b); assert.equal(r.status, 409, JSON.stringify(r.json));
    const id = r.json.devisId, d = get(T.devis, id).fields;
    assert.equal(JSON.parse(d['Détail import']).etat, 'en_cours');
    assert.equal((await banc.appel('GET', `/api/devis/${id}/descriptif.pdf`)).status, 409);
    const exportAvant = banc.pennylaneRecu.length;
    assert.notEqual((await banc.appel('POST', `/api/devis/${id}/pennylane`, {})).status, 200);
    assert.equal(banc.pennylaneRecu.length, exportAvant);
    const reprise = await banc.appel('POST', route, b); assert.equal(reprise.status, 200, JSON.stringify(reprise.json)); assert.equal(reprise.json.devisId, id);
    assert.equal(get(T.devis, id).fields['Lignes devis'].length, 14);
    assert.equal(table(T.lignes).size, [...table(T.devis).values()].reduce((s, r) => s + (r.fields['Lignes devis'] || []).length, 0));
  }
});
test('champ ligne absent : aucune référence perdue silencieusement', async () => {
  const b = payload(); b.document.produit_resume = 'Champ absent fictif';
  banc.champsInconnus.set(T.lignes, new Set(['Code produit']));
  let id;
  try { const r = await banc.appel('POST', route, b); assert.equal(r.status, 409); id = r.json.devisId; assert.equal(get(T.devis, id).fields['Lignes devis'], undefined); }
  finally { banc.champsInconnus.clear(); }
  const r = await banc.appel('POST', route, b); assert.equal(r.status, 200); assert.equal(r.json.devisId, id); assert.equal(r.json.lignesCreees, 3);
});
test('nouveau chantier : réponse du projet perdue, reprise sans second projet ni second devis', async () => {
  const b = { ...payload(), projetId: undefined, clientId: 'recCLIENT' };
  b.document.produit_resume = 'Projet fictif avec réponse perdue';
  const projets = table(T.projets).size, devis = table(T.devis).size;
  banc.erreursAirtable.push({ table: T.projets, method: 'POST', apres: 0, perteReponse: true });
  assert.notEqual((await banc.appel('POST', route, b)).status, 200);
  const r = await banc.appel('POST', route, b); assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(table(T.projets).size, projets + 1); assert.equal(table(T.devis).size, devis + 1);
  assert.deepEqual(get(T.projets, r.json.projetId).fields.Client, ['recCLIENT']);
  assert.deepEqual(get(T.devis, r.json.devisId).fields.Projet, [r.json.projetId]);
});
test('Pennylane : mention de la vraie annexe, remises lisibles, éco sortie sans modifier le net', async () => {
  const r = await banc.appel('POST', `/api/devis/${devisId}/pennylane`, {}); assert.equal(r.status, 200, JSON.stringify(r.json));
  const pl = banc.pennylaneRecu.at(-1), annexe = banc.pennylaneAnnexes.get(r.json.quoteId)[0];
  const description = pl.invoice_lines.find(l => l.description)?.description;
  assert.equal(description, `Descriptif détaillé joint au devis : ${get(T.devis, devisId).fields['Numéro devis']}\nRemises articles : 200.00 EUR HT\nRemise globale : 112.00 EUR HT`);
  assert.ok(!description.includes(annexe.filename));
  assert.equal(JSON.parse(get(T.devis, devisId).fields['Détail import']).pennylane.annexe, annexe.filename);
  assert.equal(Math.round(pl.invoice_lines.reduce((s, l) => s + Number(l.raw_currency_unit_price), 0) * 100), 90000);
  const { text } = await require('unpdf').extractText(new Uint8Array(annexe.pdf), { mergePages: true });
  assert.match(text, /0000123/); assert.match(text, /112,00/);
});
test('signature et PDF commercial bloqués sans annexe actuelle ; modification d’éco séparée refusée', async () => {
  const d = get(T.devis, devisId).fields; const annexes = banc.pennylaneAnnexes.get(d['Pennylane quote ID']);
  const a = annexes.pop();
  try {
    assert.equal((await banc.appel('POST', `/api/devis/${devisId}/sign`, {})).status, 409);
    assert.equal((await banc.appel('GET', `/api/devis/${devisId}/pennylane/pdf`)).status, 409);
    assert.equal(d.Statut, 'Brouillon');
  } finally { annexes.push(a); }
  assert.equal((await banc.appel('PATCH', `/api/data/devis/${devisId}`, { fields: { 'Éco-participation': 99 } })).status, 409);
  assert.equal((await banc.appel('PATCH', `/api/data/devis/${devisId}`, { fields: { Statut: 'Signé' } })).status, 409);
});
test('Pennylane : sans remise article, seul le renvoi lisible et la remise globale apparaissent', async () => {
  const b = payload();
  Object.assign(b.document.lignes_detail[0], { pu_ht: 600, remise_ht: 0, remise_pct: 0 });
  const creation = await banc.appel('POST', route, b); assert.equal(creation.status, 200);
  const id = creation.json.devisId, avant = structuredClone(get(T.devis, id).fields);
  const r = await banc.appel('POST', `/api/devis/${id}/pennylane`, {}); assert.equal(r.status, 200, JSON.stringify(r.json));
  const pl = banc.pennylaneRecu.at(-1);
  const description = pl.invoice_lines.find(l => l.description)?.description;
  assert.equal(description, `Descriptif détaillé joint au devis : ${avant['Numéro devis']}\nRemise globale : 112.00 EUR HT`);
  assert.doesNotMatch(description, /Remises articles|Déjà déduites|Hors ensemble|Détail du devis|[a-f0-9]{16}/);
  assert.equal(Math.round(pl.invoice_lines.reduce((s, l) => s + Number(l.raw_currency_unit_price), 0) * 100), 90000);
  for (const field of ['Total HT final', 'Total TTC', 'Éco-participation', 'Montant remise', 'Lignes devis', 'Client', 'Projet']) {
    assert.deepEqual(get(T.devis, id).fields[field], avant[field], field);
  }
});
test('annexe modifiée : le devis commercial doit rester lié à sa version interne, une simple pièce jointe ne suffit pas', async () => {
  const d = get(T.devis, devisId).fields;
  const ancienQuote = d['Pennylane quote ID'];
  const date = d['Date devis']; d['Date devis'] = '2026-12-01';
  try {
    const r = await banc.appel('POST', `/api/devis/${devisId}/pennylane/annexe`, {});
    assert.equal(r.status, 409); assert.match(r.json.error, /Régénérer/);
    assert.equal(banc.pennylaneAnnexes.get(ancienQuote).length, 1);
    const regen = await banc.appel('POST', `/api/devis/${devisId}/pennylane`, { force: true });
    assert.equal(regen.status, 200, JSON.stringify(regen.json));
    assert.notEqual(regen.json.quoteId, ancienQuote);
    const a = banc.pennylaneAnnexes.get(regen.json.quoteId)[0];
    assert.equal(JSON.parse(d['Détail import']).pennylane.annexe, a.filename);
    assert.ok(!banc.pennylaneRecu.at(-1).invoice_lines.some(l => l.description?.includes(a.filename)));
    assert.equal((await banc.appel('GET', `/api/devis/${devisId}/pennylane/annexe`)).json.jointe, true);
  } finally { d['Date devis'] = date; }
});
test('ancien devis : annexe d’origine accessible, nouvelle présentation seulement après régénération explicite', async () => {
  const b = payload(); b.document.produit_resume = 'Historique fictif';
  b.document.descriptif_complet += '\nLivraison, pose et éco-participation\nLivraison\nQuantité : 1\nPose\nQuantité : 1\nÉco-participation mobilier\nQuantité : 1\nRemise commerciale\nRemise commerciale\nQuantité : 1';
  const creation = await banc.appel('POST', route, b); assert.equal(creation.status, 200);
  const id = creation.json.devisId, d = get(T.devis, id).fields;
  const { contenuAnnexe, genererAnnexe } = require('./devis-annexe');
  const s = JSON.parse(d['Détail import']); s.pennylane = { quoteId: '900001' };
  d['Pennylane quote ID'] = s.pennylane.quoteId; d['Détail import'] = JSON.stringify(s);
  const ancien = contenuAnnexe(d);
  s.pennylane.annexe = ancien.filename; d['Détail import'] = JSON.stringify(s);
  const pdf = await genererAnnexe(ancien);
  banc.pennylaneAnnexes.set(s.pennylane.quoteId, [{ id: 999, filename: ancien.filename, pdf }]);
  const avant = structuredClone(d);
  const lecture = await banc.appel('GET', `/api/devis/${id}/pennylane/annexe`);
  assert.equal(lecture.json.jointe, true, JSON.stringify(lecture.json));
  const r = await banc.appel('POST', `/api/devis/${id}/pennylane`, {});
  assert.equal(r.json.already, true); assert.deepEqual(d, avant);
  const { text } = await require('unpdf').extractText(new Uint8Array(pdf), { mergePages: true });
  assert.ok(text.includes(ancien.version)); assert.match(text, /Livraison, pose et éco-participation/);
  // Le maintien de l'ancien rendu ne permet pas de contourner une modification.
  const date = d['Date devis']; d['Date devis'] = '2026-12-02';
  assert.equal((await banc.appel('GET', `/api/devis/${id}/pennylane/annexe`)).status, 409);
  d['Date devis'] = date;
  const nouveau = await banc.appel('POST', `/api/devis/${id}/pennylane`, { force: true });
  assert.equal(nouveau.status, 200, JSON.stringify(nouveau.json));
  const lien = JSON.parse(d['Détail import']).pennylane;
  assert.equal(lien.rendu, 2); assert.notEqual(lien.annexe, ancien.filename);
  assert.equal((await banc.appel('GET', `/api/devis/${id}/pennylane/annexe`)).json.jointe, true);
  const annexe = banc.pennylaneAnnexes.get(nouveau.json.quoteId)[0];
  const relu = await require('unpdf').extractText(new Uint8Array(annexe.pdf), { mergePages: true });
  assert.doesNotMatch(relu.text, /Version|Livraison, pose et éco-participation/);
  assert.equal(banc.pennylaneAnnexes.get(s.pennylane.quoteId)[0].filename, ancien.filename);
  for (const champ of ['Total HT final', 'Total TTC', 'Montant remise', 'Éco-participation', 'Lignes devis', 'Client', 'Projet']) assert.deepEqual(d[champ], avant[champ], champ);
});
