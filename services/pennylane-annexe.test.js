'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { trouverAnnexeDevis } = require('./pennylane');
const originalFetch = globalThis.fetch;
process.env.PENNYLANE_API_KEY = 'cle-fictive';
afterEach(() => { globalThis.fetch = originalFetch; });
const reponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('annexe : trouve le fichier exact après pagination, sans exposer son URL privée', async () => {
  const appels = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, undefined);
    appels.push(url);
    return reponse(appels.length === 1
      ? { items: [{ id: 1, filename: 'ancienne-version.pdf' }], has_more: true, next_cursor: 'page/suivante' }
      : { items: [{ id: 2, filename: 'descriptif-test.pdf', url: 'https://exemple.invalid/lien-prive' }], has_more: false });
  };
  assert.deepEqual(await trouverAnnexeDevis('123', 'descriptif-test.pdf'), { id: 2, filename: 'descriptif-test.pdf', already: true });
  assert.match(appels[1], /cursor=page%2Fsuivante/);
});
test('annexe : un autre fichier ou un fichier sans identifiant ne confirme pas la présence', async () => {
  globalThis.fetch = async () => reponse({ items: [{ id: 1, filename: 'autre.pdf' }, { filename: 'descriptif.pdf' }], has_more: false });
  assert.equal(await trouverAnnexeDevis('123', 'descriptif.pdf'), null);
});
test('annexe : refuse une pagination interrompue ou cyclique', async () => {
  for (const curseur of [null, 'meme-page']) {
    globalThis.fetch = async () => reponse({ items: [], has_more: true, next_cursor: curseur });
    await assert.rejects(trouverAnnexeDevis('123', 'descriptif.pdf'), /Pagination/);
  }
});
test('annexe : une erreur API ne devient jamais une confirmation ou une absence', async () => {
  globalThis.fetch = async () => reponse({ message: 'Accès refusé' }, 403);
  await assert.rejects(trouverAnnexeDevis('123', 'descriptif.pdf'), /403 : Accès refusé/);
  globalThis.fetch = async () => reponse({ unexpected: true });
  await assert.rejects(trouverAnnexeDevis('123', 'descriptif.pdf'), /illisible/);
});
