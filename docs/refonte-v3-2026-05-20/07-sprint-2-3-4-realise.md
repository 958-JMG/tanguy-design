# 07 — Sprints 2-4 réalisés (état au 20/05/2026)

Suivi de l'avancement réel par rapport au plan initial (`05-plan-implementation.md`).

---

## Récapitulatif global

| Sprint | Statut | Notes |
|--------|--------|-------|
| Sprint 0 — Décisions produit | ✅ | ADR.md consigné |
| Sprint 0.5 — Audit data quality | ✅ | Script `audit-data-quality.js` (data fictive donc audit informatif uniquement) |
| **Sprint 0.7 — Prep refacto + sécu** | ✅ | 12 commits, CVE fix, ACL, pino, atFetchByIds, fix bug Morales, découpage front, bump Node 20 |
| **Sprint 1 — Pivot client-centric** | ✅ | Migration Airtable appliquée, démo `/v3/` en prod, fiche client, fiche projet, archive |
| **Sprint 2 — Pipeline + BC + Plaud** | ✅ | Pipeline tableau conversion, BC en tableau ASCII sans montants, Plaud R1 enrichi avec création tâches auto |
| **Sprint 3 — Calendar drag-drop** | ✅ | Calendar mensuel custom HTML5, drag-drop pose début/fin, PATCH date-pose |
| **Sprint 4 — Bugs + sécu P1 + P2** | ✅ | Magic bytes PDF, account lockout, Permissions-Policy, bouton support flottant |
| Sprint 5 — Cutover prod | ⏸️ **À VALIDER PAR JMG/TANGUY** | `/v3/` reste en preview tant que pas validé en utilisation réelle |

---

## Sprint 2 — détails livrés

### BC en tableau (P1)
- [server.js buildBcTableau()](server.js) — format ASCII aligné : `Pos | Code | Description | SENS | Cote visible | Qté` (sans montants)
- Version HTML aussi générée pour copier-coller dans mail
- Mapping `CAT_TO_FOURNISSEUR_TYPE` enrichi avec `Plan de travail` (fix P1-7)
- Les Notes des commandes générées à la signature contiennent maintenant ce tableau

### Plaud R1 enrichi (P0)
- [services/devis-parser.js parsePlaudTranscript()](services/devis-parser.js) — prompt Claude étendu avec section `prochaines_actions[]` structurée :
  ```json
  {
    "type": "rdv_presentation_devis | envoi_dossier | dessin_projet | …",
    "titre": "Présenter le devis aux Junker",
    "date_souhaitee": "2026-06-12",
    "assignee_suggere": "Solène",
    "notes": "..."
  }
  ```
- [server.js /api/plaud/parse](server.js) — création **automatique** des tâches Airtable depuis chaque `prochaines_actions[]` :
  - Préfixe auto `[Nom Client]/ Titre`
  - Assignée à la personne suggérée (Virginie / Solène / Sébastien / Marine)
  - Échéance = `date_souhaitee` (peut être null)
  - Liée au projet via `Projet=[projetId]`

### Pipeline tableau + conversion
- [public/v3/assets/js/views/pipeline.js](public/v3/assets/js/views/pipeline.js) — page complète avec :
  - Conversion entre phases (taux %) : Découverte → Dessin → Présentation → En attente → Signé
  - Tableau détail : Phase / Nb / CA estim. / Âge moyen / État (bloqué > 30 j)
  - Click "Voir N →" → filtre liste projets par phase via hash `#pipeline/<Phase>`
  - Alertes blockages > 30 j top 10

### Fiche projet riche
- [public/v3/assets/js/views/projet.js](public/v3/assets/js/views/projet.js) — refonte complète avec stepper 12 étapes, bilan financier, tâches éditables (checkbox toggle + edit/delete inline), commandes/devis/Plaud R1 R2 cards, journal éditable, documents grid
- Endpoint dédié [server.js GET /api/projets/:id](server.js) — agrégat en 1 round-trip

---

## Sprint 3 — détails livrés

### Calendar drag-drop
- [public/v3/assets/js/views/calendar.js](public/v3/assets/js/views/calendar.js) — calendrier mensuel custom (pas de lib externe) :
  - Grille 7×6 vanilla JS, navigation mois précédent/suivant + Aujourd'hui
  - Périodes de pose en barres colorées du Date pose prévue → Date pose fin (défaut +5 j si fin manquante)
  - **HTML5 drag-and-drop natif** sur les événements pose
  - Drop sur nouvelle case → PATCH `/api/projets/:id` (Date pose prévue + Date pose fin, durée préservée) avec confirm avant
  - Mobile responsive (cell 60 px sur ≤ 760 px)

### Rétro-planning auto (déjà Sprint 0.7)
- Endpoint [PATCH /api/projets/:id/date-pose](server.js) recalcule les dates d'échéances liées via `enrichEcheancesAvecDates()` quand la date pose change.
- Tâches J−3,5 mois et J−1,5 mois : à implémenter avant ouverture des données réelles (cron ou trigger sur changement Date pose).

---

## Sprint 4 — détails livrés

### Sécu P1 (issus du tech-lead + security reviewer)

- **Account lockout par login** ([server.js accountIsLocked / Fail / Success](server.js)) :
  - Map en mémoire `login.toLowerCase() → { fails, lockedUntil }`
  - 5 échecs consécutifs → lock 15 min toute IP confondue
  - Bloque le brute-force "pivot multi-IP" qui contournait le rate-limit IP

- **Magic bytes PDF** ([server.js validatePdfMagicBytes](server.js)) :
  - Vérifie `%PDF-` sur les 4 premiers octets du buffer après upload
  - Empêche un upload non-PDF étiqueté avec mimetype manipulé
  - Appliqué sur `/api/devis/import` et `/api/artisan-devis/import`

- **Permissions-Policy header** :
  - `camera=(), microphone=(), geolocation=(), payment=(), usb=()…`
  - Bloque les API navigateur dont le cockpit n'a pas besoin

- **CAT_TO_FOURNISSEUR_TYPE Plan de travail** : fix du bug "plans de travail rangés en Divers" (cf. PDF réunion §3)

### P2 (confort / futur)

- **Bouton support flottant** ([public/v3/assets/js/core/support.js](public/v3/assets/js/core/support.js)) :
  - Bouton rouge en bottom-right (au-dessus bottom nav mobile)
  - Modal "Signaler un problème" avec textarea
  - POST `/api/support/feedback` → log pino structuré (visible Scaleway Logs Browser)
  - Toast confirmation à l'envoi

### Non fait (reporté Sprint 6+)
- ❌ **IA d'analyse cockpit** (cron quotidien Claude lit l'état + email JMG) : trop d'effort pour cette session, à implémenter quand l'app a 6+ mois de data réelle pour analyser.
- ❌ **2FA Authentificator** : reporté car nécessite refonte parcours login + table users avec secret TOTP. À faire avant ouverture éventuelle à des clients externes (v4).
- ❌ **express-session + store** : `cookie-session` reste suffisant à 4 users.

---

## Architecture finale

### Code applicatif

```
server.js                        (1300+ lignes — back end Express)
public/
├── index.html                   (v2 actuelle, sera remplacée au cutover)
├── login.html                   (avec script externe /assets/js/login.js)
├── assets/
│   ├── css/styles.css           (v2 CSS extrait)
│   └── js/
│       ├── login.js
│       └── main.js              (v2 JS monolithique extrait)
└── v3/                          (DÉMO v3, à devenir / au cutover)
    ├── index.html               (squelette minimaliste)
    └── assets/
        ├── css/styles.css
        └── js/
            ├── main.js          (entry, bootstrap, error handling visible)
            ├── core/
            │   ├── state.js
            │   ├── api.js       (wrappers /api/*)
            │   ├── router.js    (hash-based, 6 routes)
            │   ├── search.js    (palette Cmd+K)
            │   ├── lucide.js    (28 icônes SVG inline)
            │   └── support.js   (modal "signaler problème")
            └── views/
                ├── dashboard.js (KPI + funnel + alertes)
                ├── clients.js   (liste + fiche détaillée + modale CRUD)
                ├── projet.js    (stepper + bilan + tâches + commandes + Plaud + journal)
                ├── pipeline.js  (tableau conversion + détail par phase + alertes)
                ├── calendar.js  (mensuel drag-drop)
                └── admin.js     (stub Sprint 6)

services/                        (back end services métier)
├── devis-parser.js              (parseDevisPdf + parsePlaudTranscript enrichi)
├── artisan-devis-parser.js
├── fiche-mission-generator.js
├── echeances-helper.js          (deriveDateEcheance fix bug Morales)
├── echeances-helper.test.js     (17 tests)
├── acl.js                       (TABLE_ACL + FIELD_WHITELIST + helpers)
├── acl.test.js                  (16 tests)
└── logger.js                    (pino central, redact secrets)

scripts/                         (migrations + audit)
├── setup-fields-v3.js           (migration v3 Airtable, idempotent)
├── audit-data-quality.js
├── backup-airtable-csv.js
├── backfill-dates-echeances.js  (fix bug Morales rétroactif)
└── ... (anciens scripts v2 conservés)
```

### Infra
- **Scaleway Serverless Containers** (`tanguy` dans namespace `cockpits`, fr-par)
- **Cloudflare proxied** devant
- **Node 20-alpine** image
- **Express** + cookie-session + Helmet + rate-limit + pino-http
- **Airtable** comme DB (15 tables, 539 clients fictifs + 4 projets fictifs)
- **CI GHA** : test.yml (33 tests) + deploy-scaleway.yml

---

## Métriques sécurité finales

| Item | Avant Sprint 0.7 | Après Sprint 4 |
|------|------------------|----------------|
| CVE runtime | 1 moderate | 0 |
| `unsafe-inline` script-src | Oui | Non (`'self'` seul) |
| sameSite cookie | `lax` | `strict` |
| Proxy CRUD CSRF | ❌ aucune protection | ✅ sameSite=strict |
| Proxy CRUD ACL | ❌ tout user peut tout | ✅ table × verb × role + whitelist champs |
| `eval()` côté client | 1 occurrence | 0 |
| Brute-force par compte | ❌ rate-limit IP seulement | ✅ lockout 5 fails / 15 min par login |
| Upload PDF validation | ❌ mimetype déclaré seul | ✅ magic bytes `%PDF-` |
| Permissions-Policy | ❌ aucune | ✅ camera/mic/géo/payment/usb bloqués |
| Logs structurés | console.log | pino JSON + redact secrets |
| Tests automatisés | 0 | 33 (node --test) |
| CI | deploy seul | test + deploy en chaîne |

---

## Décisions pour cutover (Sprint 5)

Avant de basculer `/` vers v3, à valider :

1. **Tests utilisateurs** : Virginie + Tanguy testent le flux complet (création projet, édition, archivage, Plaud, calendar drag-drop) pendant 1 semaine sur `/v3/`.
2. **Bug reports** : centralisés via le bouton support flottant. Triage avant cutover.
3. **Backup snapshot** Airtable juste avant cutover (`node scripts/backup-airtable-csv.js`).
4. **Mobile** : test 390 px iPhone Safari (responsive déjà OK en théorie, à valider).
5. **Upload fichiers v3** : NON implémenté. Avant cutover, soit le faire, soit garder le `<a href="/">v2</a>` accessible pour upload.
6. **Architecte** : valeur "Architecte" à ajouter manuellement dans Airtable UI (l'API ne l'a pas accepté).

Une fois ces 6 points OK : cutover en 1 commit qui :
- Renomme `public/v3/index.html` → `public/index.html` (et purge l'ancien)
- Bascule la route `/` vers le nouveau front
- Supprime `public/assets/js/main.js` (l'ancien v2 monolithique extrait)
- Archive `docs/refonte-v3-2026-05-20/` en `docs/archives/`

---

## Mémoire & dette restante

Voir `MEMORY.md` pour les feedbacks senior accumulés :
- pas d'emoji → Lucide SVG (`feedback_no_emoji_lucide_only.md`)
- `\\'` dans single-quote casse ES modules (`feedback_es_module_escape_strict.md`)
- CSP grep all .html (`feedback_csp_inline_script_login.md`)
- Cloudflare trailing slash (`feedback_cloudflare_trailing_slash_redirect.md`)
- JMG délègue choix techniques senior (`feedback_jmg_delegue_decisions_techniques.md`)
- Bus factor 1 → faire des tests pour servir de doc exécutable

### Dette technique restante (acceptable / à traiter v4+)
- `bcrypt` natif (2 high CVE build-time non exploitables) → migration `bcryptjs` v4
- `cookie-session` → `express-session` + store (v4 si > 20 users)
- Upload front v3 (multer côté front + magic bytes côté back déjà OK)
- IA d'analyse cockpit suggestions
- 2FA TOTP
- Architecte enum Airtable (à ajouter manuellement)
- Cron rétro-planning (tâches J-3.5m + J-1.5m auto à création/MAJ date pose)

---

*Document à jour au 20/05/2026, fin de session "tout livrer".*
