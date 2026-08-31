// Vérifie que « Devis express » est verrouillé admin côté SERVEUR (pas juste l'UI).
// On introspecte la pile Express : chaque route porte la liste de ses middlewares.
// Ce test ÉCHOUE si quelqu'un rebascule ces routes en requireAuth (accessible à tout membre).
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

function guardsFor(pathWanted, methodWanted) {
  const names = [];
  for (const layer of app._router.stack) {
    if (!layer.route || layer.route.path !== pathWanted) continue;
    if (methodWanted && !layer.route.methods[methodWanted]) continue;
    for (const l of layer.route.stack) names.push(l.name || (l.handle && l.handle.name) || '');
  }
  return names;
}

test('Devis express — POST /api/devis-fournisseur/parse est admin-only', () => {
  const g = guardsFor('/api/devis-fournisseur/parse', 'post');
  assert.ok(g.length, 'route introuvable');
  assert.ok(g.includes('requireAdmin'), `attendu requireAdmin, vu: [${g.join(', ')}]`);
  assert.ok(!g.includes('requireAuth'), `ne doit plus être requireAuth seul, vu: [${g.join(', ')}]`);
});

test('Devis express — POST /api/devis-express/creer-devis est admin-only', () => {
  const g = guardsFor('/api/devis-express/creer-devis', 'post');
  assert.ok(g.length, 'route introuvable');
  assert.ok(g.includes('requireAdmin'), `attendu requireAdmin, vu: [${g.join(', ')}]`);
});

test('Contrôle — GET /api/me reste ouvert aux membres (pas admin-only)', () => {
  const g = guardsFor('/api/me', 'get');
  assert.ok(g.length, 'route /api/me introuvable');
  assert.ok(!g.includes('requireAdmin'), `/api/me ne doit pas être admin-only, vu: [${g.join(', ')}]`);
});
