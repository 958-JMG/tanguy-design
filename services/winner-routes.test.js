'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const banc = require('./fixtures/banc-serveur')();
const { T, put, get, table, champsInconnus } = banc;
const exemple = require('./fixtures/winner-ordre');
let lectures = 0;
// Seule la lecture IA est simulée, jamais d'envoi de PDF à un service externe.
require.cache[require.resolve('./devis-parser')] = { exports: {
  parsePlaudTranscript: async () => { throw new Error('PLAUD non utilisé dans cet essai'); },
  parseDevisPdf: async () => { lectures++; return structuredClone(exemple); },
} };
process.env.ANTHROPIC_API_KEY = 'cle-fictive-ne-pas-utiliser';
before(async () => {
  put(T.clients, 'recCLI', { Nom: 'CLIENT FICTIF' });
  put(T.projets, 'recPRJ', { 'Référence': 'Cuisine fictive', Client: ['recCLI'] });
  [...new Set(exemple.lignes.map(l => l.fournisseur))].forEach((Nom, i) => put(T.fournisseurs, `recFO${i}`, { Nom }));
  await banc.demarrer();
});
after(() => banc.arreter());
function formulaire() {
  const fd = new FormData();
  fd.append('pdf', new Blob(['%PDF-1.4\nPDF fictif pour test de route'], { type: 'application/pdf' }), 'test.pdf');
  fd.append('projetId', 'recPRJ');
  return fd;
}
let devisId;
test('import : champs absents → refus avant parsing et avant toute création', async () => {
  champsInconnus.set(T.lignes, new Set(['Ordre Winner']));
  try {
    const r = await banc.envoyer('/api/devis/import', formulaire());
    assert.match(r.json.error, /champs Winner.*Aucun devis créé/);
    assert.equal(lectures, 0);
    assert.equal(table(T.devis).size, 0);
  } finally { champsInconnus.delete(T.lignes); }
});
test('import : ordre, sections, noms, sous-lignes, ligne sans code et montant nul sont enregistrés', async () => {
  const r = await banc.envoyer('/api/devis/import', formulaire());
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  devisId = r.json.devisId;
  const lignes = get(T.devis, devisId).fields['Lignes devis'].map(id => get(T.lignes, id));
  assert.equal(lignes.length, 40);
  assert.deepEqual(lignes.map(l => l.fields.Position), exemple.lignes.map(l => l.position));
  assert.deepEqual(lignes.map(l => l.fields['Ordre Winner']), Array.from({ length: 40 }, (_, i) => i + 1));
  const sousLigne = lignes.find(l => l.fields.Position === '3.1');
  assert.equal(sousLigne.fields.Zone?.length, 1);
  assert.equal(lignes.find(l => l.fields.Position === '7.3').fields['Montant HT'], 0);
  assert.equal(lignes.at(-1).fields['Section Winner'], 'Accessoires');
  assert.equal(lignes.at(-1).fields['Fournisseur Winner'], 'Accessoires Test');
  // Simuler le retour Airtable dans un ordre différent de la création.
  const inversees = [...table(T.lignes).entries()].reverse();
  table(T.lignes).clear();
  for (const [id, l] of inversees) table(T.lignes).set(id, l);
  const detail = await banc.appel('GET', `/api/devis/${devisId}/detail`);
  assert.deepEqual(detail.json.lignes.map(l => l.fields.Position), exemple.lignes.map(l => l.position));
  assert.equal(detail.json.lignes.at(-1).fournisseurNom, 'Accessoires Test');
});
test('signature : six modules dans le déroulé Winner, bons rattachés et aucune ligne perdue', async () => {
  const r = await banc.appel('POST', `/api/devis/${devisId}/sign`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.commandes_creees, 6);
  const bcs = [...table(T.commandes).values()];
  assert.deepEqual(bcs.map(c => c.fields['Référence courte']), ['MOBILIER', 'PLAN', 'PANNEAUX', 'ELECTRO', 'SANITAIRE', 'ACCESS']);
  assert.ok(bcs.every(c => c.fields.Fournisseur?.length === 1));
  const lignes = bcs.flatMap(c => JSON.parse(c.fields['Lignes BC']));
  assert.deepEqual(lignes.map(l => l.pos), exemple.lignes.map(l => l.position));
  assert.equal(new Set(lignes.map(l => l.ligneDevisId)).size, 40);
  const orphelines = await banc.appel('GET', `/api/devis/${devisId}/lignes-sans-commande`);
  assert.deepEqual(orphelines.json.lignes, []);
  const html = await banc.appel('GET', `/api/commandes/${bcs.at(-1).id}/render`);
  assert.match(html.json.html, /Accessoires Test/);
  assert.ok(html.json.html.indexOf('TEST-2.1') < html.json.html.indexOf('TEST-4.2'));
});
test('commande manuelle : sélection multi-fournisseurs refusée, sans écriture partielle', async () => {
  put(T.devis, 'recMAN', { 'Numéro devis': 'TEST-MAN', Statut: 'Signé', Projet: ['recPRJ'], 'Lignes devis': ['recM1', 'recM2'] });
  ['recM1', 'recM2'].forEach((id, i) => put(T.lignes, id, { Position: String(i + 1), 'Code produit': id, 'Catégorie': 'Meubles', 'Fournisseur Winner': i ? 'Pierre Test' : 'Atelier Test' }));
  const avant = table(T.commandes).size;
  const r = await banc.appel('POST', '/api/devis/recMAN/commande-lignes', { ligneIds: ['recM1', 'recM2'], categorie: 'Mobilier' });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /plusieurs fournisseurs/);
  assert.equal(table(T.commandes).size, avant);
});
