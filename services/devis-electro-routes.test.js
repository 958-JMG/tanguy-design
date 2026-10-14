// Devis express électroménager (projets FINDIS), de bout en bout sur le VRAI
// serveur : lecture du PDF, création du devis, double compte, migration absente,
// Pennylane (éco hors CA), bon de commande Findis à la signature, et le Devis
// express fournisseur qui garde désormais son prix d'achat.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const banc = require('./fixtures/banc-serveur')({ secret: 'secret-de-test-devis-electro-14-10-2026' });
const { T, put, get, table, champsInconnus, pennylaneRecu } = banc;
const { normaliserArticles } = require('./devis-electro');

const PROJET_35789 = normaliserArticles(require(path.join(__dirname, 'fixtures', 'findis', 'projet-35789.json'))).articles;

function semer() {
  put(T.clients, 'recCLI', { Nom: 'CLIENT TEST', 'Pennylane customer ID': '555', Adresse: '1 rue du Test\n56000 VANNES' });
  put(T.fournisseurs, 'recFINDIS', { Nom: 'Findis', 'Catégories': ['Électroménager'] });
  put(T.fournisseurs, 'recBORA', { Nom: 'BORA', 'Catégories': ['Électroménager'] });
  put(T.fournisseurs, 'recLAGO', { Nom: 'LAGO', 'Catégories': ['Mobilier'] });
  // Projet avec son devis Winner PRINCIPAL, qui contient déjà un piano (sans fournisseur).
  put(T.projets, 'recPRJ', { 'Référence': 'Cuisine test', Client: ['recCLI'], Devis: ['recWIN'] });
  put(T.devis, 'recWIN', { 'Numéro devis': '700/1/1', 'Type devis': 'Principal', Statut: 'Signé', Projet: ['recPRJ'], 'Lignes devis': ['recW1'] });
  put(T.lignes, 'recW1', { Position: '1', 'Catégorie': 'Électroménager', 'Code produit': 'TR4110P1', 'Désignation': 'SMEG Piano', 'Montant HT': 2915.83, Devis: ['recWIN'] });
  // Projet vierge (pour le type « Principal » automatique).
  put(T.projets, 'recPRJ2', { 'Référence': 'Projet vierge', Client: ['recCLI'] });
}

before(async () => { semer(); await banc.demarrer(); });
after(() => banc.arreter());

function pdfFindis(lignes) {
  return new Promise(resolve => {
    const doc = new PDFDocument();
    const morceaux = [];
    doc.on('data', c => morceaux.push(c));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    for (const l of lignes) doc.text(l);
    doc.end();
  });
}

test('lire : un PDF FINDIS est lu par son texte, sans IA', async () => {
  const pdf = await pdfFindis([
    'Projet n° 35789', 'Ajouter un article :',
    'Hotte encastrée | ELICA Hotte encastrée PRF0114761A', 'Hotte box encastrée BOXIN', '1',
    'Votre prix public : 519,90', 'P.Vente : 519,90 € TTC', 'P.Achat : 222,04 € HT', '+ éco-part. : 3,90 € HT', 'Stock : 6 / Cde : 4',
    'Mitigeur sans douchette | GESSI Mitigeur 17155#031', 'Mitigeur bec haut', '1',
    'Votre prix public : 199,00', 'P.Vente : 199,00 € TTC', 'P.Achat : 96,46 € HT', '+ éco-part. : 0,01 € HT', 'Stock : 1 / Cde : 0',
  ]);
  const fd = new FormData();
  fd.append('fichiers', new Blob([pdf], { type: 'application/pdf' }), 'Projet n° 35789 - FINDIS.pdf');
  const r = await banc.envoyer('/api/devis-express/findis/lire', fd);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.projetFindis, '35789');
  assert.deepEqual(r.json.lectures, [{ fichier: 'Projet n° 35789 - FINDIS.pdf', mode: 'texte', articles: 2 }]);
  assert.deepEqual(r.json.articles.map(a => [a.reference, a.famille, a.achatRetenuHtUnit]), [['PRF0114761A', 'Électroménager', 222.04], ['17155#031', 'Robinetterie', 96.46]]);
  assert.ok(!r.json.alertes.some(a => /Findis/.test(a)), 'la fiche Findis existe');
});

test('lire : une capture sans IA configurée → erreur dite, jamais une liste vide', async () => {
  const fd = new FormData();
  fd.append('fichiers', new Blob([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])], { type: 'image/png' }), 'capture.png');
  const r = await banc.envoyer('/api/devis-express/findis/lire', fd);
  assert.ok(r.json && r.json.error, JSON.stringify(r.json));
  assert.match(r.json.error, /ANTHROPIC_API_KEY/);
});

test('lire : un fichier qui n\'est ni PDF ni image → refusé et nommé', async () => {
  const fd = new FormData();
  fd.append('fichiers', new Blob(['bonjour'], { type: 'text/plain' }), 'note.txt');
  const r = await banc.envoyer('/api/devis-express/findis/lire', fd);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /PDF et les images/);
});

let devisElectroId;
test('créer : une ligne par article, prix d\'achat + Findis, Additif (le projet a son principal), double compte signalé', async () => {
  const r = await banc.appel('POST', '/api/devis-express/findis/creer-devis', {
    projetId: 'recPRJ', tvaTaux: 20, projetFindis: '35789', articles: PROJET_35789,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  devisElectroId = r.json.devisId;
  assert.equal(r.json.typeDevis, 'Additif');
  assert.equal(r.json.lignesCreees, 5);
  assert.equal(r.json.totaux.global.marge, 1590.52);
  assert.ok(r.json.avertissements.some(a => /700\/1\/1.*1 ligne\(s\) d'électroménager/.test(a)), JSON.stringify(r.json.avertissements));
  const d = get(T.devis, devisElectroId).fields;
  assert.match(d['Numéro devis'], /^EXP-\d{4}-\d{3}$/);
  assert.equal(d['Total TTC'], 5316.8);
  assert.equal(d['Éco-participation'], 64.96);
  assert.deepEqual(d.Projet, ['recPRJ']);
  const lignes = d['Lignes devis'].map(id => get(T.lignes, id).fields);
  assert.equal(lignes.length, 5);
  assert.ok(lignes.every(l => l.Fournisseur && l.Fournisseur[0] === 'recFINDIS'));
  assert.deepEqual(lignes.map(l => l['Prix achat HT']), [1118.72, 817.18, 222.04, 531.62, 96.46]);
  assert.equal(lignes[4]['Catégorie'], 'Robinetterie');
});

test('créer : articles invalides → 422, rien de créé', async () => {
  const avant = table(T.devis).size;
  const r = await banc.appel('POST', '/api/devis-express/findis/creer-devis', {
    projetId: 'recPRJ2', articles: [{ reference: 'X', quantite: 0, venteTtcUnit: -1, achatRetenuHtUnit: 10 }],
  });
  assert.equal(r.status, 422);
  assert.match(r.json.error, /quantité invalide.*prix de vente invalide/);
  assert.equal(table(T.devis).size, avant);
});

test('créer : avant la migration Airtable, lignes créées sans les nouveaux champs, et dit', async () => {
  champsInconnus.set(T.lignes, new Set(['Prix achat HT', 'Fournisseur']));
  try {
    const r = await banc.appel('POST', '/api/devis-express/findis/creer-devis', {
      projetId: 'recPRJ2', tvaTaux: 20, articles: PROJET_35789.slice(0, 2),
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.typeDevis, 'Principal', 'projet sans devis : principal');
    assert.equal(r.json.lignesCreees, 2);
    assert.ok(r.json.avertissements.some(a => /Prix achat HT.*Fournisseur.*setup-prix-achat-fields/.test(a)), JSON.stringify(r.json.avertissements));
  } finally { champsInconnus.delete(T.lignes); }
});

test('Pennylane : vente + ligne « Éco-participation » hors CA (54,13 € HT), total inchangé', async () => {
  const r = await banc.appel('POST', `/api/devis/${devisElectroId}/pennylane`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.eco, { ttc: 64.96, ht: 54.13 });
  const q = pennylaneRecu.at(-1);
  const totalHt = q.invoice_lines.reduce((t, l) => t + Number(l.raw_currency_unit_price) * (Number(l.quantity) || 1), 0);
  assert.equal(Math.round(totalHt * 100) / 100, 4430.67);
  assert.match(q.invoice_lines[0].description, /SCD90IMX9-1/, 'la description liste les articles');
});

test('signature : UN bon Findis (mitigeur compris), au prix d\'achat + éco, sans BC « Plan de travail » vide', async () => {
  const avant = new Set(table(T.commandes).keys());
  const r = await banc.appel('POST', `/api/devis/${devisElectroId}/sign`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.commandes_creees, 1);
  const bcs = [...table(T.commandes).values()].filter(c => !avant.has(c.id)).map(c => c.fields);
  assert.equal(bcs.length, 1);
  const bc = bcs[0];
  assert.match(bc['Numéro'], /^CLIENT TEST · FINDIS · EXP-\d{4}-\d{3}-1$/);
  assert.deepEqual(bc.Fournisseur, ['recFINDIS'], 'Findis, malgré BORA sur la même famille');
  assert.equal(bc['Montant HT'], 2840.15, '2 786,02 d\'achat + 54,13 d\'éco');
  assert.equal(JSON.parse(bc['Lignes BC']).length, 5);
  assert.match(bc.Notes, /Fournisseur \(devis\) : Findis\. Montant HT = prix d'achat \+ éco-participation/);
  const orphelines = await banc.appel('GET', `/api/devis/${devisElectroId}/lignes-sans-commande`);
  assert.deepEqual(orphelines.json.lignes, []);
});

test('Devis express fournisseur : famille, prix d\'achat gardé, Additif automatique', async () => {
  const r = await banc.appel('POST', '/api/devis-express/creer-devis', {
    projetId: 'recPRJ', designation: 'Meuble LAGO 36E8', prixClientHt: 1201.64, tvaTaux: 20, ecoHt: 0.14,
    origine: '650/1/1', famille: 'Mobilier', prixAchatHt: 801,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.typeDevis, 'Additif');
  const d = get(T.devis, r.json.devisId).fields;
  assert.equal(d['Type devis'], 'Additif');
  const l = get(T.lignes, d['Lignes devis'][0]).fields;
  assert.equal(l['Catégorie'], 'Mobilier');
  assert.equal(l['Prix achat HT'], 801);
});
