/**
 * Tests des compteurs de congés — node --test natif (ADR-004).
 *
 * Les cas reprennent les données RÉELLES de la base Tanguy au 02/09/2026 :
 *   • 4 salariés, dont 3 SANS date d'entrée ;
 *   • 8 absences, dont DEUX PAIRES qui se recouvrent (doublons de saisie) —
 *     c'est ce qui donnait 50 jours de congés à Sébastien et 31 à Thomas ;
 *   • soldes stockés absurdes (−25, −6) parce que l'ancien compteur ne faisait
 *     que descendre.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  paques, joursFeries, estOuvrable, joursOuvrablesEntre, estOuvre, joursOuvresEntre,
  periodeDeReference, moisComplets, congesAcquis,
  joursPosesDistincts, heuresSuppDeLaPeriode, rttDepuisHeures,
  compteurConges, compteursEquipe,
} = require('./conges-helper');

describe('jours fériés', () => {
  test('Pâques 2026 tombe le 5 avril', () => {
    const p = paques(2026);
    assert.equal(p.getUTCFullYear(), 2026);
    assert.equal(p.getUTCMonth(), 3);
    assert.equal(p.getUTCDate(), 5);
  });
  test('Pâques 2024 tombe le 31 mars, 2025 le 20 avril', () => {
    assert.equal(paques(2024).getUTCDate(), 31);
    assert.equal(paques(2024).getUTCMonth(), 2);
    assert.equal(paques(2025).getUTCDate(), 20);
    assert.equal(paques(2025).getUTCMonth(), 3);
  });
  test('les fériés mobiles 2026 découlent de Pâques', () => {
    const f = joursFeries(2026);
    assert.ok(f.has('2026-04-06'), 'lundi de Pâques');
    assert.ok(f.has('2026-05-14'), 'Ascension');
    assert.ok(f.has('2026-05-25'), 'lundi de Pentecôte');
  });
  test('les fériés fixes sont là, et il y en a 11', () => {
    const f = joursFeries(2026);
    for (const d of ['2026-01-01','2026-05-01','2026-05-08','2026-07-14','2026-08-15','2026-11-01','2026-11-11','2026-12-25']) {
      assert.ok(f.has(d), d);
    }
    assert.equal(f.size, 11);
  });
  test('le Vendredi saint n\'est PAS férié (Tanguy est à Vannes, pas en Alsace-Moselle)', () => {
    assert.equal(joursFeries(2026).has('2026-04-03'), false);
  });
});

describe('jours ouvrables (lundi → samedi, hors fériés)', () => {
  test('le samedi est ouvrable, le dimanche non', () => {
    assert.equal(estOuvrable('2026-09-05'), true, 'samedi');
    assert.equal(estOuvrable('2026-09-06'), false, 'dimanche');
  });
  test('un férié en semaine n\'est pas ouvrable', () => {
    assert.equal(estOuvrable('2026-07-14'), false, '14 juillet, un mardi');
  });
  test('une semaine pleine vaut 6 jours ouvrables', () => {
    // Lundi 7 au dimanche 13 septembre 2026.
    assert.equal(joursOuvrablesEntre('2026-09-07', '2026-09-13').length, 6);
  });
  test('la semaine du 14 juillet 2026 n\'en vaut que 5', () => {
    assert.equal(joursOuvrablesEntre('2026-07-13', '2026-07-19').length, 5);
  });
  test('un seul jour', () => {
    assert.deepEqual(joursOuvrablesEntre('2026-09-07', '2026-09-07'), ['2026-09-07']);
  });
  test('bornes inversées ou invalides → liste vide, sans planter', () => {
    assert.deepEqual(joursOuvrablesEntre('2026-09-10', '2026-09-01'), []);
    assert.deepEqual(joursOuvrablesEntre('', '2026-09-01'), []);
    assert.deepEqual(joursOuvrablesEntre('2026-02-31', '2026-03-02'), [], '31 février refusé');
    assert.deepEqual(joursOuvrablesEntre(null, null), []);
  });
});

describe('période de référence 1er juin → 31 mai', () => {
  test('le 02/09/2026 appartient à 2026-2027', () => {
    assert.deepEqual(periodeDeReference('2026-09-02'),
      { debut: '2026-06-01', fin: '2027-05-31', libelle: '1ᵉʳ juin 2026 – 31 mai 2027' });
  });
  test('le 31 mai appartient encore à la période précédente', () => {
    assert.equal(periodeDeReference('2027-05-31').debut, '2026-06-01');
  });
  test('le 1er juin ouvre la nouvelle période', () => {
    assert.equal(periodeDeReference('2027-06-01').debut, '2027-06-01');
  });
  test('janvier appartient à la période ouverte en juin précédent', () => {
    assert.equal(periodeDeReference('2027-01-15').debut, '2026-06-01');
  });
  test('date invalide → erreur explicite, pas un calcul silencieux', () => {
    assert.throws(() => periodeDeReference('02/09/2026'), /date invalide/);
  });
});

describe('acquisition — 2,5 jours ouvrables par mois, plafond 30', () => {
  const periode = periodeDeReference('2026-09-02');

  test('au 02/09/2026, trois mois complets → 7,5 jours', () => {
    const a = congesAcquis({ dateEntree: '2022-09-09', periode, aujourdhui: '2026-09-02' });
    assert.equal(a.mois, 3);
    assert.equal(a.jours, 7.5);
    assert.equal(a.entreeInconnue, false);
  });

  test('le jour même de l\'ouverture, rien n\'est encore acquis', () => {
    assert.equal(congesAcquis({ dateEntree: '2020-01-01', periode, aujourdhui: '2026-06-01' }).jours, 0);
  });

  test('une période complète vaut bien les 30 jours légaux', () => {
    // Le compte par date anniversaire s'arrêtait à 11 mois — le 12ᵉ serait tombé
    // au 1ᵉʳ juin suivant, hors période — et donnait 27,5 jours pour une année
    // pleine. Un salarié à l'année doit avoir 30.
    const a = congesAcquis({ dateEntree: '2020-01-01', periode, aujourdhui: '2027-05-31' });
    assert.equal(a.mois, 12);
    assert.equal(a.jours, 30);
  });

  test('on ne compte jamais au-delà de la fin de période', () => {
    // Interrogé bien après la clôture, le compteur reste celui de la période.
    const a = congesAcquis({ dateEntree: '2020-01-01', periode, aujourdhui: '2028-12-31' });
    assert.equal(a.mois, 12);
    assert.equal(a.jours, 30);
    assert.equal(a.plafonne, false, '12 × 2,5 = 30 pile, pas de plafonnement');
  });

  test('un mois entamé ne compte pas : entrée le 15 août → acquisition dès septembre', () => {
    const a = congesAcquis({ dateEntree: '2026-08-15', periode, aujourdhui: '2026-09-30' });
    assert.equal(a.mois, 1, 'septembre seulement, août est incomplet');
    assert.equal(a.jours, 2.5);
  });

  test('le mois en cours n\'est pas acquis avant sa fin', () => {
    assert.equal(congesAcquis({ dateEntree: '2020-01-01', periode, aujourdhui: '2026-06-30' }).mois, 1);
    assert.equal(congesAcquis({ dateEntree: '2020-01-01', periode, aujourdhui: '2026-06-29' }).mois, 0);
  });

  test('entrée en cours de période → acquisition à partir de l\'entrée', () => {
    const a = congesAcquis({ dateEntree: '2026-08-01', periode, aujourdhui: '2026-10-01' });
    assert.equal(a.mois, 2);
    assert.equal(a.debutAcquisition, '2026-08-01');
  });

  test('entrée postérieure à aujourd\'hui → rien d\'acquis', () => {
    assert.equal(congesAcquis({ dateEntree: '2027-01-01', periode, aujourdhui: '2026-09-02' }).jours, 0);
  });

  test('SANS date d\'entrée → présence supposée depuis le début, ET c\'est signalé', () => {
    // 3 salariés sur 4 sont dans ce cas au 02/09 : le chiffre ne doit pas passer
    // pour une certitude.
    const a = congesAcquis({ dateEntree: null, periode, aujourdhui: '2026-09-02' });
    assert.equal(a.jours, 7.5);
    assert.equal(a.entreeInconnue, true);
    assert.equal(a.debutAcquisition, '2026-06-01');
  });
});

describe('jours posés — comptés DISTINCTS, jamais additionnés', () => {
  const periode = periodeDeReference('2026-09-02');
  const base = { types: ['Congés payés'], periode, aujourdhui: '2026-09-02' };

  test('deux absences qui se recouvrent ne comptent les jours qu\'une fois', () => {
    // Cas réel de Thomas : 10→30 août ET 10→31 août, saisis deux fois.
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', salarieId: 's', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-30' },
      { id: 'b', salarieId: 's', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-31' },
    ]});
    // 10 → 31 août : 19 jours ouvrables (les 3 dimanches 16, 23, 30 exclus, 15 août férié... un samedi).
    assert.equal(r.jours, joursOuvrablesEntre('2026-08-10', '2026-08-31').length);
    assert.ok(r.jours < 19 + 18, 'et surtout : pas la somme des deux');
    assert.equal(r.chevauchements.length, 1);
    assert.equal(r.chevauchements[0].duDebut, '2026-08-10');
    assert.equal(r.chevauchements[0].auFin, '2026-08-30');
  });

  test('deux absences disjointes s\'additionnent normalement', () => {
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-06-08', dateFin: '2026-06-13' },
      { id: 'b', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-06', dateFin: '2026-07-11' },
    ]});
    assert.equal(r.jours, 12);
    assert.equal(r.chevauchements.length, 0);
  });

  test('seules les absences Validées comptent', () => {
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Congés payés', statut: 'Demandée', dateDebut: '2026-06-08', dateFin: '2026-06-13' },
      { id: 'b', type: 'Congés payés', statut: 'Refusée',  dateDebut: '2026-07-06', dateFin: '2026-07-11' },
    ]});
    assert.equal(r.jours, 0);
  });

  test('les autres types d\'absence ne touchent pas au compteur CP', () => {
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Maladie', statut: 'Validée', dateDebut: '2026-08-01', dateFin: '2026-08-31' },
    ]});
    assert.equal(r.jours, 0);
  });

  test('une absence à cheval sur la période n\'est comptée que pour sa part', () => {
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-05-25', dateFin: '2026-06-06' },
    ]});
    assert.equal(r.jours, joursOuvrablesEntre('2026-06-01', '2026-06-06').length);
  });

  test('posé et pris sont deux chiffres différents', () => {
    // Sébastien a un congé validé qui court jusqu'au 20/09, soit dans le futur.
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-31', dateFin: '2026-09-05' },
    ]});
    assert.equal(r.jusquAujourdhui, joursOuvrablesEntre('2026-08-31', '2026-09-02').length);
    assert.equal(r.aVenir, joursOuvrablesEntre('2026-09-03', '2026-09-05').length);
    assert.equal(r.jours, r.jusquAujourdhui + r.aVenir);
  });

  test('absence sans date de fin = un seul jour', () => {
    const r = joursPosesDistincts({ ...base, absences: [
      { id: 'a', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-06-08' },
    ]});
    assert.equal(r.jours, 1);
  });
});

describe('compteurConges() — sur les données réelles du 02/09/2026', () => {
  const AUJ = '2026-09-02';
  const SALARIES = [
    { id: 'seb',    nom: 'LE DREF Sébastien',  dateEntree: '2022-09-09' },
    { id: 'thomas', nom: 'LE BRAZIDEC Thomas', dateEntree: null },
    { id: 'marine', nom: 'DA SILVA Marine',    dateEntree: null },
    { id: 'solene', nom: 'LORHO Solène',       dateEntree: null },
  ];
  // Les 8 absences telles qu'elles sont en base.
  const ABSENCES = [
    { id: 'a1', salarieId: 'marine', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-20', dateFin: '2026-07-31' },
    { id: 'a2', salarieId: 'solene', type: 'Maladie',      statut: 'Validée', dateDebut: '2026-07-17', dateFin: '2026-07-31' },
    { id: 'a3', salarieId: 'solene', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-01', dateFin: '2026-07-16' },
    { id: 'a4', salarieId: 'thomas', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-30' },
    { id: 'a5', salarieId: 'seb',    type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-27', dateFin: '2026-08-16' },
    { id: 'a6', salarieId: 'thomas', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-31' },
    { id: 'a7', salarieId: 'seb',    type: 'Congés payés', statut: 'Validée', dateDebut: '2026-08-01', dateFin: '2026-09-20' },
    { id: 'a8', salarieId: 'solene', type: 'Maladie',      statut: 'Validée', dateDebut: '2026-08-01', dateFin: '2026-08-31' },
  ];
  const compteurs = compteursEquipe({ salaries: SALARIES, absences: ABSENCES, aujourdhui: AUJ });
  const par = nom => compteurs.find(c => c.salarieId === nom);

  test('les droits ouverts viennent de la période PRÉCÉDENTE, pas de celle en cours', () => {
    // Les congés d'été 2026 se prennent sur les droits acquis en 2025-2026.
    // Compter « acquis cette période − pris cette période » mettait les 4
    // salariés en négatif au 02/09 : un compteur faux, comme celui remplacé.
    for (const c of compteurs) {
      assert.equal(c.droitsOuverts, 30, c.nom);
      assert.equal(c.periodePrecedente.debut, '2025-06-01');
      assert.equal(c.periodePrecedente.fin, '2026-05-31');
    }
  });

  test('l\'acquisition de l\'année en cours est comptée à part', () => {
    // 3 mois écoulés au 02/09 → 7,5 jours, disponibles au 1er juin prochain.
    for (const c of compteurs) {
      assert.equal(c.enAcquisition, 7.5, c.nom);
      assert.equal(c.moisAcquis, 3);
    }
  });

  test('trois salariés sur quatre gardent un solde positif', () => {
    const positifs = compteurs.filter(c => c.solde >= 0).map(c => c.nom);
    assert.equal(positifs.length, 3);
    assert.ok(!positifs.includes('LE DREF Sébastien'));
  });

  test('Sébastien : ses deux absences se recouvrent, les jours communs comptent une fois', () => {
    const c = par('seb');
    // 27/07 → 20/09 en jours ouvrables distincts, pas 15 + 35 = 50.
    assert.equal(c.poses, joursOuvrablesEntre('2026-07-27', '2026-09-20').length);
    assert.notEqual(c.poses, 50);
    assert.equal(c.chevauchements.length, 1);
  });

  test('Sébastien : le congé qui court jusqu\'au 20/09 est « à venir », pas « pris »', () => {
    const c = par('seb');
    assert.ok(c.aVenir > 0, 'des jours restent dans le futur');
    assert.equal(c.pris + c.aVenir, c.poses);
  });

  test('Thomas : le doublon du 10 août est absorbé', () => {
    const c = par('thomas');
    assert.equal(c.poses, joursOuvrablesEntre('2026-08-10', '2026-08-31').length);
    assert.notEqual(c.poses, 31);
    assert.equal(c.chevauchements.length, 1);
  });

  test('Solène : ses deux arrêts maladie ne consomment aucun congé', () => {
    const c = par('solene');
    assert.equal(c.poses, joursOuvrablesEntre('2026-07-01', '2026-07-16').length);
    assert.equal(c.chevauchements.length, 0);
  });

  test('Marine : un seul congé, sans chevauchement', () => {
    const c = par('marine');
    assert.equal(c.poses, joursOuvrablesEntre('2026-07-20', '2026-07-31').length);
    assert.equal(c.solde, Math.round((30 - c.poses) * 10) / 10, 'solde = droits ouverts − posés');
  });

  test('Sébastien reste en dépassement — et c\'est le signe de sa donnée cassée', () => {
    // 47 jours ouvrables posés pour 30 de droits : près de 8 semaines d'affilée,
    // au-delà du maximum légal. Le compteur ne masque pas l'anomalie.
    const c = par('seb');
    assert.equal(c.droitsOuverts, 30);
    assert.ok(c.poses > 30, `posés = ${c.poses}`);
    assert.ok(c.solde < 0);
    assert.equal(c.depassement, true);
    assert.ok(c.limites.some(l => /Solde de congés négatif/.test(l)));
  });

  test('Thomas, Marine et Solène ont un solde qui a du sens', () => {
    for (const id of ['thomas', 'marine', 'solene']) {
      const c = par(id);
      assert.equal(c.solde, Math.round((30 - c.poses) * 10) / 10, c.nom);
      assert.ok(c.solde > 0, `${c.nom} : ${c.solde}`);
      assert.equal(c.depassement, false);
    }
  });

  test('la date d\'entrée manquante est remontée dans les limites', () => {
    assert.ok(par('thomas').limites.some(l => /Date d'entrée inconnue/.test(l)));
    assert.equal(par('thomas').entreeInconnue, true);
    assert.equal(par('seb').limites.some(l => /Date d'entrée inconnue/.test(l)), false);
  });

  test('les chevauchements sont remontés dans les limites', () => {
    assert.ok(par('seb').limites.some(l => /se recouvrent/.test(l)));
    assert.equal(par('marine').limites.some(l => /se recouvrent/.test(l)), false);
  });

  test('aucun droit RTT n\'est inventé tant que la fiche ne les définit pas', () => {
    for (const c of compteurs) {
      assert.equal(c.rttParAn, null, c.nom);
      assert.equal(c.rttDroits, null, c.nom);
    }
  });

  test('des RTT posés sont comptés et signalés, sans produire de solde', () => {
    const c = compteurConges({
      salarie: { id: 'x', nom: 'X', dateEntree: null },
      absences: [{ id: 'r', salarieId: 'x', type: 'RTT', statut: 'Validée', dateDebut: '2026-06-08', dateFin: '2026-06-09' }],
      aujourdhui: AUJ,
    });
    assert.equal(c.rttPoses, 2);
    assert.equal(c.rttDroits, null);
    assert.equal(c.poses, 0, 'un RTT ne consomme pas de congé payé');
    assert.ok(c.limites.some(l => /ni « Jours RTT par an » ni « Heures pour 1 RTT » ne sont réglés/.test(l)));
  });

  test('un salarié sans absence dispose de tous ses droits ouverts', () => {
    const c = compteurConges({ salarie: { id: 'z', nom: 'Z' }, absences: [], aujourdhui: AUJ });
    assert.equal(c.poses, 0);
    assert.equal(c.solde, 30);
    assert.equal(c.enAcquisition, 7.5);
    assert.equal(c.depassement, false);
  });

  test('un salarié entré en cours d\'année précédente a des droits réduits', () => {
    // Entrée au 1er décembre 2025 → 6 mois sur la période précédente → 15 jours.
    const c = compteurConges({ salarie: { id: 'n', nom: 'Nouveau', dateEntree: '2025-12-01' }, absences: [], aujourdhui: AUJ });
    assert.equal(c.droitsOuverts, 15);
    assert.equal(c.entreeInconnue, false);
  });

  test('un salarié entré APRÈS la période précédente n\'a aucun droit ouvert', () => {
    const c = compteurConges({ salarie: { id: 'n2', nom: 'Tout neuf', dateEntree: '2026-07-01' }, absences: [], aujourdhui: AUJ });
    assert.equal(c.droitsOuverts, 0);
    assert.equal(c.enAcquisition, 5, 'juillet et août acquis sur la période en cours');
  });

  test('les absences d\'un autre salarié ne fuient pas dans le compteur', () => {
    const c = compteurConges({ salarie: { id: 'marine', nom: 'Marine' }, absences: ABSENCES, aujourdhui: AUJ });
    assert.equal(c.poses, joursOuvrablesEntre('2026-07-20', '2026-07-31').length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Paramètres par salarié (02/09/2026) — Virginie règle les droits sur la fiche
// de chaque salarié plutôt que d'attendre une règle unique dans le code.
// ════════════════════════════════════════════════════════════════════════════

describe('jours ouvrés (unité des RTT)', () => {
  test('le samedi n\'est PAS un jour ouvré, contrairement aux jours ouvrables', () => {
    assert.equal(estOuvre('2026-09-05'), false, 'samedi');
    assert.equal(estOuvrable('2026-09-05'), true, 'samedi, mais ouvrable');
  });
  test('une semaine pleine vaut 5 jours ouvrés et 6 ouvrables', () => {
    assert.equal(joursOuvresEntre('2026-09-07', '2026-09-13').length, 5);
    assert.equal(joursOuvrablesEntre('2026-09-07', '2026-09-13').length, 6);
  });
  test('un férié en semaine ne compte pas non plus', () => {
    assert.equal(estOuvre('2026-07-14'), false);
  });
});

describe('« Jours CP par an » de la fiche salarié', () => {
  const periode = periodeDeReference('2026-09-02');

  test('vide → 30 jours ouvrables, le minimum légal', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A' }, absences: [], aujourdhui: '2026-09-02' });
    assert.equal(c.cpParAn, 30);
    assert.equal(c.droitsOuverts, 30);
    assert.equal(c.cpParAnPersonnalise, false);
  });

  test('une convention plus favorable se règle sur la fiche', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursCpAn: 35 }, absences: [], aujourdhui: '2026-09-02' });
    assert.equal(c.cpParAn, 35);
    assert.equal(c.droitsOuverts, 35);
    assert.equal(c.cpParAnPersonnalise, true);
  });

  test('un décompte en jours ouvrés (25/an) suit le même chemin', () => {
    // 25/12 = 2,08/mois. Sur une période pleine on retombe bien sur 25.
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursCpAn: 25 }, absences: [], aujourdhui: '2026-09-02' });
    assert.equal(c.droitsOuverts, 25);
    // Trois mois de la période en cours : 3 × 2,08 = 6,25 → arrondi au dixième.
    assert.equal(c.enAcquisition, 6.3);
  });

  test('valeur absurde (0, négative, texte) → on retombe sur le défaut légal', () => {
    for (const v of [0, -5, null, undefined, 'douze']) {
      const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursCpAn: v }, absences: [], aujourdhui: '2026-09-02' });
      assert.equal(c.cpParAn, 30, `valeur ${JSON.stringify(v)}`);
    }
  });
});

describe('« Report CP » — le reliquat repris du bulletin', () => {
  test('vide → 0, rien ne change', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A' }, absences: [], aujourdhui: '2026-09-02' });
    assert.equal(c.report, 0);
    assert.equal(c.droitsOuverts, 30);
  });

  test('un reliquat s\'ajoute aux droits ouverts', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', reportCp: 8.5 }, absences: [], aujourdhui: '2026-09-02' });
    assert.equal(c.report, 8.5);
    assert.equal(c.droitsOuverts, 38.5);
  });

  test('il peut sortir un salarié du rouge — cas réel de Sébastien', () => {
    // 47 jours posés pour 30 de droits → −17. Avec 20 jours de report : +3.
    const abs = [{ id: 'x', salarieId: 's', type: 'Congés payés', statut: 'Validée',
                   dateDebut: '2026-07-27', dateFin: '2026-09-20' }];
    const sans = compteurConges({ salarie: { id: 's', nom: 'S', dateEntree: '2022-09-09' }, absences: abs, aujourdhui: '2026-09-02' });
    const avec = compteurConges({ salarie: { id: 's', nom: 'S', dateEntree: '2022-09-09', reportCp: 20 }, absences: abs, aujourdhui: '2026-09-02' });
    assert.equal(sans.depassement, true);
    assert.equal(avec.depassement, false);
    assert.equal(avec.solde, Math.round((50 - sans.poses) * 10) / 10);
  });

  test('le message de solde négatif mentionne le report quand il existe', () => {
    const abs = [{ id: 'x', salarieId: 's', type: 'Congés payés', statut: 'Validée',
                   dateDebut: '2026-06-01', dateFin: '2026-08-31' }];
    const c = compteurConges({ salarie: { id: 's', nom: 'S', reportCp: 3 }, absences: abs, aujourdhui: '2026-09-02' });
    assert.ok(c.limites.some(l => /Solde de congés négatif/.test(l) && /dont 3 de report/.test(l)));
  });
});

describe('« Jours RTT par an » — le compteur n\'existe que si Virginie le règle', () => {
  const AUJ = '2026-09-02';
  const rttAbs = [{ id: 'r1', salarieId: 'a', type: 'RTT', statut: 'Validée', dateDebut: '2026-06-08', dateFin: '2026-06-12' }];

  test('vide → aucun droit calculé, mais les RTT posés sont comptés et signalés', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A' }, absences: rttAbs, aujourdhui: AUJ });
    assert.equal(c.rttParAn, null);
    assert.equal(c.rttDroits, null);
    assert.equal(c.rttSolde, null);
    assert.equal(c.rttPoses, 5, 'lundi → vendredi = 5 jours ouvrés');
    assert.ok(c.limites.some(l => /ni « Jours RTT par an » ni « Heures pour 1 RTT » ne sont réglés/.test(l)));
  });

  test('renseigné → le compteur apparaît, au prorata des mois écoulés', () => {
    // 12 RTT/an = 1 par mois ; 3 mois écoulés au 02/09 → 3 acquis, 5 posés.
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursRttAn: 12 }, absences: rttAbs, aujourdhui: AUJ });
    assert.equal(c.rttParAn, 12);
    assert.equal(c.rttDroits, 3);
    assert.equal(c.rttPoses, 5);
    assert.equal(c.rttSolde, -2);
    assert.equal(c.rttDepassement, true);
    assert.ok(c.limites.some(l => /Solde RTT négatif/.test(l)));
    assert.equal(c.limites.some(l => /ne sont réglés/.test(l)), false, 'plus de message « à paramétrer »');
  });

  test('renseigné et non dépassé → solde positif, aucune alerte', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursRttAn: 24 }, absences: rttAbs, aujourdhui: AUJ });
    assert.equal(c.rttDroits, 6);
    assert.equal(c.rttSolde, 1);
    assert.equal(c.rttDepassement, false);
    assert.equal(c.limites.length, 1, 'seule la date d\'entrée inconnue subsiste');
  });

  test('mis à 0 → traité comme « pas de RTT »', () => {
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursRttAn: 0 }, absences: rttAbs, aujourdhui: AUJ });
    assert.equal(c.rttDroits, null);
  });

  test('les RTT ne touchent jamais au compteur de congés payés, et réciproquement', () => {
    const melange = [
      { id: 'r', salarieId: 'a', type: 'RTT', statut: 'Validée', dateDebut: '2026-06-08', dateFin: '2026-06-12' },
      { id: 'c', salarieId: 'a', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-06', dateFin: '2026-07-11' },
    ];
    const c = compteurConges({ salarie: { id: 'a', nom: 'A', joursRttAn: 12 }, absences: melange, aujourdhui: AUJ });
    assert.equal(c.rttPoses, 5, 'RTT en jours ouvrés');
    assert.equal(c.poses, 6, 'CP en jours ouvrables, samedi compris');
  });

  test('les RTT se comptent en jours OUVRÉS : une plage qui inclut un samedi vaut 5, pas 6', () => {
    // La plage DOIT couvrir un samedi, sinon les deux unités donnent le même
    // chiffre et le test ne prouve rien : lundi 8 → samedi 13 juin 2026.
    const memePlage = (type) => [{ id: 'x', salarieId: 'a', type, statut: 'Validée',
      dateDebut: '2026-06-08', dateFin: '2026-06-13' }];
    const enRtt = compteurConges({ salarie: { id: 'a', nom: 'A', joursRttAn: 12 }, absences: memePlage('RTT'), aujourdhui: AUJ });
    const enCp  = compteurConges({ salarie: { id: 'a', nom: 'A' }, absences: memePlage('Congés payés'), aujourdhui: AUJ });
    assert.equal(enRtt.rttPoses, 5, 'RTT : le samedi ne compte pas');
    assert.equal(enCp.poses, 6, 'CP : le samedi compte');
  });
});

describe('les paramètres n\'altèrent pas les salariés existants', () => {
  test('sans aucun paramètre, les chiffres du 02/09 sont inchangés', () => {
    // Marine : 11 jours posés, 30 de droits → 19. Le comportement livré ce matin.
    const c = compteurConges({
      salarie: { id: 'marine', nom: 'DA SILVA Marine' },
      absences: [{ id: 'a1', salarieId: 'marine', type: 'Congés payés', statut: 'Validée', dateDebut: '2026-07-20', dateFin: '2026-07-31' }],
      aujourdhui: '2026-09-02' });
    assert.equal(c.droitsOuverts, 30);
    assert.equal(c.poses, 11);
    assert.equal(c.solde, 19);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Heures supplémentaires → RTT (remarque JMG du 02/09) : une alternante comme
// Marine cumule des heures supp et les transforme en RTT. Ses RTT ne viennent
// donc pas d'un droit annuel. Cas réel en base : 35 h + 10 h supp, semaine du
// 31/08, NON validées.
// ════════════════════════════════════════════════════════════════════════════

describe('cumul des heures supplémentaires', () => {
  const periode = periodeDeReference('2026-09-02');

  test('validées et en attente sont comptées séparément', () => {
    const r = heuresSuppDeLaPeriode({ periode, heures: [
      { semaine: '2026-08-31', heuresSupp: 10, valide: false },
      { semaine: '2026-08-24', heuresSupp: 4,  valide: true },
      { semaine: '2026-08-17', heuresSupp: 3,  valide: true },
    ]});
    assert.equal(r.validees, 7);
    assert.equal(r.enAttente, 10);
  });

  test('une semaine hors période ne compte pas', () => {
    const r = heuresSuppDeLaPeriode({ periode, heures: [
      { semaine: '2026-05-25', heuresSupp: 8, valide: true },   // période précédente
      { semaine: '2026-06-01', heuresSupp: 5, valide: true },
    ]});
    assert.equal(r.validees, 5);
  });

  test('heures nulles, négatives ou illisibles ignorées sans planter', () => {
    const r = heuresSuppDeLaPeriode({ periode, heures: [
      { semaine: '2026-07-06', heuresSupp: 0, valide: true },
      { semaine: '2026-07-13', heuresSupp: -3, valide: true },
      { semaine: '2026-07-20', heuresSupp: 'huit', valide: true },
      null,
      { heuresSupp: 5, valide: true },        // sans semaine
    ]});
    assert.deepEqual(r, { validees: 0, enAttente: 0 });
  });

  test('conversion en jours', () => {
    assert.equal(rttDepuisHeures(14, 7), 2);
    assert.equal(rttDepuisHeures(10, 7), 1.4);
    assert.equal(rttDepuisHeures(0, 7), 0);
  });

  test('sans taux de conversion, rien ne se convertit', () => {
    for (const taux of [null, undefined, 0, -7, 'sept']) {
      assert.equal(rttDepuisHeures(14, taux), 0, `taux ${JSON.stringify(taux)}`);
    }
  });
});

describe('les RTT de Marine viennent de ses heures, pas d\'un droit annuel', () => {
  const AUJ = '2026-09-02';
  const marine = { id: 'marine', nom: 'DA SILVA Marine' };
  // La saisie réelle de la base au 02/09 : 10 h supp, NON validées.
  const heuresReelles = [{ salarieId: 'marine', semaine: '2026-08-31', heuresSupp: 10, valide: false }];

  test('heures non validées → aucun RTT, et on le DIT', () => {
    const c = compteurConges({ salarie: { ...marine, heuresPour1Rtt: 7 }, heures: heuresReelles, aujourdhui: AUJ });
    assert.equal(c.heuresSuppEnAttente, 10);
    assert.equal(c.heuresSuppValidees, 0);
    assert.equal(c.rttConverti, 0);
    assert.equal(c.rttDroits, 0, 'le compteur existe, mais à zéro');
    assert.ok(c.limites.some(l => /10 h supplémentaires .*attendent d'être validées/.test(l)));
  });

  test('une fois validées, elles deviennent des RTT', () => {
    const c = compteurConges({
      salarie: { ...marine, heuresPour1Rtt: 7 },
      heures: [{ salarieId: 'marine', semaine: '2026-08-31', heuresSupp: 14, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.heuresSuppValidees, 14);
    assert.equal(c.rttConverti, 2);
    assert.equal(c.rttDroits, 2);
    assert.equal(c.rttSolde, 2);
  });

  test('sans « Heures pour 1 RTT », des heures validées ne donnent rien — et l\'écran le signale', () => {
    // Le silence serait le pire cas : des heures dues qui n'apparaissent nulle part.
    const c = compteurConges({
      salarie: marine,
      heures: [{ salarieId: 'marine', semaine: '2026-08-31', heuresSupp: 14, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.rttDroits, null);
    assert.equal(c.heuresSuppValidees, 14);
    assert.ok(c.limites.some(l => /14 h supplémentaires validées ne donnent aucun RTT/.test(l)));
  });

  test('les RTT posés se déduisent des heures converties', () => {
    const c = compteurConges({
      salarie: { ...marine, heuresPour1Rtt: 7 },
      absences: [{ id: 'r', salarieId: 'marine', type: 'RTT', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-10' }],
      heures: [{ salarieId: 'marine', semaine: '2026-08-31', heuresSupp: 21, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.rttDroits, 3);
    assert.equal(c.rttPoses, 1);
    assert.equal(c.rttSolde, 2);
    assert.equal(c.rttDepassement, false);
  });

  test('poser plus de RTT que d\'heures converties passe en dépassement', () => {
    const c = compteurConges({
      salarie: { ...marine, heuresPour1Rtt: 7 },
      absences: [{ id: 'r', salarieId: 'marine', type: 'RTT', statut: 'Validée', dateDebut: '2026-08-10', dateFin: '2026-08-14' }],
      heures: [{ salarieId: 'marine', semaine: '2026-08-31', heuresSupp: 7, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.rttDroits, 1);
    assert.equal(c.rttPoses, 5);
    assert.equal(c.rttSolde, -4);
    assert.equal(c.rttDepassement, true);
  });

  test('les deux sources se cumulent : droit annuel ET heures converties', () => {
    // Un salarié à 39 h qui fait aussi des heures supp au-delà.
    const c = compteurConges({
      salarie: { id: 'x', nom: 'X', joursRttAn: 12, heuresPour1Rtt: 7 },
      heures: [{ salarieId: 'x', semaine: '2026-08-31', heuresSupp: 14, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.rttAnnuel, 3, '3 mois écoulés à 1 RTT/mois');
    assert.equal(c.rttConverti, 2);
    assert.equal(c.rttDroits, 5);
  });

  test('les heures d\'un autre salarié ne fuient pas dans le compteur', () => {
    const c = compteurConges({
      salarie: { ...marine, heuresPour1Rtt: 7 },
      heures: [{ salarieId: 'autre', semaine: '2026-08-31', heuresSupp: 70, valide: true }],
      aujourdhui: AUJ });
    assert.equal(c.heuresSuppValidees, 0);
    assert.equal(c.rttDroits, 0);
  });

  test('aucune heure fournie → comportement d\'avant, inchangé', () => {
    const c = compteurConges({ salarie: marine, aujourdhui: AUJ });
    assert.equal(c.heuresSuppValidees, 0);
    assert.equal(c.heuresSuppEnAttente, 0);
    assert.equal(c.rttDroits, null);
  });
});
