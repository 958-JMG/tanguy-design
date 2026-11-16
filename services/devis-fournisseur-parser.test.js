/**
 * Tests services/devis-fournisseur-parser.js (P-H3).
 * Couvre l'extraction JSON robuste (sans appel réseau).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { extractJson } = require('./devis-fournisseur-parser');

test('extractJson : JSON pur', () => {
  const o = extractJson('{"totaux":{"total_ht":7762}}');
  assert.strictEqual(o.totaux.total_ht, 7762);
});

test('extractJson : JSON avec préambule et suffixe', () => {
  const o = extractJson('Voici le résultat :\n{"fournisseur":{"nom":"Granit Evolution"}}\nFin.');
  assert.strictEqual(o.fournisseur.nom, 'Granit Evolution');
});

test('extractJson : JSON dans un bloc markdown', () => {
  const o = extractJson('```json\n{"variante_prix":"PRO","lignes_detail":[]}\n```');
  assert.strictEqual(o.variante_prix, 'PRO');
  assert.deepStrictEqual(o.lignes_detail, []);
});

test('extractJson : pas de JSON → throw', () => {
  assert.throws(() => extractJson('aucun json ici'), /sans JSON/);
});

test('extractJson : JSON malformé → throw explicite', () => {
  assert.throws(() => extractJson('{"a": }'), /JSON invalide/);
});

test('lecture texte si toutes les pages sont lisibles, repli PDF si une page est scannée', async () => {
  const { contenuPdf } = require('./devis-fournisseur-parser');
  const b = Buffer.from('%PDF-1.4 fictif');
  assert.strictEqual((await contenuPdf(b, async () => ({ text: ['Texte du devis '.repeat(20)] }))).mode, 'texte');
  assert.strictEqual((await contenuPdf(b, async () => ({ text: ['Texte '.repeat(50), ''] }))).mode, 'pdf');
});
test('cache borné : un seul appel IA pour deux lectures simultanées, puis réutilisation', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  let appels = 0;
  const lire = creerLecteur({ extraire: async () => ({ text: ['Descriptif '.repeat(20)] }), ia: async () => { appels++; return { texte: '{"totaux":{"total_ht":1010,"eco_ht":10,"eco_incluse":true}}' }; } });
  const buffer = Buffer.from('%PDF-1.4 fictif cache');
  const [a, b] = await Promise.all([lire(buffer), lire(buffer)]);
  a.totaux.total_ht = 1;
  const c = await lire(buffer);
  assert.strictEqual(appels, 1);
  assert.strictEqual(b.totaux.total_ht, 1010);
  assert.strictEqual(c.totaux.total_ht, 1010);
  assert.strictEqual(c.lecture_reutilisee, true);
});
test('nomenclatures : le texte lisible ne remplace pas les colonnes du PDF pour les pièces éco', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  for (const titre of ['Novamobili Night collection', 'Metron', 'Tablette armoire']) {
    const lire = creerLecteur({ extraire: async () => ({ text: [`${titre}\nQté Code Description Lun Alt Prf\n` + 'Pièce de fabrication '.repeat(20)] }),
      ia: async ({ messages, system }) => {
        assert.strictEqual(messages[0].content[0].type, 'document');
        assert.match(system, /prix masqués ne justifient JAMAIS un tableau éco vide/);
        return { texte: JSON.stringify({ lignes_detail: [], pieces_eco_contribution: [{ designation: 'Tablette', quantite: 2, longueur_mm: 800, hauteur_mm: 500, epaisseur_mm: 19 }] }) };
      } });
    const res = await lire(Buffer.from('%PDF-nomenclature fictive'));
    assert.strictEqual(res.lecture_mode, 'pdf');
    assert.strictEqual(res.pieces_eco_contribution.length, 1);
    assert.deepStrictEqual(res.lignes_detail, []);
  }
});
test('échec de lecture non mis en cache : une relance peut réussir', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  let appels = 0;
  const lire = creerLecteur({ extraire: async () => ({ text: [] }), ia: async () => { if (++appels === 1) throw new Error('Essai indisponible'); return { texte: '{}' }; } });
  const b = Buffer.from('%PDF-fictif erreur');
  await assert.rejects(lire(b), /indisponible/);
  await lire(b);
  assert.strictEqual(appels, 2);
});
test('lecture longue : sortie tronquée refusée et non mémorisée', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  let appels = 0;
  const lire = creerLecteur({ extraire: async () => ({ text: [] }), ia: async opts => {
    assert.equal(opts.lectureLongue, true); appels++;
    return { texte: '{"incomplet":', arret: 'max_tokens' };
  } });
  for (let n = 0; n < 2; n++) await assert.rejects(lire(Buffer.from('%PDF-fictif tronqué')), /trop de détails/);
  assert.equal(appels, 2);
});

function ventilationFictive() {
  return { totaux: { total_ht: 280, total_ttc: 336, tva_taux: 20, tva_montant: 56, eco_ht: 10, eco_incluse: true, remise_globale_ht: 10 },
    lignes_detail: [
      { designation: 'Appareil fictif A', code_produit: '0000123', type: 'article', quantite: 1, pu_ht: 100, total_ht: 100, eco_ht: 4, tva_taux: 20 },
      { designation: 'Appareil fictif B', code_produit: 'TEST-B', type: 'article', quantite: 1, pu_ht: 200, remise_ht: 20, remise_pct: 10, total_ht: 180, eco_ht: 6, tva_taux: 20 },
      { designation: 'Éco-participation : appareil A 4 €, appareil B 6 €', type: 'eco', quantite: 1, pu_ht: 10, total_ht: 10, tva_taux: 20 },
    ] };
}

test('PDF : ventilation éco répétée rattachée à sa ligne facturée sans changer prix, références ou remises', async () => {
  const { creerLecteur } = require('./devis-fournisseur-parser');
  const source = ventilationFictive();
  const lire = creerLecteur({ extraire: async () => ({ text: [] }), ia: async () => ({ texte: JSON.stringify(source) }) });
  const obtenu = await lire(Buffer.from('%PDF-ventilation-fictive'));
  const { controlerDetail } = await import('../public/v3/assets/js/core/devis-detail.mjs');
  const c = controlerDetail(obtenu);
  assert.equal(c.ok, true, c.erreurs.join());
  assert.deepStrictEqual(obtenu.totaux, source.totaux);
  assert.deepStrictEqual(obtenu.lignes_detail, source.lignes_detail.map(l => l.type === 'eco' ? l : { ...l, eco_ht: 0 }));
  assert.equal(c.totaux.remise_lignes_ht, 20); assert.equal(c.totaux.remise_globale_ht, 10); assert.equal(c.totaux.eco_ht, 10);
});

test('éco : toute ambiguïté conserve la lecture initiale pour le contrôle bloquant', async t => {
  const { normaliserEcoRepartie } = require('./devis-fournisseur-parser');
  const cas = {
    'éco déjà comprise dans le net article': d => { d.lignes_detail[0].total_ht = 104; },
    'prix unitaire absent': d => { d.lignes_detail[0].pu_ht = null; },
    'ventilation partielle': d => { d.lignes_detail[0].eco_ht = 3; },
    'autre taux de TVA': d => { d.lignes_detail[0].tva_taux = 10; },
    'total du document incohérent': d => { d.totaux.total_ttc = 337; },
    'remise incohérente': d => { d.lignes_detail[1].remise_pct = 20; },
    'pas de ligne éco facturée': d => { d.lignes_detail.pop(); },
  };
  for (const [nom, modifier] of Object.entries(cas)) await t.test(nom, async () => {
    const d = ventilationFictive(); modifier(d); const copie = structuredClone(d);
    assert.strictEqual(await normaliserEcoRepartie(d), d);
    assert.deepStrictEqual(d, copie);
  });
});

test('la normalisation éco ne confirme pas une référence absente et ne modifie pas sa source', async () => {
  const { normaliserEcoRepartie } = require('./devis-fournisseur-parser');
  const d = ventilationFictive(); d.lignes_detail[0].code_produit = '';
  const copie = structuredClone(d), obtenu = await normaliserEcoRepartie(d);
  const { controlerDetail } = await import('../public/v3/assets/js/core/devis-detail.mjs');
  assert.deepStrictEqual(d, copie); assert.equal(obtenu.lignes_detail[0].eco_ht, 0);
  assert.equal(obtenu.lignes_detail[0].sans_reference_confirme, undefined);
  assert.equal(controlerDetail(obtenu).ok, false);
  assert.match(controlerDetail(obtenu).erreurs.join(), /absence de référence à confirmer/);
});
