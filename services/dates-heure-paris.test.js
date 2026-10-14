'use strict';
// Dates et heures écrites par le serveur pour un humain : à l'heure de Paris.
//
// Le conteneur Scaleway tourne en UTC. Sans fuseau explicite, le serveur écrivait
// 22:30 pour 00:30 à Paris, et la date de la VEILLE entre 22 h/23 h et minuit
// (constat du 14/10/2026). Ce processus est mis sur UTC comme le conteneur : sans
// cela, le test passerait sur un Mac réglé sur Paris même avec le défaut.
//
// L'horloge est figée au mercredi 14/10/2026 à 00:30 à Paris, soit le 13/10 à
// 22:30 UTC : l'heure exacte où l'ancien code se trompait de jour.
//
// Chaque affichage est pris sur son VRAI chemin : routes du serveur (signature,
// BC, journal, Pennylane) via le banc d'essai, générateurs PDF lus par leur texte,
// ZIP d'export relu octet par octet.
process.env.TZ = 'UTC';
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const banc = require('./fixtures/banc-serveur')({ secret: 'secret-de-test-dates-paris-14-10-2026' });
const { T, put, get, table, pennylaneRecu, referencesPrises } = banc;
const { normaliserArticles } = require('./devis-electro');

const MAINTENANT = new Date('2026-10-13T22:30:00.000Z'); // 14/10/2026 00:30 à Paris
const PARIS = '14/10/2026';
const VEILLE = '13/10/2026';

function semer() {
  put(T.clients, 'recCLI', { Nom: 'CLIENT DATES', 'Pennylane customer ID': '555', Adresse: '1 rue du Test\n56000 VANNES' });
  put(T.fournisseurs, 'recLAGO', { Nom: 'LAGO', 'Catégories': ['Mobilier'] });
  put(T.fournisseurs, 'recFINDIS', { Nom: 'Findis', 'Catégories': ['Électroménager'] });
  put(T.projets, 'recPRJ', { 'Référence': 'Cuisine dates', Client: ['recCLI'], Devis: ['recDEV'] });
  put(T.devis, 'recDEV', { 'Numéro devis': '800/1/1', 'Type devis': 'Principal', Statut: 'Envoyé', Projet: ['recPRJ'], 'Lignes devis': ['recL1'] });
  put(T.lignes, 'recL1', { Position: '1', 'Catégorie': 'Mobilier', 'Désignation': 'Meuble bas 60', 'Montant HT': 1000, Devis: ['recDEV'] });
}

before(async () => {
  semer();
  await banc.demarrer();
  mock.timers.enable({ apis: ['Date'], now: MAINTENANT });
});
after(() => { mock.timers.reset(); return banc.arreter(); });

const nouvellesCommandes = avant => [...table(T.commandes).values()].filter(c => !avant.has(c.id)).map(c => c.fields);

async function texteDuPdf(buffer) {
  const unpdf = require('unpdf');
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  return text;
}

test('horloge du test : 22:30 UTC le 13, soit 00:30 le 14 à Paris', () => {
  assert.equal(new Date().toISOString(), '2026-10-13T22:30:00.000Z');
});

test('signature : les notes des BC disent « signé le 14/10/2026 », pas la veille', async () => {
  const avant = new Set(table(T.commandes).keys());
  const r = await banc.appel('POST', '/api/devis/recDEV/sign', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const bcs = nouvellesCommandes(avant);
  assert.equal(bcs.length, 2, 'un BC Mobilier + le BC « Plan de travail » à compléter');
  for (const bc of bcs) {
    assert.match(bc.Notes, new RegExp(`\\[Auto-généré depuis devis 800/1/1 signé le ${PARIS}\\]`), bc.Notes);
    assert.doesNotMatch(bc.Notes, new RegExp(VEILLE));
  }
});

test('fiche devis → « Créer le BC » : « lignes ajoutées le 14/10/2026 »', async () => {
  put(T.lignes, 'recL2', { Position: '2', 'Catégorie': 'Mobilier', 'Désignation': 'Colonne four', 'Montant HT': 800, Devis: ['recDEV'] });
  get(T.devis, 'recDEV').fields['Lignes devis'].push('recL2');
  const avant = new Set(table(T.commandes).keys());
  const r = await banc.appel('POST', '/api/devis/recDEV/commande-lignes', { ligneIds: ['recL2'], categorie: 'Mobilier' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [bc] = nouvellesCommandes(avant);
  assert.match(bc.Notes, new RegExp(`lignes ajoutées le ${PARIS} depuis la fiche devis`), bc.Notes);
  assert.doesNotMatch(bc.Notes, new RegExp(VEILLE));
});

test('BC rendu (aperçu / mail) : « Imprimé : 14/10/2026 », date du BC sans heure jamais décalée', async () => {
  put(T.commandes, 'recBCHTML', { 'Numéro': 'CLIENT DATES · MOBILIER · 800/1/1-9', 'Date création': '2026-10-14', Fournisseur: ['recLAGO'] });
  const r = await banc.appel('GET', '/api/commandes/recBCHTML/render');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.html, new RegExp(`Imprimé : ${PARIS}`));
  assert.match(r.json.html, new RegExp(PARIS), 'Date création (champ date) : le 14 reste le 14');
  assert.doesNotMatch(r.json.html, new RegExp(VEILLE));
});

test('BC en PDF : sans « Date création », la date du jour est celle de Paris', async () => {
  const { generateBcPdf } = require('./bc-pdf-generator');
  const texte = await texteDuPdf(await generateBcPdf({ commande: { 'Numéro': 'BC-DATES-1' }, fournisseur: null, lignes: [] }));
  assert.match(texte, new RegExp(PARIS), texte);
  assert.doesNotMatch(texte, new RegExp(VEILLE));
});

test('BC en PDF : champs date sans heure (création, livraison, envoi) recopiés tels quels', async () => {
  const { generateBcPdf } = require('./bc-pdf-generator');
  const texte = await texteDuPdf(await generateBcPdf({
    commande: { 'Numéro': 'BC-DATES-2', 'Date création': '2026-10-14', 'Date livraison prévue': '2026-11-02', 'Date envoi': '2026-10-15' },
    fournisseur: null, lignes: [],
  }));
  for (const d of ['14/10/2026', '02/11/2026', '15/10/2026']) assert.match(texte, new RegExp(d), texte);
  assert.doesNotMatch(texte, new RegExp(VEILLE));
});

test('fiche de mission : « Fiche générée le 14/10/2026 », dates du devis artisan intactes', async () => {
  const { generateFicheMission } = require('./fiche-mission-generator');
  const texte = await texteDuPdf(await generateFicheMission({
    projetRef: 'Cuisine dates', clientNom: 'CLIENT DATES', adresseChantier: '1 rue du Test', artisanNom: 'Plomberie Test',
    numeroDevis: 'DV1', dateDevis: '2026-10-01', dateDemarrage: '2026-11-02', descriptionTravaux: 'Raccordements',
  }));
  assert.match(texte, new RegExp(`Fiche générée le ${PARIS}`), texte);
  assert.match(texte, /01\/10\/2026/);
  assert.match(texte, /02\/11\/2026/);
  assert.doesNotMatch(texte, new RegExp(VEILLE));
});

test('journal chantier : l\'entrée est datée [2026-10-14 00:30 — Virginie]', async () => {
  const r = await banc.appel('POST', '/api/projets/recPRJ/journal', { text: 'Livraison des meubles OK' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.entry, '[2026-10-14 00:30 — Virginie] Livraison des meubles OK');
  assert.match(get(T.projets, 'recPRJ').fields['Journal chantier'], /^\[2026-10-14 00:30 — Virginie\]/);
});

test('Pennylane : référence déjà prise → suffixe horodaté à l\'heure de Paris', async () => {
  const pennylane = require('./pennylane');
  referencesPrises.add('REF-DATES');
  try {
    const q = await pennylane.createDraftQuote({
      customer_id: '555', date: '2026-10-14', deadline: '2026-11-13', external_reference: 'REF-DATES',
      lines: [{ label: 'Cuisine', quantity: 1, raw_currency_unit_price: '100.00', unit: 'piece', vat_rate: 'FR_200' }],
    });
    assert.equal(q.reference, 'REF-DATES · 14/10 00:30:00');
    assert.equal(pennylaneRecu.at(-1).external_reference, 'REF-DATES · 14/10 00:30:00');
  } finally { referencesPrises.clear(); }
});

test('Pennylane : régénération d\'un devis → « (régén. 14/10 00:30:00) »', async () => {
  const articles = normaliserArticles(require(path.join(__dirname, 'fixtures', 'findis', 'projet-35789.json'))).articles;
  put(T.projets, 'recPRJ2', { 'Référence': 'Projet électro', Client: ['recCLI'] });
  const c = await banc.appel('POST', '/api/devis-express/findis/creer-devis', { projetId: 'recPRJ2', tvaTaux: 20, projetFindis: '35789', articles });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const numero = get(T.devis, c.json.devisId).fields['Numéro devis'];
  const r = await banc.appel('POST', `/api/devis/${c.json.devisId}/pennylane`, { force: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(pennylaneRecu.at(-1).external_reference, `${numero} (régén. 14/10 00:30:00)`);
});

// --- Export de réversibilité : lecteur ZIP minimal (EOCD + répertoire central) ---
function lireZip(buf) {
  const eocd = buf.length - 22;
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = {}; let p = cdOff;
  for (let i = 0; i < count; i++) {
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const method = buf.readUInt16LE(lho + 8), csize = buf.readUInt32LE(lho + 18);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    out[name] = { texte: (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'), heure: buf.readUInt16LE(lho + 10), jour: buf.readUInt16LE(lho + 12) };
    p += 46 + nlen + elen + clen;
  }
  return out;
}

test('export : « Généré le 14/10/2026 00:30:00 », réversibilité « établie le 14/10/2026 », fichiers du ZIP à 00:30', () => {
  const ex = require('./export');
  const { buffer } = ex.assembleZip([{ table: 'Clients', slug: 'clients', rows: [{ id: 'rec1', Nom: 'X' }] }], { cabinet: 'Tanguy Design', when: new Date() });
  const zip = lireZip(buffer);
  assert.match(zip['LISEZ-MOI.txt'].texte, /Généré le 14\/10\/2026 00:30:00/);
  assert.match(zip['reversibilite.html'].texte, new RegExp(`document établi le ${PARIS}`));
  for (const f of ['LISEZ-MOI.txt', 'reversibilite.html']) assert.doesNotMatch(zip[f].texte, new RegExp(VEILLE));
  // Date DOS des fichiers (sans fuseau, lue comme heure locale par le Finder) : 14/10/2026 00:30:00.
  const { heure, jour } = zip['LISEZ-MOI.txt'];
  assert.deepEqual(
    { annee: 1980 + (jour >> 9), mois: (jour >> 5) & 0xf, jour: jour & 0x1f, h: heure >> 11, min: (heure >> 5) & 0x3f },
    { annee: 2026, mois: 10, jour: 14, h: 0, min: 30 });
});
