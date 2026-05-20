/**
 * Tests services/acl.js — node --test natif.
 *
 * Usage : node --test services/acl.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { canAccess, pickAllowedFields, TABLE_ACL, FIELD_WHITELIST } = require('./acl');

describe('canAccess()', () => {
  test('admin peut tout faire sur les tables sensibles', () => {
    assert.equal(canAccess('admin', 'artisans', 'PATCH'), true);
    assert.equal(canAccess('admin', 'fournisseurs', 'POST'), true);
    assert.equal(canAccess('admin', 'devis-artisans', 'DELETE'), true);
    assert.equal(canAccess('admin', 'stock', 'GET'), true);
  });

  test('user non-admin ne peut PAS modifier artisans (rétro-commissions)', () => {
    assert.equal(canAccess('*', 'artisans', 'PATCH'), false);
    assert.equal(canAccess('*', 'artisans', 'POST'), false);
    assert.equal(canAccess('*', 'artisans', 'DELETE'), false);
  });

  test('user non-admin peut lire artisans (annuaire)', () => {
    assert.equal(canAccess('*', 'artisans', 'GET'), true);
  });

  test('user non-admin peut faire CRUD sur tâches', () => {
    assert.equal(canAccess('*', 'taches', 'GET'), true);
    assert.equal(canAccess('*', 'taches', 'POST'), true);
    assert.equal(canAccess('*', 'taches', 'PATCH'), true);
    assert.equal(canAccess('*', 'taches', 'DELETE'), true);
  });

  test('user non-admin peut créer clients/projets mais pas les supprimer', () => {
    assert.equal(canAccess('*', 'clients', 'POST'), true);
    assert.equal(canAccess('*', 'projets', 'POST'), true);
    assert.equal(canAccess('*', 'clients', 'DELETE'), false);
    assert.equal(canAccess('*', 'projets', 'DELETE'), false);
  });

  test('user non-admin peut update statut commande mais pas créer/supprimer', () => {
    assert.equal(canAccess('*', 'commandes', 'PATCH'), true);
    assert.equal(canAccess('*', 'commandes', 'POST'), false);
    assert.equal(canAccess('*', 'commandes', 'DELETE'), false);
  });

  test('stock entièrement réservé aux admins (en lecture aussi)', () => {
    assert.equal(canAccess('*', 'stock', 'GET'), false);
    assert.equal(canAccess('admin', 'stock', 'GET'), true);
  });

  test('table inconnue → refusée pour tous', () => {
    assert.equal(canAccess('admin', 'inexistante', 'GET'), false);
    assert.equal(canAccess('*', 'inexistante', 'GET'), false);
  });

  test('verbe inconnu → refusé', () => {
    assert.equal(canAccess('admin', 'clients', 'HEAD'), false);
  });
});

describe('pickAllowedFields()', () => {
  test('ne garde que les champs whitelisted pour clients', () => {
    const input = { Nom: 'Junker', Email: 'a@b.fr', SomeSecretField: 'hack', _id: 'rec123' };
    const out = pickAllowedFields('clients', input);
    assert.deepEqual(out, { Nom: 'Junker', Email: 'a@b.fr' });
  });

  test('ne laisse PAS passer "Rétro-commission" sur artisans (champ sensible)', () => {
    const input = { Nom: 'Plomberie Dupont', 'Rétro-commission': 0.5, Contractuel: true };
    const out = pickAllowedFields('artisans', input);
    assert.equal(out['Rétro-commission'], undefined, 'Rétro-commission doit être supprimé');
    assert.equal(out['Nom'], 'Plomberie Dupont');
    assert.equal(out['Contractuel'], true);
  });

  test('ne laisse PAS passer "Marge prévisionnelle"... wait elle est dans la whitelist projets', () => {
    // Confirmer : la marge prévi est éditable (sinon impossible de la setter à la création)
    const input = { 'Marge prévisionnelle': 0.25 };
    const out = pickAllowedFields('projets', input);
    assert.equal(out['Marge prévisionnelle'], 0.25);
  });

  test('table inconnue → renvoie fields tel quel (pas de FIELD_WHITELIST défini)', () => {
    const input = { foo: 'bar' };
    const out = pickAllowedFields('inexistante', input);
    assert.deepEqual(out, input);
  });

  test('fields null ou non-objet → renvoie objet vide', () => {
    assert.deepEqual(pickAllowedFields('clients', null), {});
    assert.deepEqual(pickAllowedFields('clients', undefined), {});
    assert.deepEqual(pickAllowedFields('clients', 'string'), 'string');
  });

  test('fields vide → renvoie objet vide', () => {
    assert.deepEqual(pickAllowedFields('clients', {}), {});
  });
});

describe('TABLE_ACL + FIELD_WHITELIST cohérence', () => {
  test('chaque table de TABLE_ACL a une FIELD_WHITELIST définie', () => {
    for (const tableKey of Object.keys(TABLE_ACL)) {
      assert.ok(FIELD_WHITELIST[tableKey], `FIELD_WHITELIST manquante pour ${tableKey}`);
      assert.ok(Array.isArray(FIELD_WHITELIST[tableKey]), `FIELD_WHITELIST[${tableKey}] doit être un array`);
      assert.ok(FIELD_WHITELIST[tableKey].length > 0, `FIELD_WHITELIST[${tableKey}] vide`);
    }
  });
});
