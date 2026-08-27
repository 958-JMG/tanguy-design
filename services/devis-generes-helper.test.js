/**
 * Tests services/devis-generes-helper.js — node --test natif (ADR-004).
 * Usage : node --test services/devis-generes-helper.test.js
 *
 * Scénario de référence : dossier MORALES. Deux devis sur le même projet,
 * D-2026-101 signé puis REFUSÉ (ses 4 BC sont restés), D-2026-107 accepté.
 * Le nettoyage ne doit toucher QUE les artefacts de D-2026-101.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  matchNumero, estAutoGenerePar, risqueCommande,
  commandesGenereesPar, tachesGenereesPar, echeancesFactureesAlerte,
  resumeGeneres, filtrerIdsAutorises,
} = require('./devis-generes-helper');

const notesAuto = (num) => `[Auto-généré depuis devis ${num} signé le 12/06/2026]\n\nContenu prévisionnel…`;

describe('matchNumero()', () => {
  test('trouve le numéro suivi du suffixe d\'index du BC', () => {
    assert.equal(matchNumero('MORALES · MEUBLES · D-2026-101-1', 'D-2026-101'), true);
  });

  test('PIÈGE : ne confond pas D-2026-10 avec D-2026-101', () => {
    // Sans contrôle de frontière, ce test passe au vert et le nettoyage
    // supprimerait les BC du devis 101 en croyant nettoyer le devis 10.
    assert.equal(matchNumero('MORALES · MEUBLES · D-2026-101-1', 'D-2026-10'), false);
    assert.equal(matchNumero('D-2026-1017', 'D-2026-101'), false);
  });

  test('accepte le numéro en début et en fin de chaîne', () => {
    assert.equal(matchNumero('D-2026-101 signé', 'D-2026-101'), true);
    assert.equal(matchNumero('devis D-2026-101', 'D-2026-101'), true);
    assert.equal(matchNumero('D-2026-101', 'D-2026-101'), true);
  });

  test('tolère le séparateur « · » et les accents autour', () => {
    assert.equal(matchNumero('MORALES·D-2026-101·MEUBLES', 'D-2026-101'), true);
    assert.equal(matchNumero('échéance D-2026-101 réglée', 'D-2026-101'), true);
  });

  test('numéro ou texte vide → false (jamais de match attrape-tout)', () => {
    assert.equal(matchNumero('MORALES · MEUBLES · D-2026-101-1', ''), false);
    assert.equal(matchNumero('', 'D-2026-101'), false);
    assert.equal(matchNumero(null, null), false);
  });
});

describe('estAutoGenerePar()', () => {
  test('reconnaît la signature laissée par POST /devis/:id/sign', () => {
    assert.equal(estAutoGenerePar(notesAuto('D-2026-101'), 'D-2026-101'), true);
  });

  test('des notes qui citent le devis sans être auto-générées ne suffisent pas', () => {
    assert.equal(estAutoGenerePar('Voir devis D-2026-101 pour le détail', 'D-2026-101'), false);
  });

  test('signature d\'un AUTRE devis → false', () => {
    assert.equal(estAutoGenerePar(notesAuto('D-2026-107'), 'D-2026-101'), false);
  });
});

describe('risqueCommande()', () => {
  test('BC neuf sans AR → aucun risque', () => {
    assert.equal(risqueCommande({ statut: 'Créée', montantAR: 0 }), null);
  });

  test('AR reçu → risque signalé (le fournisseur a confirmé)', () => {
    const r = risqueCommande({ statut: 'Créée', montantAR: 4200 });
    assert.match(r, /AR reçu/);
    assert.match(r, /4200/);
  });

  test('statut avancé → risque signalé', () => {
    assert.match(risqueCommande({ statut: 'Envoyée', montantAR: 0 }), /Envoyée/);
  });

  test('facture fournisseur reçue → risque signalé', () => {
    assert.match(risqueCommande({ statut: 'Créée', factureRecue: true }), /Facture/);
  });
});

describe('commandesGenereesPar() — dossier MORALES', () => {
  const commandes = [
    // Les 4 BC du devis REFUSÉ D-2026-101
    { id: 'c1', numero: 'MORALES · MEUBLES · D-2026-101-1', type: 'Meubles', statut: 'Créée', montantHT: 12000, montantAR: 0, notes: notesAuto('D-2026-101') },
    { id: 'c2', numero: 'MORALES · ÉLECTROMÉNAGER · D-2026-101-2', type: 'Électroménager', statut: 'Créée', montantHT: 3400, montantAR: 0, notes: notesAuto('D-2026-101') },
    { id: 'c3', numero: 'MORALES · ACCESSOIRES · D-2026-101-3', type: 'Accessoires', statut: 'Créée', montantHT: 900, montantAR: 0, notes: notesAuto('D-2026-101') },
    { id: 'c4', numero: 'MORALES · PLAN DE TRAVAIL · D-2026-101-4', type: 'Plan de travail', statut: 'Créée', montantHT: 0, montantAR: 0, notes: notesAuto('D-2026-101') },
    // Les BC du devis ACCEPTÉ D-2026-107 — à ne JAMAIS toucher
    { id: 'c5', numero: 'MORALES · MEUBLES · D-2026-107-1', type: 'Meubles', statut: 'Envoyée', montantHT: 12500, montantAR: 12500, notes: notesAuto('D-2026-107') },
    { id: 'c6', numero: 'MORALES · PLAN DE TRAVAIL · D-2026-107-2', type: 'Plan de travail', statut: 'Créée', montantHT: 0, montantAR: 0, notes: notesAuto('D-2026-107') },
  ];

  test('ne retient que les BC du devis refusé', () => {
    const r = commandesGenereesPar(commandes, 'D-2026-101');
    assert.deepEqual(r.map(c => c.id), ['c1', 'c2', 'c3', 'c4']);
  });

  test('les BC du devis accepté ne sont jamais proposés', () => {
    const ids = commandesGenereesPar(commandes, 'D-2026-101').map(c => c.id);
    assert.equal(ids.includes('c5'), false);
    assert.equal(ids.includes('c6'), false);
  });

  test('tous suggérés à la suppression (aucun n\'a bougé)', () => {
    const r = commandesGenereesPar(commandes, 'D-2026-101');
    assert.equal(r.every(c => c.suggere === true), true);
    assert.equal(r.every(c => c.risque === null), true);
  });

  test('un BC du devis refusé mais confirmé par AR est proposé DÉCOCHÉ', () => {
    const avecAR = commandes.map(c => c.id === 'c1' ? { ...c, montantAR: 11800 } : c);
    const c1 = commandesGenereesPar(avecAR, 'D-2026-101').find(c => c.id === 'c1');
    assert.equal(c1.suggere, false);
    assert.match(c1.risque, /AR reçu/);
  });

  test('détection par le numéro seul quand les notes ont été réécrites', () => {
    const sansNotes = [{ id: 'x', numero: 'MORALES · MEUBLES · D-2026-101-1', statut: 'Créée', notes: 'Notes réécrites à la main' }];
    const r = commandesGenereesPar(sansNotes, 'D-2026-101');
    assert.equal(r.length, 1);
    assert.equal(r[0].source, 'numero');
  });

  test('devis jamais signé → aucun BC, donc rien à proposer', () => {
    assert.deepEqual(commandesGenereesPar(commandes, 'D-2026-999'), []);
  });

  test('numéro absent → liste vide (pas de suppression massive)', () => {
    assert.deepEqual(commandesGenereesPar(commandes, ''), []);
    assert.deepEqual(commandesGenereesPar(commandes, null), []);
  });
});

describe('tachesGenereesPar()', () => {
  const taches = [
    { id: 't1', titre: 'Envoyer facture acompte — D-2026-101', statut: 'À faire', assigneeA: 'Virginie' },
    { id: 't2', titre: 'Envoyer commandes fournisseurs — D-2026-101', statut: 'À faire', assigneeA: 'Virginie' },
    { id: 't3', titre: 'Notifier artisans contractuels — devis D-2026-101 signé', statut: 'Terminée', assigneeA: 'Virginie' },
    { id: 't4', titre: 'Envoyer facture acompte — D-2026-107', statut: 'À faire', assigneeA: 'Virginie' },
    { id: 't5', titre: 'Rappeler le client', statut: 'À faire', description: 'Point sur le devis D-2026-101' },
  ];

  test('retient les tâches du devis, titre ou description', () => {
    const ids = tachesGenereesPar(taches, 'D-2026-101').map(t => t.id);
    assert.deepEqual(ids, ['t1', 't2', 't3', 't5']);
  });

  test('une tâche terminée est proposée DÉCOCHÉE (c\'est de l\'historique)', () => {
    const t3 = tachesGenereesPar(taches, 'D-2026-101').find(t => t.id === 't3');
    assert.equal(t3.suggere, false);
    assert.match(t3.risque, /termin/i);
  });

  test('les tâches de l\'autre devis sont épargnées', () => {
    assert.equal(tachesGenereesPar(taches, 'D-2026-101').some(t => t.id === 't4'), false);
  });
});

describe('echeancesFactureesAlerte()', () => {
  test('remonte les échéances déjà facturées, sans jamais les supprimer', () => {
    const r = echeancesFactureesAlerte([
      { id: 'e1', libelle: 'Acompte 30%', montantPrevu: 4500, facturePennylaneId: 'pl_123' },
      { id: 'e2', libelle: 'Solde', montantPrevu: 10500 },
      { id: 'e3', libelle: 'Intermédiaire', montantPrevu: 3000, numeroFacture: 'FC-2026-018' },
    ]);
    assert.deepEqual(r.map(e => e.id), ['e1', 'e3']);
    assert.equal(r[1].reference, 'FC-2026-018');
  });

  test('aucune facture → tableau vide', () => {
    assert.deepEqual(echeancesFactureesAlerte([{ id: 'e1', libelle: 'Acompte' }]), []);
  });
});

describe('resumeGeneres()', () => {
  const base = {
    numero: 'D-2026-101',
    commandes: [
      { id: 'c1', numero: 'X · D-2026-101-1', statut: 'Créée', notes: notesAuto('D-2026-101') },
      { id: 'c2', numero: 'X · D-2026-101-2', statut: 'Envoyée', notes: notesAuto('D-2026-101') },
    ],
    taches: [{ id: 't1', titre: 'Envoyer facture acompte — D-2026-101', statut: 'À faire' }],
    echeances: [{ id: 'e1', libelle: 'Acompte', facturePennylaneId: 'pl_1' }],
  };

  test('compte les supprimables, les suggérés et ceux à risque', () => {
    const r = resumeGeneres(base);
    assert.equal(r.totalSupprimables, 3);
    assert.equal(r.totalSuggere, 2);   // c1 + t1 (c2 est « Envoyée »)
    assert.equal(r.aRisque, 1);
    assert.equal(r.rien, false);
    assert.equal(r.echeancesFacturees.length, 1);
  });

  test('devis sans artefact → rien:true (l\'UI n\'affiche aucune modale)', () => {
    const r = resumeGeneres({ ...base, numero: 'D-2026-999' });
    assert.equal(r.rien, true);
    assert.equal(r.totalSupprimables, 0);
  });
});

describe('filtrerIdsAutorises() — garde-fou serveur', () => {
  const detectes = [{ id: 'c1' }, { id: 'c2' }];

  test('un id non détecté est rejeté, pas supprimé', () => {
    const r = filtrerIdsAutorises(['c1', 'recAUTREPROJET'], detectes);
    assert.deepEqual(r.autorises, ['c1']);
    assert.deepEqual(r.rejetes, ['recAUTREPROJET']);
  });

  test('déduplique les ids envoyés deux fois', () => {
    assert.deepEqual(filtrerIdsAutorises(['c1', 'c1', 'c2'], detectes).autorises, ['c1', 'c2']);
  });

  test('liste vide → rien d\'autorisé', () => {
    assert.deepEqual(filtrerIdsAutorises([], detectes).autorises, []);
    assert.deepEqual(filtrerIdsAutorises(undefined, detectes).autorises, []);
  });
});
