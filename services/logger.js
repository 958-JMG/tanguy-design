/**
 * services/logger.js — logger central pino (ADR-005)
 *
 * - JSON structuré en prod (parsable par Scaleway Logs Browser)
 * - Pretty-print en dev (couleurs + timestamps lisibles)
 * - Niveau configurable via LOG_LEVEL (défaut : info en prod, debug en dev)
 * - Secrets jamais loggués (redact sur cookies, authorization, password, tokens)
 *
 * Usage :
 *   const logger = require('./services/logger');
 *   logger.info({ projetId, ms }, 'devis signé');
 *   logger.warn({ login, ip }, 'login échec');
 *   logger.error({ err }, 'crash parsing');
 */
const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // En dev, pretty-print pour la lisibilité. En prod, JSON natif.
  transport: !isProd ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' }
  } : undefined,
  // Redact des champs sensibles (cookies de session, auth headers, hashes, tokens, env)
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-958-secret"]',
      '*.password',
      '*.passwordHash',
      '*.SESSION_SECRET',
      '*.AIRTABLE_KEY',
      '*.ANTHROPIC_API_KEY',
      '*.SAV_WEBHOOK_SECRET',
      '*.USERS_HASHES',
      '*.USERS_HASHES_B64',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
