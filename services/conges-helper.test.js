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
  paques, joursFeries, estOuvrable, joursOuvrablesEntre,
  periodeDeReference, moisComplets, congesAcquis,
  joursPosesDistincts, compteurConges, compteursEquipe,
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
    assert.ok(c.limites.some(l => /Solde négatif/.test(l)));
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

  test('aucun droit RTT n\'est inventé', () => {
    for (const c of compteurs) assert.equal(c.droitsRTT, null, c.nom);
  });

  test('des RTT posés sont comptés et signalés, sans produire de solde', () => {
    const c = compteurConges({
      salarie: { id: 'x', nom: 'X', dateEntree: null },
      absences: [{ id: 'r', salarieId: 'x', type: 'RTT', statut: 'Validée', dateDebut: '2026-06-08', dateFin: '2026-06-09' }],
      aujourdhui: AUJ,
    });
    assert.equal(c.rttPoses, 2);
    assert.equal(c.droitsRTT, null);
    assert.equal(c.poses, 0, 'un RTT ne consomme pas de congé payé');
    assert.ok(c.limites.some(l => /droits RTT ne sont pas paramétrés/.test(l)));
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
