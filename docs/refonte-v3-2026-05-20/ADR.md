# ADR — Decisions architecturales refonte v3

Architectural Decision Records pour la refonte v3 du cockpit Tanguy Design. Chaque ADR consigne le contexte, l'option retenue, les options écartées, les conséquences.

---

## ADR-001 — Sprint 0.7 ajouté avant le pivot client-centric

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : la revue tech-lead + security a identifié 6 P0 bloquants (front monolithique, proxy CRUD sans ACL, eval, CVE, bug Morales, absence de tests). Démarrer Sprint 1 sans les traiter accumule la dette.
**Décision** : insérer un Sprint 0.7 de 4 jours entre les décisions produit et le pivot client-centric.
**Conséquences** :
- Cutover repoussé d'~1 semaine (fin juin → première semaine de juillet 2026).
- Sprint 1-5 sur base saine, sans rétrofit douloureux.
- Investissement de 4 j remboursé largement par la qualité du reste.

---

## ADR-002 — Bascule `sameSite: 'strict'` (mitigation CSRF immédiate)

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : le cockpit n'a pas de protection CSRF active. `sameSite: 'lax'` actuel ne protège que contre les top-level GET cross-site, pas contre les POST via form auto-submit. Mutations à risque (`DELETE /api/data/...`, `POST /api/devis/:id/sign`).
**Options évaluées** :
- A. `csrf-csrf` token double-submit (~30 lignes, 2 h, robuste, standard)
- B. **Bascule `sameSite: 'strict'`** (30 min, suffisant car l'app n'est jamais accédée via lien externe)
- C. Ne rien faire (dette + risque)
**Décision** : Option B en Sprint 0.7. Option A en réserve si on ouvre l'app à des liens externes / webhooks entrants un jour.
**Conséquences** :
- Si un utilisateur arrive sur le cockpit via un lien (mail, signet), il doit re-login. Comportement acceptable pour un cockpit interne.
- Le webhook SAV sortant (proxy `/api/sav-webhook`) n'est pas affecté car ce sont des appels du serveur vers n8n, pas inverse.

---

## ADR-003 — ES modules natifs (pas de bundler)

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : `public/index.html` (4789 lignes) doit être découpé. Faut-il introduire un bundler (Webpack / Vite / esbuild) ?
**Options évaluées** :
- A. **ES modules natifs** via `<script type="module">`
- B. Vite (HMR, build optimisé, écosystème, TS-ready)
- C. Webpack (legacy, plus lourd)
**Décision** : Option A.
**Raisons** :
- Projet petit (4 users, ~6000 lignes JS), HTTP/2 + Cloudflare gèrent le coût des fichiers multiples.
- Pas de TS, pas de JSX → un bundler n'apporte rien.
- Zéro chaîne de build = zéro dette d'outillage à maintenir.
- Cohérent avec le pattern minimaliste des cockpits 9·58.
- Si TS / pré-processeurs deviennent utiles plus tard, bascule Vite triviale (ESM compatible).
**Conséquences** :
- Découpage `public/assets/js/` en `core.js`, `api.js`, `views/*.js` directement servi par Express static.
- Pas de minify ni tree-shake — acceptable vu la taille et HTTP/2.

---

## ADR-004 — Tests avec `node --test` natif (Node 20)

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : aucun test existe actuellement. La v3 va toucher 7 endpoints critiques. Filet régression nécessaire.
**Options évaluées** :
- A. **`node --test` natif** (Node 20+)
- B. Jest
- C. Vitest
- D. Mocha + Chai
**Décision** : Option A.
**Raisons** :
- Stable et mature depuis Node 20.
- Zéro dépendance = zéro surface d'attaque supplémentaire.
- Performance native (5 tests s'exécutent en <500 ms vs ~3-5 s pour Jest).
- Mocking via `node:test` mock.fn() suffit pour stubber `@anthropic-ai/sdk` et `fetch` Airtable.
- Pas de jsdom nécessaire (on teste les services + endpoints, pas le DOM).
- Format TAP standard, output lisible.
**Conséquences** :
- Bump Node 18 → 20 dans le Dockerfile (changement mineur, breaking changes nulles pour notre stack).
- 5-10 tests sur `parseDevisPdf`, `parsePlaudTranscript`, `deriveDateEcheance`, ACL middleware, helpers Airtable.
- Job GHA `test.yml` qui run `node --test` + `node -e "require('./server.js')"` (smoke import) **avant** `deploy-scaleway.yml`.

---

## ADR-005 — Logging structuré avec `pino` + `pino-http`

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : tous les logs sont `console.log('[contexte] message')` aujourd'hui. Non parsable par Scaleway Logs Browser. Pas de request-id pour tracer une requête de bout en bout.
**Options évaluées** :
- A. **`pino` + `pino-http`** (JSON structuré, request-id auto, performance native)
- B. `winston` (plus daté, lourd, mais écosystème)
- C. `console.log` enrichi maison (réinvention de la roue)
- D. Status quo
**Décision** : Option A.
**Raisons** :
- Standard de facto Node moderne.
- Performance excellente (benchmarks insolents).
- `pino-http` middleware ajoute `req.id`, `responseTime`, `statusCode` automatiquement.
- Pretty-print en dev via `pino-pretty`, JSON en prod, auto-détecté via `NODE_ENV`.
- 2 h d'investissement, gain énorme en debug.
- Compatible direct Scaleway Logs Browser (ingestion JSON native).
**Conséquences** :
- 2 dépendances ajoutées : `pino`, `pino-http` (+ `pino-pretty` en dev).
- Remplacement progressif des `console.log` existants par `logger.info/warn/error`.
- Format de log standardisé : `{ time, level, msg, reqId, route, ... }`.

---

## ADR-006 — `cookie-session` conservé en v3, migration `express-session` reportée v4

**Date** : 2026-05-20
**Statut** : ✅ Accepté
**Contexte** : `cookie-session` stocke tout l'état en cookie signé client. Pas de rotation côté serveur, pas de "logout sur tous les appareils", pas de révocation immédiate.
**Options évaluées** :
- A. **Conserver `cookie-session`** en v3, migration `express-session` + store v4
- B. Migrer `express-session` + Redis Scaleway Managed en v3 (~1 j)
- C. Migrer `express-session` + Postgres session table v3 (~1 j)
**Décision** : Option A.
**Raisons** :
- 4 users / container scale max 3 = pas de besoin réel de store partagé.
- 2FA TOTP **compatible** avec cookie-session (flag `2fa_validated_at` dans le cookie signé).
- Migration store = +1 service ops (Redis ou table Postgres) = surcoût injustifié à 4 users.
- Risque vol cookie mitigé par HTTPS + SameSite=strict + HSTS + bcrypt + 2FA.
- La v3 doit livrer la valeur métier avant l'over-engineering infra.
- Migration légitime en v4 si JMG ouvre aux clients externes ou >20 users.
**Conséquences** :
- v3 garde sa simplicité ops.
- Mitigation : script `scripts/rotate-session-secret.js` à lancer en cas d'incident (déconnecte tout le monde, OK pour 4 users).
- Le 2FA TOTP en Sprint 3 sera implémenté sur la base cookie-session existante.

---

## Décisions encore à trancher (Sprint 0)

À valider avec Tanguy lors de l'atelier décisions produit :

- ADR-007 — Architecte = type Client + self-référence, OU nouvelle table Airtable ?
- ADR-008 — Avenant BC = nouveau record `Commande` avec `BC parent`, OU flag `Type=Avenant` ?
- ADR-009 — Pipeline = 2 champs distincts `Phase commerciale` + `Statut chantier`, OU 1 champ unifié ?
- ADR-010 — `Cmd+K` recherche globale dans le scope v3 ou v4 ?
- ADR-011 — Drag-drop calendar = FullCalendar.js, OU autre lib ?
- ADR-012 — Templates de tâches par étape = admin JMG, ou Virginie ?

Recommandations dans le doc `04-architecture-cible.md §12`.
