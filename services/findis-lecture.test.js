/**
 * Lecture des projets FINDIS — texte du PDF (exact, sans IA) et repli IA.
 * Jeux d'essai : texte réel de 6 projets du 14/10/2026, à partir de « Ajouter
 * un article » (le bloc client n'y figure pas), et les articles attendus.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { articlesDepuisTexte, decouperTitre } = require('./findis-texte');
const { lireProjetFindis, controlerFichiers, typeReel, texteDuPdf } = require('./findis-parser');
const { normaliserArticles } = require('./devis-electro');

const FIX = path.join(__dirname, 'fixtures', 'findis');
const PROJETS = ['35658', '35859', '35789', '35449', '32470', '35757'];
const CHAMPS = ['reference', 'marque', 'typeFindis', 'venteTtcUnit', 'achatHtUnit', 'promoHtUnit', 'ecoHtUnit', 'quantite', 'selectionnable', 'horsTarif', 'famille'];

describe('articlesDepuisTexte() — 6 projets réels, 45 articles', () => {
  for (const n of PROJETS) {
    test(`projet ${n} : chaque article identique à l'attendu`, () => {
      const lu = articlesDepuisTexte(fs.readFileSync(path.join(FIX, `projet-${n}.txt`), 'utf8'));
      assert.equal(lu.projet_findis, n);
      assert.deepEqual(lu.alertes, []);
      const got = normaliserArticles(lu).articles;
      const ref = normaliserArticles(require(path.join(FIX, `projet-${n}.json`))).articles;
      assert.equal(got.length, ref.length);
      ref.forEach((r, i) => { for (const k of CHAMPS) assert.equal(String(got[i][k]), String(r[k]), `${r.reference || r.libelle} · ${k}`); });
    });
  }

  test('article remplacé : référence de remplacement lue sur la ligne suivante', () => {
    const lu = articlesDepuisTexte(fs.readFileSync(path.join(FIX, 'projet-35658.txt'), 'utf8'));
    assert.equal(lu.articles.find(a => a.reference === 'SPH4HL801E').remplace_par, 'SPH4HL802E');
  });

  test('titres coupés recollés : « Micro- » + « ondes » ; « intégrable » + « - RB289300 »', () => {
    assert.deepEqual(decouperTitre('SIEMENS STUDIOLINE Micro-ondes BF922L1B1'), { marque: 'SIEMENS STUDIOLINE', libelle: 'Micro-ondes', reference: 'BF922L1B1' });
    assert.deepEqual(decouperTitre('GAGGENAU Réfrigérateur intégrable - RB289300 [Hors Tarif]'), { marque: 'GAGGENAU', libelle: 'Réfrigérateur intégrable', reference: 'RB289300' });
    assert.deepEqual(decouperTitre('GESSI Mitigeur 17155#031'), { marque: 'GESSI', libelle: 'Mitigeur', reference: '17155#031' });
  });

  test('autre document qu\'une page FINDIS → aucune invention, une alerte', () => {
    const lu = articlesDepuisTexte('Facture n° 12\nTotal 100,00 €');
    assert.deepEqual(lu.articles, []);
    assert.match(lu.alertes[0], /non reconnue/);
  });
});

describe('contrôle des fichiers', () => {
  test('type réel lu dans les octets, pas dans le nom', () => {
    assert.equal(typeReel(Buffer.from('%PDF-1.4 xxxxxxx')), 'application/pdf');
    assert.equal(typeReel(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png');
    assert.equal(typeReel(Buffer.from('<html>pas un pdf</html>')), null);
  });
  test('fichier inconnu ou image > 5 Mo : refus qui nomme le fichier', () => {
    const grosse = Buffer.alloc(6 * 1024 * 1024); grosse[0] = 0xFF; grosse[1] = 0xD8; grosse[2] = 0xFF;
    const r = controlerFichiers([{ buffer: Buffer.from('bonjour tout le monde'), originalname: 'note.txt' }, { buffer: grosse, originalname: 'capture.jpg' }]);
    assert.match(r.erreurs[0], /note\.txt/);
    assert.match(r.erreurs[1], /capture\.jpg.*5 Mo/);
  });
});

describe('lireProjetFindis() — choix du chemin, sans réseau', () => {
  const pdf = { buffer: Buffer.from('%PDF-1.4 factice'), originalname: 'Projet 35789.pdf' };
  const png = { buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]), originalname: 'capture.png' };
  const texte35789 = fs.readFileSync(path.join(FIX, 'projet-35789.txt'), 'utf8');
  const iaInterdite = async () => { throw new Error('l\'IA ne devait pas être appelée'); };

  test('PDF FINDIS : lu par son texte, l\'IA n\'est PAS appelée', async () => {
    const lu = await lireProjetFindis([pdf], { lireTexte: async () => texte35789, ia: iaInterdite });
    assert.equal(lu.articles.length, 5);
    assert.deepEqual(lu.lectures, [{ fichier: 'Projet 35789.pdf', mode: 'texte', articles: 5 }]);
  });

  test('capture d\'écran : lue par l\'IA au niveau premium, et dit', async () => {
    let appel;
    const ia = async (p) => { appel = p; return { texte: JSON.stringify({ projet_findis: '1', articles: [{ source: 0, reference: 'X12345', prix_vente_ttc: '120,00', prix_achat_ht: '50,00', eco_part_ht: '1,00' }] }), modele: 'claude-opus-4-7' }; };
    const lu = await lireProjetFindis([png], { ia });
    assert.equal(appel.niveau, 'premium');
    assert.ok(appel.messages[0].content.some(b => b.type === 'image' && b.source.media_type === 'image/png'));
    assert.equal(lu.lectures[0].mode, 'ia');
    assert.equal(lu.lectures[0].modele, 'claude-opus-4-7');
    assert.equal(lu.articles.length, 1);
  });

  test('PDF à la mise en page inconnue : repli IA, annoncé', async () => {
    const ia = async () => ({ texte: '{"articles":[],"alertes":[]}', modele: 'm' });
    const lu = await lireProjetFindis([pdf], { lireTexte: async () => 'autre chose', ia });
    assert.equal(lu.lectures[0].mode, 'ia');
    assert.ok(lu.alertes.some(a => /non reconnue.*IA/.test(a)));
  });

  test('PDF + capture : chacun par son chemin, numéros de fichier conservés', async () => {
    const ia = async () => ({ texte: JSON.stringify({ articles: [{ source: 1, reference: 'Z99999', prix_vente_ttc: '10,00', prix_achat_ht: '5,00' }] }), modele: 'm' });
    const lu = await lireProjetFindis([pdf, png], { lireTexte: async () => texte35789, ia });
    assert.deepEqual(lu.lectures.map(l => l.mode), ['texte', 'ia']);
    assert.equal(lu.articles.filter(a => a.source === 0).length, 5);
    assert.equal(lu.articles.find(a => a.reference === 'Z99999').source, 1);
  });
});

test('unpdf lit un vrai PDF (fabriqué ici avec pdfkit) au format FINDIS', async () => {
  const doc = new PDFDocument();
  const morceaux = [];
  doc.on('data', c => morceaux.push(c));
  const fini = new Promise(r => doc.on('end', r));
  for (const l of ['Projet n° 99999', 'Ajouter un article :', 'Four encastrable | MIELE Four pyrolyse H7260BPNR', 'Four pyrolyse - Collection VitroLine',
    '2', 'Votre prix public : 1 869,00', 'P.Vente : 1 869,00 € TTC', 'P.Achat : 1 021,93 € HT', 'Promo : 990,00 € HT', '+ éco-part. : 12,20 € HT', 'Stock : 0 / Cde : 0', 'Sur commande']) doc.text(l);
  doc.end();
  await fini;
  const lu = articlesDepuisTexte(await texteDuPdf(Buffer.concat(morceaux)));
  assert.equal(lu.projet_findis, '99999');
  const [a] = normaliserArticles(lu).articles;
  assert.equal(a.reference, 'H7260BPNR');
  assert.equal(a.quantite, 2);
  assert.equal(a.venteTtcUnit, 1869);
  assert.equal(a.achatRetenuHtUnit, 990);
  assert.equal(a.ecoHtUnit, 12.2);
  assert.ok(a.notes.includes('Sur commande'));
});
