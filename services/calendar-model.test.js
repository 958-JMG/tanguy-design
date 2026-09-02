/**
 * Tests du modèle d'agenda — node --test natif (ADR-004).
 *
 * Le module vit côté navigateur (ES module) ; on le charge ici en transposant
 * ses exports, même procédé que client-match.test.js.
 *
 * Les jeux de données reprennent les formes RÉELLES de la base Tanguy
 * (relevé du 02/09/2026) :
 *   • Rendez-vous : 22 records, 16 avec lien Projet, 6 sans — mais tous avec un client.
 *   • Commandes   : lien Projet renseigné à 100 %.
 *   • SAV         : AUCUN champ Projet dans la table, seulement Client.
 *   • Référence projet = texte libre (« Cuisine M »), pas un code.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'public/v3/assets/js/core/calendar-model.js');
const code = fs.readFileSync(SRC, 'utf8').replace(/^export /gm, '');
// eslint-disable-next-line no-new-func
const {
  indexProjetsParId, indexProjetsParClient, resoudreProjet,
  lundiDeLaSemaine, joursDeLaSemaine, minutesDeIso, heureCourte,
  disposerEnColonnes, amplitudeHoraire, jourDeValeurDate,
} = new Function(`${code}; return { indexProjetsParId, indexProjetsParClient, resoudreProjet,
  lundiDeLaSemaine, joursDeLaSemaine, minutesDeIso, heureCourte,
  disposerEnColonnes, amplitudeHoraire, jourDeValeurDate };`)();

// Projets tels qu'ils arrivent de /api/data/projets : { id, ...fields }
const PROJETS = [
  { id: 'p1', 'Référence': 'Cuisine M',      Client: ['c1'] },
  { id: 'p2', 'Référence': 'Salle de bain',  Client: ['c2'] },
  { id: 'p3', 'Référence': 'Dressing',       Client: ['c2'] },  // c2 a DEUX projets
  { id: 'p4', 'Référence': '  Cuisine T2  ', Client: ['c3'] },  // espaces parasites (cf. client-match)
  { id: 'p5', 'Référence': '',               Client: ['c4'] },  // référence vide (1 cas réel sur 163)
];

describe('resoudreProjet() — d\'où vient le nom affiché', () => {
  const idx = { parId: indexProjetsParId(PROJETS), parClient: indexProjetsParClient(PROJETS) };

  test('lien Projet renseigné → nom direct, origine "lien"', () => {
    assert.deepEqual(resoudreProjet({ projetLink: ['p1'], clientLink: ['c1'] }, idx),
      { nom: 'Cuisine M', origine: 'lien' });
  });

  test('la référence est nettoyée de ses espaces parasites', () => {
    assert.equal(resoudreProjet({ projetLink: ['p4'] }, idx).nom, 'Cuisine T2');
  });

  test('SAV sans lien Projet, client à UN seul projet → déduit, origine "client"', () => {
    // Cas des 2 SAV réellement visibles à l'agenda le 02/09.
    assert.deepEqual(resoudreProjet({ clientLink: ['c1'] }, idx),
      { nom: 'Cuisine M', origine: 'client' });
  });

  test('client à PLUSIEURS projets → on n\'invente pas, origine "ambigu"', () => {
    // Envoyer un poseur sur le mauvais chantier coûte plus cher qu'un libellé vide.
    assert.deepEqual(resoudreProjet({ clientLink: ['c2'] }, idx),
      { nom: null, origine: 'ambigu' });
  });

  test('ni projet ni client → "aucun"', () => {
    assert.deepEqual(resoudreProjet({}, idx), { nom: null, origine: 'aucun' });
  });

  test('client inconnu de l\'index → "aucun"', () => {
    assert.deepEqual(resoudreProjet({ clientLink: ['zzz'] }, idx), { nom: null, origine: 'aucun' });
  });

  test('lien vers un projet absent du jeu chargé → "aucun", SANS repli sur le client', () => {
    // Le repli client donnerait « Cuisine M » alors que le RDV pointe un autre projet.
    assert.deepEqual(resoudreProjet({ projetLink: ['pX'], clientLink: ['c1'] }, idx),
      { nom: null, origine: 'aucun' });
  });

  test('projet lié mais à référence vide → "aucun" (pas de libellé fantôme)', () => {
    assert.deepEqual(resoudreProjet({ projetLink: ['p5'], clientLink: ['c4'] }, idx),
      { nom: null, origine: 'aucun' });
  });

  test('liens vides ou nuls ne cassent pas', () => {
    assert.equal(resoudreProjet({ projetLink: [], clientLink: null }, idx).origine, 'aucun');
    assert.equal(resoudreProjet({ projetLink: null }, idx).origine, 'aucun');
  });
});

describe('index projets', () => {
  test('parId ignore les entrées sans id', () => {
    assert.equal(indexProjetsParId([{ 'Référence': 'X' }, null, { id: 'p9', 'Référence': 'Y' }]).size, 1);
  });
  test('parClient regroupe bien les projets d\'un même client', () => {
    assert.equal(indexProjetsParClient(PROJETS).get('c2').length, 2);
  });
  test('un projet sans client n\'est pas indexé par client', () => {
    assert.equal(indexProjetsParClient([{ id: 'p', 'Référence': 'R' }]).size, 0);
  });
  test('listes nulles → index vides', () => {
    assert.equal(indexProjetsParId(null).size, 0);
    assert.equal(indexProjetsParClient(undefined).size, 0);
  });
});

describe('semaines', () => {
  test('lundi d\'un mercredi', () => {
    // mercredi 2 septembre 2026 → lundi 31 août 2026
    const l = lundiDeLaSemaine(new Date(2026, 8, 2));
    assert.equal(l.getFullYear(), 2026); assert.equal(l.getMonth(), 7); assert.equal(l.getDate(), 31);
  });
  test('un dimanche appartient à la semaine qui commence le lundi précédent', () => {
    const l = lundiDeLaSemaine(new Date(2026, 8, 6)); // dimanche 6 sept.
    assert.equal(l.getDate(), 31); assert.equal(l.getMonth(), 7);
  });
  test('un lundi est son propre lundi', () => {
    const l = lundiDeLaSemaine(new Date(2026, 8, 7));
    assert.equal(l.getDate(), 7);
  });
  test('joursDeLaSemaine rend 7 jours consécutifs lundi → dimanche', () => {
    const js = joursDeLaSemaine(new Date(2026, 8, 2));
    assert.equal(js.length, 7);
    assert.equal(js[0].getDay(), 1);
    assert.equal(js[6].getDay(), 0);
    assert.equal(js[6].getDate(), 6);
  });
  test('la semaine traverse un changement de mois sans trou', () => {
    const js = joursDeLaSemaine(new Date(2026, 8, 2)).map(d => d.getDate());
    assert.deepEqual(js, [31, 1, 2, 3, 4, 5, 6]);
  });
});

describe('jourDeValeurDate() — le jour affiché ne doit pas glisser', () => {
  test('« journée entière » du 5 sept. reste le 5, pas le 4', () => {
    // Stocké minuit LOCAL → « 2026-09-04T22:00:00Z » en heure d'été.
    // L'ancien code découpait les 10 premiers caractères et affichait le 4,
    // pendant que la liste des rendez-vous affichait le 5.
    const stocke = new Date(2026, 8, 5, 0, 0, 0).toISOString();
    const j = jourDeValeurDate(stocke);
    assert.equal(j.getDate(), 5);
    assert.equal(j.getMonth(), 8);
    assert.equal(j.getHours(), 0, 'ramené à minuit local');
  });

  test('un rendez-vous à 01:00 reste le bon jour', () => {
    const j = jourDeValeurDate(new Date(2026, 8, 2, 1, 0, 0).toISOString());
    assert.equal(j.getDate(), 2);
  });

  test('un rendez-vous en pleine journée n\'est pas affecté', () => {
    const j = jourDeValeurDate(new Date(2026, 8, 2, 14, 30).toISOString());
    assert.equal(j.getDate(), 2);
  });

  test('champ `date` Airtable (sans heure) pris tel quel', () => {
    // « 2026-09-04 » passé à Date() vaudrait minuit UTC — soit la veille à l'ouest
    // de Greenwich. On le lit composante par composante.
    const j = jourDeValeurDate('2026-09-04');
    assert.equal(j.getDate(), 4);
    assert.equal(j.getMonth(), 8);
    assert.equal(j.getFullYear(), 2026);
  });

  test('valeurs vides ou illisibles → null', () => {
    assert.equal(jourDeValeurDate(''), null);
    assert.equal(jourDeValeurDate(null), null);
    assert.equal(jourDeValeurDate('pas une date'), null);
    assert.equal(jourDeValeurDate('2026-09-04T99:99:99Z'), null);
  });
});

describe('heures', () => {
  test('minutesDeIso lit l\'heure locale', () => {
    assert.equal(minutesDeIso(new Date(2026, 8, 2, 14, 30).toISOString()), 14 * 60 + 30);
  });
  test('minuit → 0 (et non null : 0 est une heure valide)', () => {
    assert.equal(minutesDeIso(new Date(2026, 8, 2, 0, 0).toISOString()), 0);
  });
  test('absent ou invalide → null', () => {
    assert.equal(minutesDeIso(''), null);
    assert.equal(minutesDeIso(null), null);
    assert.equal(minutesDeIso('pas une date'), null);
  });
  test('heureCourte formate sur 2 chiffres', () => {
    assert.equal(heureCourte(new Date(2026, 8, 2, 9, 5).toISOString()), '09:05');
    assert.equal(heureCourte(null), '');
  });
});

describe('disposerEnColonnes() — la superposition', () => {
  const cols = arr => disposerEnColonnes(arr).map(x => `${x.id}:${x.col}/${x.nbCols}`);

  test('créneaux disjoints → tous pleine largeur', () => {
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 600 },
      { id: 'b', debut: 660, fin: 720 },
    ]), ['a:0/1', 'b:0/1']);
  });

  test('bout à bout (fin = début) ne compte PAS comme un chevauchement', () => {
    // 9h-10h puis 10h-11h : deux poses qui s'enchaînent gardent la pleine largeur.
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 600 },
      { id: 'b', debut: 600, fin: 660 },
    ]), ['a:0/1', 'b:0/1']);
  });

  test('deux créneaux qui se chevauchent → 2 colonnes', () => {
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 660 },
      { id: 'b', debut: 600, fin: 720 },
    ]), ['a:0/2', 'b:1/2']);
  });

  test('trois créneaux à la même heure → 3 colonnes', () => {
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 600 },
      { id: 'b', debut: 540, fin: 600 },
      { id: 'c', debut: 540, fin: 600 },
    ]), ['a:0/3', 'b:1/3', 'c:2/3']);
  });

  test('une colonne libérée est réutilisée', () => {
    // a couvre tout ; b puis c s'enchaînent en colonne 1 → 2 colonnes, pas 3.
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 780 },
      { id: 'b', debut: 540, fin: 600 },
      { id: 'c', debut: 660, fin: 720 },
    ]), ['a:0/2', 'b:1/2', 'c:1/2']);
  });

  test('colonne réutilisée même quand c commence PILE à la fin de b', () => {
    // Cas qui épingle la comparaison « fin <= début » de l'affectation de colonne :
    // a maintient le groupe ouvert (donc la fermeture de groupe ne peut pas masquer
    // l'erreur), et c doit reprendre la colonne de b au lieu d'en ouvrir une 3e.
    // Sans ce cas, la règle « bout à bout » est couverte deux fois et vérifiée nulle part.
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 780 },
      { id: 'b', debut: 540, fin: 600 },
      { id: 'c', debut: 600, fin: 660 },
    ]), ['a:0/2', 'b:1/2', 'c:1/2']);
  });

  test('deux groupes indépendants ne se contaminent pas', () => {
    // Matin chargé, après-midi seul : le créneau isolé garde la pleine largeur.
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 600 },
      { id: 'b', debut: 550, fin: 610 },
      { id: 'z', debut: 900, fin: 960 },
    ]), ['a:0/2', 'b:1/2', 'z:0/1']);
  });

  test('un créneau isolé garde la pleine largeur même si le suivant démarre pile à sa fin', () => {
    // Épingle la fermeture de groupe : a (9h-10h) est seul, b et c (10h-12h / 11h-13h)
    // se chevauchent entre eux. Sans fermeture au contact, a hériterait de la largeur
    // du groupe suivant et s'afficherait en demi-colonne sans raison.
    assert.deepEqual(cols([
      { id: 'a', debut: 540, fin: 600 },
      { id: 'b', debut: 600, fin: 720 },
      { id: 'c', debut: 660, fin: 780 },
    ]), ['a:0/1', 'b:0/2', 'c:1/2']);
  });

  test('l\'ordre d\'entrée ne change pas le résultat', () => {
    const attendu = ['a:0/2', 'b:1/2'];
    assert.deepEqual(cols([{ id: 'b', debut: 600, fin: 720 }, { id: 'a', debut: 540, fin: 660 }]), attendu);
  });

  test('créneaux invalides ignorés, sans planter', () => {
    assert.deepEqual(cols([{ id: 'a', debut: 540, fin: 600 }, { id: 'x', debut: NaN, fin: 10 }, null]), ['a:0/1']);
    assert.deepEqual(disposerEnColonnes(null), []);
  });
});

describe('amplitudeHoraire()', () => {
  test('sans créneau → amplitude bureau par défaut', () => {
    assert.deepEqual(amplitudeHoraire([]), { debut: 8, fin: 19 });
  });
  test('un RDV à 7h élargit la grille vers le haut (il ne disparaît pas)', () => {
    assert.deepEqual(amplitudeHoraire([{ debut: 7 * 60, fin: 8 * 60 }]), { debut: 7, fin: 19 });
  });
  test('un chantier qui finit à 20h30 élargit vers le bas', () => {
    assert.deepEqual(amplitudeHoraire([{ debut: 18 * 60, fin: 20 * 60 + 30 }]), { debut: 8, fin: 21 });
  });
  test('reste borné à [0, 24]', () => {
    const a = amplitudeHoraire([{ debut: 0, fin: 24 * 60 }]);
    assert.deepEqual(a, { debut: 0, fin: 24 });
  });
  test('créneaux nuls ignorés', () => {
    assert.deepEqual(amplitudeHoraire([null, { debut: NaN, fin: 1 }]), { debut: 8, fin: 19 });
  });
});
