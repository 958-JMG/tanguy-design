const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/v3/assets/js/views/admin.js', 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
test('grille : Sanitaire est cochable et les anciennes catégories sont conservées à la sauvegarde', () => {
  const ctx = vm.createContext({ icon: () => '', hydrateIcons: () => {} });
  vm.runInContext(source, ctx);
  const out = { innerHTML: '', querySelectorAll: () => [] };
  ctx.renderGrilleFournisseurs(out, [{ id: 'recFictif', fields: { Nom: 'Fournisseur fictif', Catégories: ['Évier', 'Sanitaire'] } }]);
  assert.match(out.innerHTML, /data-cat="Sanitaire" checked/);
  assert.match(out.innerHTML, /data-autres-categories="\[&quot;Évier&quot;\]"/);
  const cats = ctx.lireCategoriesLigne({ dataset: { autresCategories: '["Évier"]' }, querySelectorAll: () => [{ checked: true, dataset: { cat: 'Sanitaire' } }, { checked: false, dataset: { cat: 'Mobilier' } }] });
  assert.deepEqual(Array.from(cats), ['Évier', 'Sanitaire']);
});
