# 06 — Code review & revue d'architecture senior

> Synthèse croisée tech-lead (architecture + code quality) + security-reviewer (OWASP + secrets + dépendances). Rédigé le 20/05/2026 avant démarrage Sprint 1 v3.

---

## Verdict global

**Code plus propre que la moyenne d'un cockpit interne mono-dev.** Backend défensif, services Claude bien isolés, scripts migration Airtable idempotents, sécurité au-dessus de la baseline 9·58. **Deux obstacles structurels** doivent être traités avant Sprint 1 v3 :

1. **`public/index.html` monolithique** (4789 lignes, JS+CSS inline) — rend la démo `/v3/` isolée 2× plus coûteuse à maintenir.
2. **Proxy CRUD Airtable générique sans ACL** (`/api/data/:table`) — n'importe quel user authentifié peut modifier rétro-commissions, marges, devis-artisans.

Tout le reste est de la dette gérable. **Ajouter un Sprint 0.7 (3-4 jours) de prep refacto + sécu** rend les 5 sprints suivants beaucoup plus sereins.

---

## Synthèse executive

- ✅ **Sécurité au-dessus de la baseline** : Helmet + CSP, rate-limit login séparé du global, bcrypt rounds=10, `trust proxy = 2` correct pour CF+Scaleway, container non-root, refus de démarrer en prod sans `SESSION_SECRET` ≥ 32 chars.
- ✅ **Architecture backend saine** : helpers Airtable centralisés avec pagination + batching, parsing Claude bien isolé en `services/`, scripts migration idempotents.
- 🔴 **Front monolithique** : 1 fichier de 4789 lignes, 155 fonctions globales `window.*`, `onclick="..."` inline obligeant `'unsafe-inline'` partout. Bloquant pour le pattern `/v3/` isolée prévu au plan.
- 🔴 **Proxy CRUD trop permissif** : `/api/data/:table` autorise tout user à GET/POST/PATCH/DELETE sur n'importe quelle table — pas de séparation collab/admin malgré `ADMIN_LOGINS`.
- 🟠 **0 test, 0 CI** : aucune protection contre les régressions, alors que la v3 va toucher 7 endpoints critiques.
- 🟠 **CVE moderate** active sur `express-rate-limit` (transitive `ip-address`). Fix gratuit en `npm update`.

---

## Findings P0 — à traiter AVANT Sprint 1 (~3-4 j)

### P0-1. Front monolithique [tech-lead]

**Fichier** : `public/index.html` (4789 lignes)
**Constat** : tout est inline. 155 fonctions globales. Toutes les vues cohabitent dans le même namespace. C'est ce qui justifie aujourd'hui `script-src 'unsafe-inline'` et `script-src-attr 'unsafe-inline'` dans la CSP.
**Conséquence v3** : la démo `/v3/` isolée du plan d'implémentation impose soit dupliquer ~5000 lignes (drift assuré sur 5 sprints), soit partager du code utilitaire (impossible si tout est `window.*`).

**Action** : découpage minimum via ES modules natifs (pas de bundler) :
```
public/
├── index.html (squelette + nav, ~300 lignes max)
├── assets/css/styles.css
└── assets/js/
    ├── core.js          # $, esc, euros, pct, setSync, toast, makeCardsAccessible
    ├── api.js           # tous les fetch('/api/...')
    └── views/
        ├── dashboard.js
        ├── clients.js
        ├── projets.js
        ├── commandes.js
        ├── pipeline.js  (à créer pour la v3)
        └── ...
```
ES modules natifs (`<script type="module">`) suffisent — pas besoin de Webpack/Vite. **Effort** : 2-3 j.

### P0-2. Proxy CRUD Airtable sans ACL [security]

**Fichier** : `server.js:333-367`
**Constat** : `/api/data/:table` (GET/POST/PATCH/DELETE) accepte n'importe quelle table autorisée par `TABLES` et n'importe quel champ via `typecast: true`. `marine` (collab) peut techniquement `DELETE /api/data/devis/<id>` ou modifier la `Rétro-commission` d'un artisan. Mass-assignment sur tous les champs.
**Conséquence v3** : la refonte de l'auth (2FA) doit s'accompagner d'une refonte de l'autorisation, sinon le 2FA protège l'entrée mais le système reste plat à l'intérieur.

**Action** : middleware `requireTableAccess(req, action)` + whitelist explicite des champs modifiables :
```js
const TABLE_ACL = {
  artisans:        { read: ['*'], write: ['admin'],          fields: { admin: ['Nom', 'Contractuel', 'Téléphone'] } },
  // 'Rétro-commission' jamais éditable via /api/data
  fournisseurs:    { read: ['*'], write: ['admin'],          fields: { admin: ['Nom', 'Famille', 'Email', 'Adresse'] } },
  taches:          { read: ['*'], write: ['*'],              fields: { '*': ['Titre', 'Statut', 'Assignée à', 'Échéance', 'Priorité', 'Description'] } },
  // ...
};
```
**Effort** : 0,5-1 j. À faire AVANT le Sprint 1 pour ne pas amplifier le problème en élargissant l'API à de nouveaux endpoints.

### P0-3. Bug Morales — investigation préalable [tech-lead]

**Fichier** : `services/devis-parser.js:117` + `server.js:577-589`
**Constat** : déjà investigué — voir [bug-morales-echeances.md](bug-morales-echeances.md). C'est un **bug de spec**, pas un bug de code accidentel : le prompt Claude est correct (il ne devine pas une date inexistante), le serveur supprime les nulls. Manque la couche métier de dérivation `(libellé, dateDevis, datePose) → date`.
**Conséquence v3** : si pas fixé, contamine tous les devis créés en Sprint 1-3.

**Action** : `services/echeances-helper.js` avec `deriveDateEcheance()` (algorithme déjà décrit dans le doc). Brancher à l'import + endpoint `PATCH /api/projets/:id/date-pose` qui recalcule.
**Effort** : 0,5 j.

### P0-4. `eval()` côté client [security]

**Fichier** : `public/index.html:1218`
```js
if (e.key==='Enter' && SEARCH_RESULTS[SEARCH_IDX]) { e.preventDefault(); eval(SEARCH_RESULTS[SEARCH_IDX].action); }
```
**Constat** : aujourd'hui `action` est interpolée depuis des IDs Airtable (faible exploitabilité), mais une mine. Première interpolation d'un champ texte utilisateur dans `action` → XSS exécutif qui contourne la CSP.
**Action** : remplacer par dispatcher pur :
```js
const { tab, openId } = SEARCH_RESULTS[SEARCH_IDX].action;
switchTab(tab); if (openId) openDetail(tab, openId);
```
**Effort** : 30 min. À faire en même temps que le découpage front (P0-1).

### P0-5. CVE moderate `express-rate-limit` → `ip-address` [security]

**Constat** : `npm audit` remonte GHSA-v2v4-37r5-5v8g (XSS via `ip-address` transitive). Faible exploitabilité directe ici (la sortie n'est pas rendue en HTML), mais fix gratuit.
**Action** : `npm update express-rate-limit` puis `npm audit` re-check.
**Effort** : 5 min.

### P0-6. Aucun test, aucune CI [tech-lead]

**Constat** : pas de `npm test`, pas de `lint`, pas de smoke check. Le workflow GHA build + push sans vérifier que le serveur démarre.
**Action minimum viable** :
- `node --test` (intégré Node 20) avec **5 tests sur les 3 endpoints critiques** : signature devis, import devis, parse Plaud. Mocker `@anthropic-ai/sdk` + Airtable fetch.
- Job GHA `test.yml` : `node --test` + `node -e "require('./server.js')"` (smoke import) **avant** le job `deploy-scaleway.yml`.
- Pas viser 80 % de couverture — viser les 3 endpoints qui cassent en prod.
**Effort** : 1 j.

---

## Findings P1 — à traiter PENDANT la v3 (~3 j cumulés, distillés dans les sprints)

### P1-1. Logging non structuré (`console.log` partout) [tech-lead]
**Action** : `pino` + `pino-http` + request-id middleware. Format JSON parsable par Scaleway Logs Browser. **Effort** : 2 h. **Sprint** : 0.7 ou 1 (avant que la v3 ajoute des routes).

### P1-2. Duplication résolution projet → client (~5 fois) [tech-lead]
**Action** : `atGet(tableId, recordId)` + `resolveClientFromProjet(projetId)` helpers. Préparer Architecte (qui double les niveaux). **Effort** : 0,5 j. **Sprint** : 1 (en même temps que l'archi client-centric).

### P1-3. CSRF non protégé sur mutations [security]
**Constat** : `sameSite: 'lax'` ne protège pas contre les POST cross-site via form auto-submit. Routes mutantes (`DELETE /api/data/...`, `POST /api/devis/:id/sign`) à risque.
**Action** : 2 options
- **Option A** : `csrf-csrf` (token double-submit, ~30 lignes). Robuste, standard.
- **Option B** : bascule `sameSite: 'strict'`. App jamais accédée via lien externe → acceptable.
**Reco** : Option B d'abord (immédiat, gratuit), Option A à terme si on veut webhooks externes ou liens email signés.
**Effort** : 30 min (Option B) / 2 h (Option A). **Sprint** : 0.7.

### P1-4. Sessions 30 j sans rotation côté serveur [security]
**Constat** : `cookie-session` stocke tout côté client. Pas de "logout sur tous les appareils", pas de révocation immédiate.
**Action v3** : `express-session` + store. Vu l'échelle (4 users, container scale max 3), `cookie-session` peut tenir en v3 si on accepte la contrainte. **Reco** : reporter à v4 sauf si 2FA exige rotation immédiate.
**Effort** : 1 j si fait. **Sprint** : 3 (avec 2FA) ou v4.

### P1-5. Login lockout par compte manquant [security]
**Constat** : rate-limit par IP, pas par compte. Pivot sur 10 IPs → brute-force `virginie` sans contrainte.
**Action** : Map `accountLockout[login.toLowerCase()] = { fails, lockedUntil }` en mémoire (4 users, pas de Redis nécessaire). Lock 15 min après 5 fails.
**Effort** : 1 h. **Sprint** : 3 (avec 2FA — moment naturel).

### P1-6. Upload PDF sanity check insuffisant [security]
**Constat** : `fileFilter` se base sur `mimetype` déclaré client (manipulable). Un user authentifié peut soumettre du non-PDF → consommation tokens Claude.
**Action** : check magic bytes `%PDF-` (4 premiers octets) du buffer avant appel Claude. Cap `req.body.projetId` à `/^rec[A-Za-z0-9]{14}$/`.
**Effort** : 30 min. **Sprint** : 4 (avec refonte BC).

### P1-7. `CAT_TO_FOURNISSEUR_TYPE` hardcodé + manque `Plan de travail` [tech-lead]
**Constat** : ligne `server.js:611-619`. La table `Fournisseurs.Famille` devrait être la source de vérité.
**Action** : externaliser → soit `config/categories.json`, soit lookup depuis Airtable. Ajouter `Plan de travail`.
**Effort** : 1 h. **Sprint** : 4 (avec refonte BC, fix bug "plans en Divers").

### P1-8. `atFetchAll` complets sur Zones/Lignes/Échéances [tech-lead]
**Constat** : `server.js:382-389`, `server.js:655-657`, `server.js:893` — filtre côté client après tout charger. À 12 500 records dans 5 ans, signature passera de 1s à 10s.
**Action** : `atFetchFiltered` avec `filterByFormula=FIND("recXXX", ARRAYJOIN({Devis}))`. Le helper existe (`server.js:229-233`), jamais utilisé.
**Effort** : 2 h. **Sprint** : 1 (avant que la v3 amplifie le volume).

---

## Findings P2 — confort / défense en profondeur

- **`node-fetch` v2 inutile** depuis Node 18+ fetch natif → retirer dep (5 min, **v3**).
- **`bcrypt` natif** → `bcryptjs` pur JS éviterait `libc6-compat` dans Dockerfile (10 min, **v4**).
- **`multer` 1.4.5-lts.1** → 2.x activement maintenu (1 h, **v3**).
- **`Permissions-Policy` header absent** → ajouter `camera=(), microphone=(), geolocation=()` (5 min, **v3**).
- **Dockerfile pin par digest** : `FROM node:20-alpine@sha256:...` pour reproductibilité (5 min, **v3**).
- **Pas de retry Airtable** sur 429/503 → écrasement partiel possible à la signature. Retry exponentiel sur 503/429 (1 h, **v3**).
- **`/api/me` isAdmin client-checked** : confirmer que la source de vérité reste serveur, pas dual-check (audit nécessaire, 30 min, **v3**).
- **SAV proxy `SAV_WEBHOOK_SECRET`** : vérifier `secret_environment_variables` Scaleway, pas `environment_variables` (5 min, **v3**).
- **`clientIp()` n'enforce pas CF-only** : un jour si container exposé direct hors CF, IP spoofable. Mitigation : règle Scaleway "ingress Cloudflare IPs only" (15 min, **v3**).

---

## Plan d'action consolidé

### Sprint 0.7 — Prep refacto avant v3 (3-4 j, NOUVEAU)

À glisser entre **Sprint 0** (décisions produit) et **Sprint 1** (pivot client-centric) :

| # | Action | Source | Effort |
|---|--------|--------|--------|
| 1 | Découper `index.html` en `core.js` + `api.js` + 5-6 views/ via ES modules | P0-1 | 2-3 j |
| 2 | ACL `requireTableAccess` + whitelist champs par table + `typecast: false` | P0-2 | 0,5-1 j |
| 3 | Virer `eval()` ligne 1218 + dispatcher pur | P0-4 | 30 min |
| 4 | `npm update express-rate-limit` | P0-5 | 5 min |
| 5 | `node --test` + 5 tests endpoints critiques + job GHA `test.yml` | P0-6 | 1 j |
| 6 | Bascule `sameSite: 'strict'` (mitigation CSRF immédiate) | P1-3 | 30 min |
| 7 | `pino` + `pino-http` + request-id | P1-1 | 2 h |
| 8 | `atFetchFiltered` sur Zones/Lignes/Échéances dans signature devis | P1-8 | 2 h |
| 9 | `services/echeances-helper.js` + fix bug Morales | P0-3 | 0,5 j |

**Total Sprint 0.7** : ~4 jours. Investissement qui économise 1-2 sprints sur la v3.

### Sprint 1 (recadrage)

Ajouts au Sprint 1 par rapport au plan v1 :
- Refactor helpers `atGet` + `resolveClientFromProjet` (P1-2)
- Utilisation systématique de la structure ES modules (suite Sprint 0.7)

### Sprint 4 (recadrage)

Ajouts :
- Externaliser `CAT_TO_FOURNISSEUR_TYPE` + `Plan de travail` (P1-7)
- Upload PDF magic bytes (P1-6)
- Retry Airtable 429/503 (P2)

### Sprint 3 (recadrage)

Ajouts (à faire en même temps que 2FA pour cohérence) :
- Account lockout par login (P1-5)
- Migration `express-session` si exigence 2FA rotation (P1-4) — sinon report v4

### Sprint 5 (recadrage)

Ajouts :
- `Permissions-Policy` header (P2)
- Dockerfile pin digest (P2)
- Confirm SAV_WEBHOOK_SECRET dans `secret_environment_variables` Scaleway (P2)

---

## Calendrier global mis à jour

| Sprint | Durée | Cumul | Livrable |
|--------|-------|-------|----------|
| 0   | 3 j | 3 j  | Décisions tranchées + ADR |
| 0.5 | 1 j | 4 j  | Audit data quality (sur data réelle quand elle existera) |
| **0.7** | **4 j** | **8 j** | **Prep refacto + sécu (NOUVEAU)** |
| 1   | 5 j | 13 j | Client-centric utilisable |
| 2   | 5 j | 18 j | Pipeline + alertes |
| 3   | 5 j | 23 j | Calendar drag-drop + rétro-planning + 2FA + lockout |
| 4   | 5 j | 28 j | BC tableau + Plaud enrichi + bugs + magic bytes + retry |
| 5   | 3 j | 31 j | Cutover prod + rollback + Permissions-Policy + Docker pin |

**Total v3** : ~6,5 semaines calendaires (vs 5,5 v1). +1 semaine = investissement directement remboursé par la qualité du Sprint 1-5.

---

## Décisions à valider avec JMG

1. **Sprint 0.7 accepté** : 4 j de prep refacto + sécu avant Sprint 1, cible cutover ~première semaine de juillet 2026 au lieu de fin juin.
2. **`sameSite: 'strict'` accepté** : aucun lien externe vers le cockpit (webhooks SAV exclus de cette règle car POST entrant pas affecté). Si oui, mitigation CSRF immédiate.
3. **ES modules natifs (pas de bundler)** : reste simple, pas de Webpack/Vite. OK pour JMG ?
4. **`node --test` natif** vs Jest/Vitest : reste léger, zéro dépendance. OK ?
5. **`pino` JSON logs** : OK pour JMG ou préférence pour `console.log` formaté ?
6. **Migration `cookie-session` → `express-session`** : reporter à v4 (4 users tolère) ou pousser en v3 avec 2FA ?

---

## Note senior — ce que j'aurais fait si je découvrais le code à froid

Globalement, le code montre les marques d'un dev qui sait ce qu'il fait :
- Pas de credentials hardcodés
- Refus de démarrer en prod sans secret robuste
- Rate-limit séparé login/global
- bcrypt + helmet correctement configurés
- Scripts de migration idempotents
- Documentation de refonte de qualité (le dossier `docs/refonte-v3-2026-05-20/` lui-même est exemplaire)

Le seul vrai gros os, c'est `index.html` monolithique — défaut classique des cockpits internes mono-dev qui démarrent vite. Mais il bloque mécaniquement la suite. Le découpage proposé (~2-3 j) est l'investissement avec le meilleur ROI de toute la refonte v3.

Le reste de la dette (CSRF, ACL, tests, logs) est typique d'un projet à 4 users qui n'a pas eu besoin de durcir. La refonte v3 + 2FA est l'occasion parfaite pour rebattre les cartes proprement, sans rétrofit douloureux.

**Verdict définitif** : feu vert pour la v3 **après Sprint 0.7**. Ne pas le sauter.
