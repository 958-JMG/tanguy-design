const { test } = require('node:test');
const assert = require('node:assert/strict');
const lecture = import('../public/v3/assets/js/core/analyse-fournisseur.mjs');
const file = new File(['%PDF-fictif'], 'fictif.pdf', { type: 'application/pdf' });

test('analyse : corps JSON après keep-alive, sans création de devis', async () => {
  const { analyserFournisseur } = await lecture;
  let appels = 0;
  const r = await analyserFournisseur({ file, requete: async (url, opts) => {
    appels++; assert.equal(url, '/api/devis-fournisseur/parse'); assert.equal(opts.body.get('pdf').name, 'fictif.pdf');
    return new Response(' \n {"ok":true,"parsed":{"totaux":{"total_ht":2000}}}');
  } });
  assert.equal(r.parsed.totaux.total_ht, 2000); assert.equal(appels, 1);
});
test('analyse : coupure au début ou après les en-têtes, erreur lisible et aucune relance automatique', async () => {
  const { analyserFournisseur } = await lecture;
  for (const corps of [false, true]) {
    let appels = 0;
    await assert.rejects(analyserFournisseur({ file, requete: async () => {
      appels++;
      if (!corps) throw new TypeError('Failed to fetch');
      return { text: async () => { throw new TypeError('terminated'); } };
    } }), /connexion.*interrompue.*Réessayer/s);
    assert.equal(appels, 1);
  }
});
test('analyse : erreur après keep-alive, timeout proxy et session expirée ne deviennent pas un succès', async () => {
  const { analyserFournisseur } = await lecture;
  for (const [r, motif] of [
    [new Response(' {"error":"Analyse trop longue"}'), /trop longue/],
    [new Response('<html>Gateway Timeout</html>', { status: 504 }), /interrompu/],
    [new Response('{}', { status: 401 }), /session a expiré/],
    [{ redirected: true, url: 'https://exemple.test/login', status: 200, text: async () => '<html>login</html>' }, /session a expiré/],
    [new Response(' {"parsed":'), /incomplète|non reçue/],
  ]) await assert.rejects(analyserFournisseur({ file, requete: async () => r }), motif);
});
