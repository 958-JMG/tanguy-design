# Tanguy Design — Cockpit

Cockpit de gestion chantiers cuisines pour l'agence Tanguy Design (Vannes).
4 utilisateurs : Virginie (admin), Solène (design), Sébastien (pose), Marine (commercial).

## Stack
Node.js 18+ / Express 4.19 / Airtable / session cookie + bcrypt / **Scaleway Serverless Containers** (fr-par).
Helmet + rate-limit pour les headers et le bruteforce.

## Local
```bash
cp .env.example .env   # remplir SESSION_SECRET (openssl rand -hex 32), AIRTABLE_*, ANTHROPIC_API_KEY, USERS_HASHES, ADMIN_LOGINS
npm install
npm start
```

Health : `curl http://localhost:3000/api/health`

## Déploiement
Container Scaleway `tanguy` (namespace `cockpits`, image `rg.fr-par.scw.cloud/958-registry/tanguy`).
**URL prod** : `tanguydesign.958.fr`.
Deploy : workflow `.github/workflows/deploy-scaleway.yml` (manual dispatch depuis `main`).

## Rôles
L'env `ADMIN_LOGINS` (CSV, lowercase, défaut `virginie`) définit qui voit le menu Admin (Marges + Stock).

## Scripts utilitaires
```bash
node scripts/hash-password.js MonMotDePasse                    # génère un hash bcrypt
node scripts/setup-attachment-fields.js                        # crée/vérifie les 4 champs sur Projets (idempotent)
node scripts/import-dossiers-v2.js <dossier> [--execute]       # importe dossiers clients + uploads catégorisés
```

## Tables Airtable
Clients · Projets · Artisans · Fournisseurs · Commandes · Tâches · SAV · Devis · Zones devis · Lignes devis · Échéances devis · Fiches découverte · Réunions Plaud · Stock · Devis Artisans

## Champs custom sur Projets
- `Plan 3D` (attachments) — dossiers de présentation, visualisations Winner / Métron, plans d'aménagement
- `Plan technique` (attachments) — plans archi, autocad, prise de cotes
- `Images` (attachments) — photos chantier, références ambiance, moodboards
- `Documents projet` (attachments) — BC, AR, cahier des charges, notices, factures, etc.
- `Journal chantier` (Long text) — remarques datées `[YYYY-MM-DD HH:MM — Auteur] texte` (plus récent en haut). Éditable / supprimable depuis la fiche projet (PATCH/DELETE `/api/projets/:id/journal`).

Limite Airtable : 5 MB par fichier via l'API.

## Fonctionnalités fiche projet (refonte 2026-04-30)
- **Stepper parcours chantier** (12 étapes : Découverte → Devis → Signature → Acompte → Plans tech → Commandes → Réception → Pose → PV → Facture solde → Avis → SAV) — calcul 100 % front à partir des données existantes.
- **Bilan financier prévisionnel** (CA, fournisseurs, artisans − rétro 5 %, marge € + %) avec mode auto-détecté (Réalisé / Prévi).
- **Zone facturation** (Acompte 30 % / Réception 40 % / Solde 30 %) qui crée des tâches `[FACTURATION]` pour Virginie.
- **Sidebar TOC** (≥ 1100 px) avec compteurs et badges urgence rouges.
- **Onglets attachments** : Plan 3D / Plan technique / Images / Documents projet (un visible à la fois).
- **R1 Découverte / R2 Chantier** : transcriptions Plaud collées directement dans la fiche projet, analysées par Claude (synthèse, contexte, attentes, points de douleur, tâches identifiées).
- **Tâches éditables** : clic sur une row → modal d'édition · bouton 🗑 inline pour suppression rapide.
- **Responsive mobile** (≤ 760 px) : stepper compact horizontalement scrollable, fiche en 1 colonne, modale plein écran.

## Sécurité

### Protections en place (2026-04-25)
- **Helmet** — HSTS (1 an, prod only), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, CSP adaptée (`unsafe-inline` autorisé car `index.html` monolithique).
- **Rate limiting** — `/api/*` : 300 req/min/IP · `/api/login` : 10 tentatives/15 min/IP (bruteforce protection, ne compte pas les succès).
- **Sessions** — `cookie-session` signé, `httpOnly`, `sameSite=lax`, `secure=true` en prod (HTTPS only), `maxAge` 30 j.
- **SESSION_SECRET guard** — en prod (`NODE_ENV=production`), le serveur refuse de démarrer si secret absent / par défaut / < 32 chars.
- **Logs d'auth** — échecs ET succès logués avec login + IP + timestamp. Le mot de passe n'est JAMAIS logué.
- **bcrypt** rounds=10 sur tous les mots de passe.
- **Container non-root** — user `tanguy` (UID 1001) dans le Dockerfile.
- **Secrets** — `.env` gitignored + dockerignored. Tokens dans env Scaleway uniquement.

### Rotation des secrets (procédure)
1. Générer un nouveau `SESSION_SECRET` : `openssl rand -hex 32`.
2. Dashboard Scaleway → container `tanguy` → Environment variables → mettre à jour.
3. Re-déployer via workflow manual dispatch. Les sessions actives sont invalidées (déconnecte les users — normal après rotation).
4. Pour Airtable/Anthropic : créer nouveau token, update env Scaleway, re-deploy, puis révoquer l'ancien.

### Actions en cas de compromission
- Secret leak dans un commit → purge historique (`git filter-repo`), rotate **tous** les tokens affectés.
- Tentatives bruteforce (voir logs `[auth] login FAIL`) → vérifier IP, bloquer via WAF / règle Scaleway.
- Compromission d'un compte utilisateur → retirer le user de `USERS_HASHES`, re-deploy.

## Bonnes pratiques de dev
- Jamais `git add -A` (risque d'inclure `.env` ou fichiers temporaires).
- Jamais commiter `.env` (gitignored + dockerignored de toute façon).
- Jamais hardcoder de credentials dans le code.
- PR review obligatoire avant merge sur `main` (convention repo).
- Syntax check systématique avant push : `node --check server.js`.
