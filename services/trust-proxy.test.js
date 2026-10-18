'use strict';
// trust-proxy.test — req.ip derrière les sauts de Scaleway (lot D, 18/10/2026).
// Une mini-application Express avec la liste du module : X-Forwarded-For « 203.0.113.9, 100.96.1.1 » donne req.ip =
// 203.0.113.9, quel que soit le nombre de sauts internes ; une adresse forgée à gauche par l'appelant n'est pas prise ;
// X-Forwarded-Proto: https donne req.protocol = https (cookie Secure). Le témoin : avec « trust proxy = 1 » (l'ancien réglage),
// la même requête donnait l'équilibreur interne. Et le branchement : server.js pose bien TRUST_PROXY.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { TRUST_PROXY, CLOUDFLARE, CLOUDFLARE_RELEVE_LE } = require('./trust-proxy');

async function vue(xff, reglage = TRUST_PROXY) {
  const app = express();
  app.set('trust proxy', reglage);
  app.get('/', (req, res) => res.json({ ip: req.ip, proto: req.protocol }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/`, { headers: { 'x-forwarded-for': xff, 'x-forwarded-proto': 'https' } });
    return r.json();
  } finally { srv.close(); }
}

test('req.ip est l’adresse du visiteur, quel que soit le nombre de sauts internes de Scaleway', async () => {
  assert.deepEqual(await vue('203.0.113.9, 100.96.1.1'), { ip: '203.0.113.9', proto: 'https' });
  assert.equal((await vue('203.0.113.9, 100.96.2.2, 100.96.1.1')).ip, '203.0.113.9', 'deux sauts CGNAT');
  assert.equal((await vue('203.0.113.9, 10.0.0.5, 100.96.1.1')).ip, '203.0.113.9', 'un saut en réseau privé');
  assert.equal((await vue('203.0.113.9')).ip, '203.0.113.9', 'un seul saut');
  assert.equal((await vue('2001:db8::9, 100.96.1.1')).ip, '2001:db8::9', 'visiteur en IPv6');
});

test('une adresse écrite à gauche par l’appelant n’est pas prise : on s’arrête à la première adresse non interne', async () => {
  assert.equal((await vue('198.51.100.7, 203.0.113.9, 100.96.1.1')).ip, '203.0.113.9');
  assert.equal((await vue('10.9.9.9, 203.0.113.9, 100.96.1.1')).ip, '203.0.113.9', 'même une adresse privée forgée à gauche');
});

test('témoin : avec « trust proxy = 1 » (avant), req.ip était l’équilibreur interne', async () => {
  assert.equal((await vue('203.0.113.9, 100.96.1.1', 1)).ip, '100.96.1.1');
});
test('un saut Cloudflare devant Scaleway : req.ip est l’adresse que Cloudflare a vue, pas l’adresse Cloudflare', async () => {
  assert.equal(CLOUDFLARE.length, 22, '15 plages IPv4 + 7 IPv6, relevées le ' + CLOUDFLARE_RELEVE_LE);
  assert.equal((await vue('203.0.113.9, 104.16.1.1, 100.96.1.1')).ip, '203.0.113.9');
  assert.equal((await vue('203.0.113.9, 172.70.1.1, 100.96.2.2, 100.96.1.1')).ip, '203.0.113.9', 'Cloudflare puis deux sauts internes');
  assert.equal((await vue('2001:db8::9, 2a06:98c0::1, 100.96.1.1')).ip, '2001:db8::9', 'saut Cloudflare en IPv6');
  assert.equal((await vue('198.51.100.7, 203.0.113.9, 104.16.1.1, 100.96.1.1')).ip, '203.0.113.9', 'adresse forgée devant Cloudflare ignorée');
  // Témoin : sans les plages Cloudflare, req.ip serait l'adresse Cloudflare — tous les visiteurs confondus pour un limiteur.
  assert.equal((await vue('203.0.113.9, 104.16.1.1, 100.96.1.1', ['loopback', 'uniquelocal', '100.64.0.0/10'])).ip, '104.16.1.1');
});

test('branchement : server.js pose TRUST_PROXY (pas un nombre de sauts)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /app\.set\('trust proxy', TRUST_PROXY\)/);
  assert.doesNotMatch(src, /app\.set\('trust proxy', (1|2|true)\)/);
});
