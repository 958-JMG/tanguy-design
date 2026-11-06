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
test('création express : les erreurs indiquent le champ à compléter au clic du CTA', async () => {
  const { calculPrixImport } = await import('../public/v3/assets/js/core/devis-prix.mjs');
  for (const [saisie, champ] of [
    [{ montantDocumentHt: 1000, ecoHt: 10 }, 'ecoIncluse'],
    [{ montantDocumentHt: 0, ecoHt: 0 }, 'montantDocumentHt'],
    [{ montantDocumentHt: 1000, ecoHt: -1 }, 'ecoHt'],
    [{ montantDocumentHt: 1000, ecoHt: 1001, ecoIncluse: true }, 'ecoHt'],
  ]) assert.throws(() => calculPrixImport(saisie), e => e.champ === champ && Boolean(e.message));
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
test('fiche : vérifie l’annexe réelle, sans écrire, et distingue une version modifiée', async () => {
  const devis = get(T.devis, devisId);
  const quoteId = devis.fields['Pennylane quote ID'];
  const avant = banc.pennylaneRecu.length;
  const lire = () => banc.appel('GET', `/api/devis/${devisId}/pennylane/annexe`);
  let r = await lire();
  assert.equal(r.status, 200);
  assert.equal(r.json.jointe, true);
  assert.match(r.json.filename, /^descriptif-/);
  const ligne = get(T.lignes, devis.fields['Lignes devis'][0]);
  const initial = ligne.fields.Désignation;
  ligne.fields.Désignation += '\nNouvelle finition';
  try {
    r = await lire();
    assert.equal(r.json.jointe, false);
    assert.equal(r.json.annexe, null);
    banc.annexeErreur.status = 403;
    r = await lire();
    assert.equal(r.status, 502);
    assert.match(r.json.error, /403/);
    assert.equal(r.json.jointe, undefined);
  } finally {
    ligne.fields.Désignation = initial;
    banc.annexeErreur.status = 0;
  }
  assert.equal(banc.pennylaneRecu.length, avant);
  assert.equal(banc.pennylaneAnnexes.get(quoteId).length, 1);
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
test('panneaux → éco automatique → devis express → ligne Pennylane, sans double ajout', async () => {
  const { creerSuiviEco } = await import('../public/v3/assets/js/core/devis-eco.mjs');
  const { calculPrixImport } = await import('../public/v3/assets/js/core/devis-prix.mjs');
  let ecoHt = 0, etat;
  const suivi = creerSuiviEco({
    calculer: async pieces => {
      const r = await banc.appel('POST', '/api/eco-contribution/calcul', { pieces, tauxTvaPct: 20 });
      assert.equal(r.status, 200); return r.json;
    },
    reporter: n => { ecoHt = n; }, changer: e => { etat = e; },
  });
  await suivi.actualiser([{ designation: 'Tablettes fictives', quantite: 4, type: 'Joue / panneau', largeurMm: 800, hauteurMm: 500, epaisseurMm: 19, classeMatiere: 'Panneaux particules ≥75% - sans gestion durable' }]);
  assert.equal(etat.bloque, false); assert.ok(ecoHt > 0);
  for (const ecoIncluse of [true, false]) {
    const montantDocumentHt = 2000;
    const prix = calculPrixImport({ montantDocumentHt, ecoHt, ecoIncluse });
    const r = await banc.appel('POST', '/api/devis-express/creer-devis', { projetId: 'recPROJET', designation: 'Dressing fictif', montantDocumentHt, ecoHt, ecoIncluse, prixClientHt: prix.prixClientHt, tvaTaux: 20, famille: 'Mobilier' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(get(T.devis, r.json.devisId).fields['Eco-participation mobilier'], ecoHt);
    const pl = await banc.appel('POST', `/api/devis/${r.json.devisId}/pennylane`, {});
    assert.equal(pl.status, 200, JSON.stringify(pl.json));
    const lignes = banc.pennylaneRecu.at(-1).invoice_lines;
    const eco = lignes.filter(l => /éco-participation/i.test(l.label));
    assert.equal(eco.length, 1);
    assert.equal(Number(eco[0].raw_currency_unit_price), ecoHt);
    const total = Math.round(lignes.reduce((s, l) => s + Number(l.raw_currency_unit_price) * l.quantity, 0) * 100) / 100;
    assert.equal(total, prix.prixClientHt);
  }
});
