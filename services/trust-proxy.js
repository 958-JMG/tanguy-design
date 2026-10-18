'use strict';
// trust-proxy.js — quels sauts Express croit pour calculer req.ip (lot D de la passe de sécurité du 18/10/2026).
//
// Derrière Scaleway, X-Forwarded-For traverse PLUSIEURS sauts internes (mesuré en prod sur memory-958 le 18/10/2026 : avec
// « trust proxy = 1 », req.ip valait l'équilibreur interne 100.96.x.x, différent à chaque requête — plus rien n'était limité
// par IP). On croit donc des plages, pas un nombre de sauts : boucle locale, réseaux privés (RFC 1918, « uniquelocal ») et le
// CGNAT 100.64.0.0/10 de Scaleway. req.ip est la première adresse, en remontant X-Forwarded-For depuis la droite, qui n'en
// fait pas partie : le visiteur, tel que le premier saut l'a vu. Une adresse écrite plus à gauche par le visiteur lui-même
// est ignorée. Les limiteurs (API 300/min, connexion 10 / 15 min, accès au site : express-rate-limit, clé par défaut = req.ip) et clientIp() comptent sur cette adresse.
// Les plages publiées par Cloudflare, relevées le 18/10/2026 sur https://www.cloudflare.com/ips-v4 (15) et /ips-v6 (7).
// tanguydesign.958.fr est proxifié par Cloudflare (dig du 18/10 : 104.26.x.x, 172.67.x.x) : le saut Cloudflare est cru, et req.ip est
// l'adresse que Cloudflare a vue — la même que CF-Connecting-IP, mais sans croire un en-tête que l'appelant pourrait écrire
// lui-même en joignant l'adresse Scaleway directement. À relever de nouveau si Cloudflare change ses plages.
const CLOUDFLARE_RELEVE_LE = '2026-10-18';
const CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20',
  '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
const TRUST_PROXY = ['loopback', 'uniquelocal', '100.64.0.0/10', ...CLOUDFLARE];

module.exports = { CLOUDFLARE_RELEVE_LE, CLOUDFLARE, TRUST_PROXY };
