const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lireFluxAnthropic, DELAI_LECTURE_MS } = require('./ai-lecture-longue');

test('lecture longue : flux complet, sans relance cachée et avec limite avant celle du conteneur', async () => {
  let options;
  const client = { messages: { stream(params, opts) { options = opts; return { finalMessage: async () => ({ content: [{ type: 'text', text: 'résultat complet' }] }) }; } } };
  const r = await lireFluxAnthropic(client, {});
  assert.equal(r.content[0].text, 'résultat complet');
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, DELAI_LECTURE_MS);
  assert.ok(DELAI_LECTURE_MS < 900_000 && DELAI_LECTURE_MS > 300_000);
});
test('lecture longue : arrêt réel du flux au délai, avec erreur compréhensible', async () => {
  let arrete = false;
  const client = { messages: { stream(params, { signal }) { return { finalMessage: () => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { arrete = true; reject(new Error('Aborted')); });
  }) }; } } };
  await assert.rejects(lireFluxAnthropic(client, {}, { delaiMs: 10 }), /délai de 8 minutes/);
  assert.equal(arrete, true);
});
test('lecture longue : erreur fournisseur propagée sans second appel', async () => {
  let appels = 0;
  const client = { messages: { stream() { appels++; return { finalMessage: async () => { throw new Error('Service indisponible'); } }; } } };
  await assert.rejects(lireFluxAnthropic(client, {}), /Service indisponible/);
  assert.equal(appels, 1);
});
test('SDK installé : flux SSE local réellement assemblé jusqu’au JSON final', async () => {
  const http = require('node:http');
  const Anthropic = require('@anthropic-ai/sdk');
  let appels = 0;
  const serveur = http.createServer((req, res) => {
    appels++; req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const envoyer = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    envoyer('message_start', { message: { id: 'msg_fictif', type: 'message', role: 'assistant', model: 'modele-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    envoyer('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    envoyer('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '{"totaux":' } });
    envoyer('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '{"total_ht":2000}}' } });
    envoyer('content_block_stop', { index: 0 });
    envoyer('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
    envoyer('message_stop', {}); res.end();
  });
  await new Promise(resolve => serveur.listen(0, '127.0.0.1', resolve));
  try {
    const client = new Anthropic({ apiKey: 'cle-fictive-locale', baseURL: `http://127.0.0.1:${serveur.address().port}` });
    const r = await lireFluxAnthropic(client, { model: 'modele-test', max_tokens: 100, messages: [{ role: 'user', content: 'Fictif' }] });
    assert.equal(JSON.parse(r.content[0].text).totaux.total_ht, 2000);
    assert.equal(r.stop_reason, 'end_turn'); assert.equal(appels, 1);
  } finally { serveur.closeAllConnections(); await new Promise(resolve => serveur.close(resolve)); }
});
