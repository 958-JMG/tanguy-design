const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleEco = import('../public/v3/assets/js/core/devis-eco.mjs');
const complet = montant => ({ totalHt: montant, piecesCalculees: 1, piecesIncalculables: 0, lignes: [{ ecoHtUnitaire: montant, totalHt: montant }] });
const differe = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('panneaux : report automatique initial puis mise à jour sans clic supplémentaire', async () => {
  const { creerSuiviEco } = await moduleEco;
  const montants = [], etats = [];
  const suivi = creerSuiviEco({ calculer: async ([n]) => complet(n), reporter: n => montants.push(n), changer: e => etats.push(e) });
  await suivi.actualiser([8]);
  await suivi.actualiser([16]);
  assert.deepEqual(montants, [8, 16]);
  assert.equal(etats[0].bloque, true);
  assert.equal(etats.at(-1).bloque, false);
});
test('document et saisie : un calcul ne remplace pas le montant choisi sans report explicite', async () => {
  const { creerSuiviEco } = await moduleEco;
  for (const source of ['document', 'manuel']) {
    const montants = [];
    const suivi = creerSuiviEco({ source, calculer: async () => complet(8), reporter: n => montants.push(n) });
    await suivi.actualiser([1]);
    assert.deepEqual(montants, []);
    suivi.utiliserPanneaux();
    await suivi.actualiser([1]);
    assert.deepEqual(montants, [8]);
  }
});
test('une saisie manuelle pendant le calcul reste prioritaire', async () => {
  const { creerSuiviEco } = await moduleEco;
  const d = differe(), montants = [], etats = [];
  const suivi = creerSuiviEco({ calculer: () => d.promise, reporter: n => montants.push(n), changer: e => etats.push(e) });
  const p = suivi.actualiser([1]); suivi.manuel(); d.resolve(complet(8)); await p;
  assert.deepEqual(montants, []);
  assert.equal(etats.at(-1).bloque, false);
});
test('dimensions manquantes, liste vide ou résultat partiel : aucun total reporté, création bloquée', async () => {
  const { creerSuiviEco } = await moduleEco;
  for (const res of [
    { totalHt: 8, piecesCalculees: 1, piecesIncalculables: 1, lignes: [{ totalHt: 8, ecoHtUnitaire: 8 }, { totalHt: null, ecoHtUnitaire: null }] },
    { totalHt: 0, piecesCalculees: 0, piecesIncalculables: 0, lignes: [] },
    { ...complet(8), lignes: [] },
  ]) {
    let etat, montant;
    const suivi = creerSuiviEco({ calculer: async () => res, reporter: n => { montant = n; }, changer: e => { etat = e; } });
    await suivi.actualiser([1, 2]);
    assert.equal(montant, undefined);
    assert.equal(etat.bloque, true);
    assert.equal(etat.statut, 'incomplet');
  }
});
test('modification pendant le délai de saisie : une ancienne réponse ne peut plus alimenter le devis', async () => {
  const { creerSuiviEco } = await moduleEco;
  const d = differe(), montants = [], etats = [];
  let appels = 0;
  const suivi = creerSuiviEco({ calculer: () => ++appels === 1 ? d.promise : Promise.resolve(complet(16)), reporter: n => montants.push(n), changer: e => etats.push(e) });
  const premier = suivi.actualiser([1]); suivi.invalider();
  d.resolve(complet(8)); await premier;
  assert.deepEqual(montants, []);
  assert.equal(etats.at(-1).bloque, true);
  await suivi.actualiser([2]);
  assert.deepEqual(montants, [16]);
});
test('échec réseau et reprise : ancien montant inutilisable jusqu’au nouveau calcul complet', async () => {
  const { creerSuiviEco } = await moduleEco;
  let erreur = true, etat;
  const suivi = creerSuiviEco({ calculer: async () => { if (erreur) throw new Error('Réseau indisponible'); return complet(8); }, changer: e => { etat = e; } });
  await suivi.actualiser([1]);
  assert.equal(etat.bloque, true); assert.match(etat.erreur, /Réseau/);
  erreur = false; await suivi.actualiser([1]);
  assert.equal(etat.bloque, false);
});
test('nouvel import : réponse de l’ancien écran ignorée', async () => {
  const { creerSuiviEco } = await moduleEco;
  const d = differe(), montants = [];
  const suivi = creerSuiviEco({ calculer: () => d.promise, reporter: n => montants.push(n) });
  const p = suivi.actualiser([1]); suivi.detruire(); d.resolve(complet(8)); await p;
  assert.deepEqual(montants, []);
});
