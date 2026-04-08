# CLAUDE.md — Tanguy Design Cockpit

## Contexte
Agence cuisine sur-mesure à Vannes. 4 collaborateurs.
Process : Découverte → Dessin Winner/Métron → Devis → Signature → Commandes fournisseurs → Coordination artisans → Pose → SAV.

## Stack
- Node.js 18+ / Express 4.19
- Auth : express-session + bcrypt (4 users via `USERS_HASHES`)
- Données : Airtable (base ID dans `AIRTABLE_BASE_ID`)
- Déploiement : Railway
- Frontend : HTML vanilla, CSS inline, mobile first

## Règles non-négociables
- ❌ Jamais commit `.env`
- ❌ Jamais hardcoder credentials
- ❌ Jamais `git add -A`
- ✅ `.gitignore` existe et liste `.env`, `node_modules`, `.DS_Store`
- ✅ `SESSION_SECRET` 64 chars (openssl rand -hex 32)
- ✅ bcrypt rounds = 10
- ✅ Demander validation JMG avant action irréversible

## Tables Airtable (à créer ou créées)
Clients, Projets, Artisans (5% rétro-commission contractuels), Fournisseurs, Commandes, Tâches, SAV.

## Spécificités métier
- Import bon de commande Winner/Métron (PDF)
- Distinction artisan contractuel / non contractuel
- Calcul marge temps réel (fournisseurs + 5% artisans)
- Plateforme fournisseurs : Fundis (et autres)
- Intégration PLAUD pour réunions chantier
