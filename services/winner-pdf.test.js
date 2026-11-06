'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateBcPdf } = require('./bc-pdf-generator');
const { extractText } = require('unpdf');

test('PDF du BC : suit le tableau enregistré, affiche les familles et noms, sans tri numérique', async () => {
  const lignes = ['503', '20', '15', '2.1', '4.2'].map((pos, i) => ({ pos, code: `ARTICLE-TEST-${i + 1}`, description: 'Article fictif', section: 'Crédence', marque: 'Marque fictive', fournisseur: 'Fournisseur fictif', quantite: 1 }));
  const buffer = await generateBcPdf({ commande: { Numéro: 'TEST', 'Date création': '2026-11-06' }, fournisseur: { fields: { Nom: 'Fournisseur fictif' } }, lignes });
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    let precedent = -1;
    for (const l of lignes) {
      const index = text.indexOf(l.code);
      assert.ok(index > precedent, `${l.code} dans l’ordre enregistré`);
      precedent = index;
    }
    assert.match(text, /Crédence/);
    assert.match(text, /Marque fictive/);
    assert.match(text, /Fournisseur fictif/);
});
