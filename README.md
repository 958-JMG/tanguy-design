# Tanguy Design — Cockpit

Cockpit de gestion chantiers cuisines pour l'agence Tanguy Design (Vannes).
4 utilisateurs : Virginie (admin), Solène (design), Sébastien (pose), Marine (commercial).

## Stack
Node.js 18+ / Express 4.19 / Airtable / session cookie + bcrypt / **Scaleway Serverless Containers** (fr-par)

## Local
```bash
cp .env.example .env   # remplir SESSION_SECRET, AIRTABLE_*, USERS_HASHES, ADMIN_LOGINS
npm install
npm start
```

Health : `curl http://localhost:3000/api/health`

## Déploiement
Container Scaleway `tanguy` (namespace `cockpits`, image `rg.fr-par.scw.cloud/958-registry/tanguy`).
Domaines : `tanguy.958.fr`, `cockpit-tanguy.958.fr`.
Deploy : GitHub Actions workflow `.github/workflows/*.yml` (manual dispatch).

## Rôles
L'env `ADMIN_LOGINS` (CSV, lowercase, défaut `virginie`) définit qui voit le menu Admin (Marges + Stock).

## Scripts utilitaires
```bash
node scripts/hash-password.js MonMotDePasse         # génère un hash bcrypt
node scripts/setup-attachment-fields.js              # crée/vérifie les 3 champs attachments sur Projets
node scripts/import-dossiers-v2.js <dossier> [--execute]  # importe dossiers clients + uploads
```

## Tables Airtable
Clients · Projets · Artisans · Fournisseurs · Commandes · Tâches · SAV · Devis · Zones devis · Lignes devis · Échéances devis · Fiches découverte · Réunions Plaud · Stock · Devis Artisans

## Zones attachments sur Projets (2026-04-24)
- `Plans devis` — dossiers de présentation, visualisations
- `Plans techniques` — plans archi, autocad, prise de cotes
- `Documents projet` — BC, AR, cahier des charges, notices, etc.
Limite Airtable : 5 MB par fichier via l'API.
