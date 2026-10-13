// Arrêt propre de server.js (13/10/2026 ; cdlink : pages « EOF » et « connection reset by peer » au remplacement du conteneur).
// Scaleway envoie SIGTERM quand il remplace l'instance (chaque déploiement). Une requête EN COURS à ce moment-là
// doit recevoir sa réponse ; une nouvelle connexion est refusée ; le processus sort de lui-même, code 0.
// La requête est envoyée en deux temps (moitié du corps, SIGTERM, reste du corps) : elle est en vol, à coup sûr.
// Sans le gestionnaire, elle finit en ECONNRESET — l'erreur vue par JMG.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const portLibre = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

test('SIGTERM : la requête en vol reçoit sa réponse, plus de nouvelle connexion, sortie code 0', async () => {
  const PORT = await portLibre();
  // Environnement fermé : aucun secret du shell (Airtable, IA, Pennylane, S3) ne passe au serveur.
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: RACINE, stdio: 'pipe',
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), TZ: 'Europe/Paris', PORT: String(PORT), NODE_ENV: 'test', LOG_LEVEL: 'info' },
  });
  let journal = '';
  srv.stdout.on('data', (d) => { journal += d; });
  srv.stderr.on('data', (d) => { journal += d; });
  const fini = new Promise((res) => srv.on('exit', (code, signal) => res({ code, signal })));
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('serveur muet après 30 s : ' + journal.slice(-400))), 30_000);
      srv.on('exit', (code) => { clearTimeout(t); rej(new Error(`serveur arrêté au démarrage (code ${code}) : ${journal.slice(-400)}`)); });
      srv.stdout.on('data', () => { if (journal.includes('Tanguy Design — Cockpit')) { clearTimeout(t); res(); } });
    });

    const corps = JSON.stringify({ sans: 'identifiant, refus immédiat' });
    const r = await new Promise((res) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/login', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps) } }, (x) => {
        x.resume(); x.on('end', () => res({ statut: x.statusCode, connexion: x.headers.connection }));
      });
      req.on('error', (e) => res({ erreur: e.code || e.message }));
      req.write(corps.slice(0, 8));
      setTimeout(() => { srv.kill('SIGTERM'); setTimeout(() => req.end(corps.slice(8)), 400); }, 200);
    });
    assert.ok(r.statut && !r.erreur, `requête en vol au moment de l’arrêt : elle reçoit sa réponse (${r.statut || r.erreur}) — ${journal.slice(-300)}`);
    assert.equal(r.connexion, 'close', 'pendant l’arrêt, la réponse demande au proxy de fermer la connexion');

    const neuve = await new Promise((res) => { const q = http.get({ host: '127.0.0.1', port: PORT, path: '/', agent: false }, (x) => { x.resume(); res('acceptée'); }); q.on('error', (e) => res(e.code)); });
    assert.equal(neuve, 'ECONNREFUSED', 'après l’arrêt demandé, plus de nouvelle connexion');

    const f = await Promise.race([fini, new Promise((res) => setTimeout(() => res(null), 12_000))]);
    assert.deepEqual(f, { code: 0, signal: null }, 'le serveur sort de lui-même, code 0');
    assert.match(journal, /\[arrêt\] SIGTERM reçu[\s\S]*\[arrêt\] terminé/, 'le journal dit l’arrêt et sa fin');
  } finally {
    try { srv.kill('SIGKILL'); } catch {}
  }
});
