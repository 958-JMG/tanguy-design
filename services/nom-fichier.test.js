/**
 * Tests services/nom-fichier.js — node --test natif (ADR-004).
 *
 * Banc réel : un serveur express avec le multer du projet (celui de la prod), et
 * des envois par fetch + FormData, qui écrivent le nom de fichier comme un
 * navigateur (spécification HTML : octets UTF-8 bruts dans filename="…").
 *
 * Chaque cas accentué vérifie d'abord que multer seul rend bien le nom abîmé :
 * sans ce témoin, un test vert ne prouverait pas qu'on a reproduit le constat
 * du 24/09.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { nomFichier } = require('./nom-fichier');

let serveur;
let adresse;

before(async () => {
  const app = express();
  app.post('/envoi', multer({ storage: multer.memoryStorage() }).single('fichier'), (req, res) => {
    res.json({ brut: req.file.originalname, repare: nomFichier(req.file) });
  });
  await new Promise((ok) => { serveur = app.listen(0, '127.0.0.1', ok); });
  adresse = `http://127.0.0.1:${serveur.address().port}/envoi`;
});

after(() => new Promise((ok) => serveur.close(ok)));

// Envoi comme un navigateur.
async function envoyerCommeNavigateur(nom) {
  const fd = new FormData();
  fd.append('fichier', new File([Buffer.from('%PDF-1.4 test')], nom, { type: 'application/pdf' }));
  const r = await fetch(adresse, { method: 'POST', body: fd });
  assert.equal(r.status, 200);
  return r.json();
}

// Envoi avec une ligne Content-Disposition écrite à la main, octet par octet
// (clients qui ne sont pas des navigateurs).
async function envoyerAvecEnTete(disposition) {
  const frontiere = 'banc-nom-fichier';
  const corps = Buffer.concat([
    Buffer.from(`--${frontiere}\r\n`),
    disposition,
    Buffer.from('\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test\r\n'),
    Buffer.from(`--${frontiere}--\r\n`),
  ]);
  const r = await fetch(adresse, {
    method: 'POST',
    body: corps,
    headers: { 'Content-Type': `multipart/form-data; boundary=${frontiere}` },
  });
  assert.equal(r.status, 200);
  return r.json();
}

describe('Nom accentué envoyé par un navigateur → ressort correctement', () => {
  test('témoin : multer seul rend « devis-été Ça.pdf » abîmé (constat du 24/09)', async () => {
    const { brut } = await envoyerCommeNavigateur('devis-été Ça.pdf');
    assert.equal(brut, 'devis-Ã©tÃ© Ã\u0087a.pdf');
  });

  const noms = [
    'devis-été Ça.pdf',
    'plan façade.dwg',
    'cœur d’artichaut.pdf',            // œ et ’ : au-delà de latin1
    'Réf n°12 – œuvre à l’Île.pdf',
    'photo 📷 chantier.jpg',           // caractère sur 4 octets
  ];
  for (const nom of noms) {
    test(`« ${nom} »`, async () => {
      const { brut, repare } = await envoyerCommeNavigateur(nom);
      assert.notEqual(brut, nom, 'témoin : multer seul devrait rendre ce nom abîmé');
      assert.equal(repare, nom);
    });
  }

  test('accents décomposés (macOS) → recomposés en NFC', async () => {
    const decompose = 'devis-e\u0301te\u0301.pdf';
    const { repare } = await envoyerCommeNavigateur(decompose);
    assert.equal(repare, 'devis-\u00e9t\u00e9.pdf');
  });
});

describe('Nom ASCII → inchangé', () => {
  for (const nom of ['IMG_1234.HEIC', 'devis 2026-09 (v2).pdf', 'Plan_3D-final.dwg']) {
    test(`« ${nom} »`, async () => {
      const { brut, repare } = await envoyerCommeNavigateur(nom);
      assert.equal(brut, nom);
      assert.equal(repare, nom);
    });
  }
});

describe('Nom déjà correct → pas abîmé', () => {
  for (const nom of ['devis-été Ça.pdf', 'cœur d’artichaut.pdf']) {
    test(`client qui envoie filename*=UTF-8'' (RFC 5987) : « ${nom} » reste tel quel`, async () => {
      const disposition = Buffer.from(
        `Content-Disposition: form-data; name="fichier"; filename*=UTF-8''${encodeURIComponent(nom)}`);
      const { brut, repare } = await envoyerAvecEnTete(disposition);
      assert.equal(brut, nom, 'précondition : multer décode déjà ce nom correctement');
      assert.equal(repare, nom);
    });
  }

  test('vieux client qui envoie le nom en octets latin1 : gardé tel quel', async () => {
    const nom = 'été à Vannes.pdf';
    const disposition = Buffer.from(
      `Content-Disposition: form-data; name="fichier"; filename="${nom}"`, 'latin1');
    const { brut, repare } = await envoyerAvecEnTete(disposition);
    assert.equal(brut, nom, 'précondition : multer décode déjà ce nom correctement');
    assert.equal(repare, nom);
  });

  test('un nom déjà réparé repasse sans changer', () => {
    for (const nom of ['devis-été Ça.pdf', 'plan façade.dwg', 'cœur d’artichaut.pdf',
      'Réf n°12 – œuvre à l’Île.pdf', 'photo 📷 chantier.jpg', 'Facture n°42 (été).pdf']) {
      assert.equal(nomFichier({ originalname: nom }), nom);
    }
  });

  test('nom vide ou absent : rendu tel quel, le nom par défaut de la route s\'applique', () => {
    assert.equal(nomFichier({ originalname: '' }) || 'devis-artisan.pdf', 'devis-artisan.pdf');
    assert.equal(nomFichier({}), undefined);
    assert.equal(nomFichier(undefined), undefined);
  });
});

describe('Garde-fou : un seul module lit le nom brut de multer', () => {
  test('« originalname » n\'apparaît que dans services/nom-fichier.js', () => {
    const racine = path.join(__dirname, '..');
    const fichiers = ['server.js', ...fs.readdirSync(__dirname)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'nom-fichier.js')
      .map((f) => path.join('services', f))];
    const lectures = [];
    for (const f of fichiers) {
      fs.readFileSync(path.join(racine, f), 'utf8').split('\n').forEach((ligne, i) => {
        if (ligne.includes('originalname')) lectures.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(lectures, [], 'passer par nomFichier(req.file) au lieu de lire le nom brut');
  });
});
