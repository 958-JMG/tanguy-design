'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fictif = require('./fixtures/devis-detail-fictif');
const { preparerDetail, verifierDetail, empreinteDetail } = require('./devis-detail');
const { contenuAnnexe, genererAnnexe } = require('./devis-annexe');
const core = () => import('../public/v3/assets/js/core/devis-detail.mjs');

test('deux remises distinctes, éco déjà incluse, références multiples conservées', async () => {
  const { controlerDetail } = await core();
  const c = controlerDetail(fictif());
  assert.equal(c.ok, true, c.erreurs.join('\n'));
  assert.deepEqual([c.totaux.remise_lignes_ht, c.totaux.remise_globale_ht, c.totaux.eco_ht, c.totaux.total_ht, c.totaux.total_ttc], [200, 112, 12, 900, 1080]);
  assert.equal(c.lignes[1].code_produit, '0000123 + TEST-02 (×2)');
});
test('éco exclue ajoutée une seule fois ; éco incluse dans un article ne double pas', async () => {
  const { controlerDetail } = await core();
  const d = fictif(); Object.assign(d.totaux, { total_ht: 888, total_ttc: 1065.6, tva_montant: 177.6, eco_incluse: false });
  let c = controlerDetail(d); assert.equal(c.ok, true, c.erreurs.join()); assert.equal(c.totaux.total_ttc, 1080);
  const e = fictif(); e.lignes_detail.pop(); e.lignes_detail[0].total_ht += 12; e.lignes_detail[0].eco_ht = 12;
  c = controlerDetail(e); assert.equal(c.ok, true, c.erreurs.join()); assert.equal(c.totaux.eco_ht, 12);
});
test('les références répétées sur deux positions ne fusionnent pas', async () => {
  const d = fictif(); d.lignes_detail[1].code_produit = d.lignes_detail[0].code_produit;
  const r = await preparerDetail(d); assert.equal(r.lignes.length, 3); assert.equal(r.lignes[0]['Code produit'], r.lignes[1]['Code produit']);
});
test('données ambiguës refusées : référence numérique, sans référence non confirmé, remise double, HT, TVA ou TTC discordant', async () => {
  const { controlerDetail } = await core();
  const mutations = [d => d.lignes_detail[1].code_produit = 123, d => d.lignes_detail[1].code_produit = '',
    d => d.lignes_detail[0].total_ht = 400, d => d.lignes_detail[0].remise_ht = 100,
    d => d.lignes_detail.push({ designation: 'remise bis', quantite: 1, total_ht: -200 }),
    d => d.totaux.total_ht = 901, d => d.totaux.total_ttc = 1081, d => d.totaux.tva_montant = 179,
    d => d.totaux.eco_ht = 13, d => delete d.totaux.eco_incluse, d => delete d.totaux.total_ttc,
    d => d.lignes_detail[0].quantite = null, d => d.lignes_detail[0].total_ht = 'pas un montant'];
  for (const m of mutations) { const d = fictif(); m(d); assert.equal(controlerDetail(d).ok, false, JSON.stringify(d)); }
  const d = fictif(); d.lignes_detail[1].code_produit = ''; d.lignes_detail[1].sans_reference_confirme = true;
  assert.equal(controlerDetail(d).ok, true);
});
test('deux TVA : remise répartie hors éco, bases et arrondis réconciliés', async () => {
  const { controlerDetail } = await core();
  const d = fictif(); d.lignes_detail[1].tva_taux = 10;
  // 112 répartis 67,20 / 44,80 : base20=544,80 ; base10=355,20.
  Object.assign(d.totaux, { total_ttc: 1044.48, tva_montant: 144.48 });
  const c = controlerDetail(d); assert.equal(c.ok, true, c.erreurs.join());
  assert.deepEqual(c.totaux.bases, [{ taux: 20, base: 544.8, tva: 108.96 }, { taux: 10, base: 355.2, tva: 35.52 }]);
});
test('pourcentage global hors éco et absence de prix unitaire respectée', async () => {
  const { controlerDetail } = await core();
  const d = fictif(); d.totaux.remise_globale_pct = 11.2; d.lignes_detail[1].pu_ht = null;
  const c = controlerDetail(d); assert.equal(c.ok, true, c.erreurs.join()); assert.equal(c.lignes[1].pu_ht, null);
  d.totaux.remise_globale_pct = 20; assert.equal(controlerDetail(d).ok, false);
});
test('stockage intégral, pas de prix d’achat inventé, contrôle des lignes relues', async () => {
  const d = fictif(); d.lignes_detail[1].designation += '\nDétail de finition fictif.'.repeat(80) + '\nDERNIER DÉTAIL';
  const r = await preparerDetail(d, { numero: 'IMP-TEST', date: '2026-11-16' });
  assert.equal(r.lignes[0]['Prix achat HT'], undefined);
  assert.match(r.lignes[1].Désignation, /DERNIER DÉTAIL$/);
  const s = JSON.parse(r.fields['Détail import']); s.etat = 'complet'; r.fields['Détail import'] = JSON.stringify(s);
  const records = r.lignes.map(fields => ({ fields })); await verifierDetail(r.fields, records);
  records[1].fields['Code produit'] = 'MAUVAIS'; await assert.rejects(verifierDetail(r.fields, records), /repère 2/);
});
test('annexe versionnée : références, dernier détail et deux remises réellement dans le PDF', async () => {
  const d = fictif(); d.lignes_detail[1].designation += '\nLong détail de finition fictif.'.repeat(90) + '\nDERNIER DÉTAIL';
  const r = await preparerDetail(d, { numero: 'IMP-DEMO', date: '2026-11-16' });
  r.snapshot.etat = 'complet'; r.fields['Détail import'] = JSON.stringify(r.snapshot);
  const contenu = contenuAnnexe(r.fields, []); const pdf = await genererAnnexe(contenu);
  const { text, totalPages } = await require('unpdf').extractText(new Uint8Array(pdf), { mergePages: true });
  for (const ref of ['0000123', 'TEST-02', 'APP-TEST', 'DERNIER DÉTAIL', '200,00', '112,00', '1 080,00', contenu.version]) assert.ok(text.replace(/\u00a0|\u202f/g, ' ').includes(ref), ref);
  assert.ok(totalPages > 1);
  r.fields['Date devis'] = '2026-11-17'; assert.notEqual(contenuAnnexe(r.fields, []).filename, contenu.filename);
});
test('empreinte liée au contenu et à la bonne cible ; migration strictement additive', () => {
  const d = fictif(); assert.notEqual(empreinteDetail(d, 'clientA'), empreinteDetail(d, 'clientB'));
  const { plan } = require('../scripts/setup-devis-detail-field');
  const schema = { tables: [{ id: 'tblWklGEKMiBStXCs', fields: [] }] };
  assert.equal(plan(schema).length, 2); schema.tables[0].fields = plan(schema); assert.deepEqual(plan(schema), []);
  schema.tables[0].fields[0].type = 'number'; assert.throws(() => plan(schema), /type différent/);
});
test('Pennylane : éco au bon taux, aucun déplacement vers le taux supérieur', async () => {
  const d = fictif(); d.lignes_detail[2].tva_taux = 10;
  Object.assign(d.totaux, { total_ttc: 1078.8, tva_montant: 178.8 });
  const r = await preparerDetail(d);
  const p = require('./pennylane');
  const out = p.carveEcoDetail(p.buildInvoiceLines(r.fields).lines, r.controle);
  assert.equal(out.ecoHt, 12); assert.equal(out.ecoLine.vat_rate, 'FR_100');
  assert.equal(out.ecoLine.raw_currency_unit_price, '12.00');
  assert.equal(out.lines.reduce((s, l) => s + Number(l.raw_currency_unit_price), 0), 900);
});
test('Pennylane : un centime de différence après découpage TVA bloque sans modifier les prix', async () => {
  const p = require('./pennylane');
  const controle = { lignes: [{ tva_taux: 20, eco_ht: .03 }], totaux: { total_ht: .06, total_ttc: .07, eco_ht: .03, eco_ttc: .04 } };
  const lines = [{ quantity: 1, raw_currency_unit_price: '0.06', vat_rate: 'FR_200', label: 'Exemple arrondi' }];
  assert.throws(() => p.carveEcoDetail(lines, controle), /Arrondi de TVA/); assert.equal(lines[0].raw_currency_unit_price, '0.06');
});
