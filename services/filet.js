'use strict';
/**
 * services/filet.js — le filet des routes async et du processus (lot B de la passe de sécurité du 18/10/2026).
 *
 * En Express 4, une promesse rejetée dans une route `async` n'arrive jamais au gestionnaire d'erreurs : la requête reste
 * sans réponse et, depuis Node 15, le rejet non rattrapé tue le processus — toutes les requêtes en cours avec. Au 18/10,
 * 64 des 85 routes async de server.js n'avaient pas de try. Plutôt que 64 retouches, UNE règle, ici, pour toutes :
 *   - securiserRoutes(app) : chaque fonction async passée à app.get/post/put/patch/delete/all/use est enveloppée pour que
 *     son rejet parte dans next(err). Une route qui a déjà son try ne change pas (son try répond avant). Un gestionnaire
 *     d'erreurs async (quatre paramètres) garde son arité — sinon Express le prendrait pour une route ordinaire.
 *   - gestionnaireErreurs(logger) : le dernier middleware — il écrit l'erreur au journal et répond (JSON sous /api,
 *     texte ailleurs), sans jamais renvoyer la pile ; il respecte le statut qu'une erreur porte déjà (multer, JSON mal
 *     formé : 413, 400…), 500 sinon.
 *   - installerFilet(logger) : process.on('unhandledRejection') qui journalise sans sortir — ce qui échappe encore (un
 *     setTimeout, un .then sans catch) ne tue plus le cockpit.
 * Preuve : services/filet.test.js.
 */

const estAsync = (fn) => typeof fn === 'function' && !!fn.constructor && fn.constructor.name === 'AsyncFunction';

/** Une fonction async devient une fonction dont le rejet part dans next(err) ; tout le reste revient tel quel. */
function envelopper(fn) {
  if (!estAsync(fn)) return fn;
  if (fn.length === 4) return function filetErreur(err, req, res, next) { return fn(err, req, res, next).catch(next); };
  return function filet(req, res, next) { return fn(req, res, next).catch(next); };
}
const envelopperTous = (args) => args.map((a) => (Array.isArray(a) ? envelopperTous(a) : envelopper(a)));

const METHODES = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];
function securiserRoutes(app) {
  for (const m of METHODES) {
    const originale = app[m];
    app[m] = function (...args) {
      if (m === 'get' && args.length === 1) return originale.apply(this, args);   // app.get('réglage') lit un réglage
      return originale.apply(this, envelopperTous(args));
    };
  }
  return app;
}

const MESSAGE_500 = 'Erreur interne du serveur. Réessayez dans un instant.';
function gestionnaireErreurs(logger) {
  // Quatre paramètres : c'est ce qui dit à Express « gestionnaire d'erreurs ». `next` sert si la réponse était déjà partie.
  return (err, req, res, next) => {
    const statut = Number(err && (err.status || err.statusCode)) || 500;
    const trace = { err, methode: req.method, chemin: req.originalUrl, statut };
    if (statut >= 500) logger.error(trace, 'erreur non rattrapée dans une route — réponse 500, le serveur continue');
    else logger.warn(trace, 'requête refusée');
    if (res.headersSent) return next(err);
    const message = statut >= 500 ? MESSAGE_500 : ((err && err.message) || 'Requête refusée.');
    if (req.originalUrl.startsWith('/api/') || (req.headers.accept || '').includes('application/json')) return res.status(statut).json({ error: message });
    return res.status(statut).type('text/plain').send(message);
  };
}

function installerFilet(logger) {
  process.on('unhandledRejection', (raison) => {
    logger.error({ err: raison instanceof Error ? raison : new Error(String(raison)) }, 'promesse rejetée sans gestionnaire — journalisée, le serveur continue');
  });
}

module.exports = { securiserRoutes, envelopper, gestionnaireErreurs, installerFilet, MESSAGE_500 };
