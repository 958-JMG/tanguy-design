# CLAUDE.md — Tanguy Design Cockpit

## Contexte
Agence cuisine sur-mesure à Vannes. 4 collaborateurs.
Process : Découverte → Dessin Winner/Métron → Devis → Signature → Commandes fournisseurs → Coordination artisans → Pose → SAV.

## Stack
- Node.js 18+ / Express 4.19
- Auth : express-session + bcrypt (4 users via `USERS_HASHES`)
- Données : Airtable (base ID dans `AIRTABLE_BASE_ID`)
- Déploiement : Scaleway Serverless Containers (namespace `cockpits`, container `tanguy`), workflow GitHub Actions `deploy-scaleway.yml` en `workflow_dispatch` manuel depuis `main`
- Frontend : HTML vanilla, CSS inline, mobile first

## Règles non-négociables
- ❌ Jamais commit `.env`
- ❌ Jamais hardcoder credentials
- ❌ Jamais `git add -A`
- ✅ `.gitignore` existe et liste `.env`, `node_modules`, `.DS_Store`
- ✅ `SESSION_SECRET` 64 chars (openssl rand -hex 32)
- ✅ bcrypt rounds = 10
- ✅ Demander validation JMG avant action irréversible

## Tables Airtable
Clients · Projets · Artisans (5% rétro-commission contractuels) · Fournisseurs · Commandes · Tâches · SAV · Devis (+ Zones / Lignes / Échéances) · Devis Artisans · Réunions Plaud · Stock · Fiches découverte.

## Architecture cible — "tout part du projet" (refonte 2026-04-28)
Centre de gravité = la **fiche projet**. Tout consommé/produit depuis là.

**Champs attachments table Projets** (rename 2026-04-28, fieldIds stables) :
- `Plan 3D` (ex "Plans devis") — visualisations 3D Winner/Métron, dossiers de présentation
- `Plan technique` (ex "Plans techniques") — plans archi, plans techniques, prises de cotes
- `Images` (nouveau) — photos chantier, références ambiance, moodboards
- `Documents projet` — factures, AR, attestations, BC, notices, comptes rendus
- `Journal chantier` (multilineText) — entrées datées chronologiques

**Devis Tanguy** : nouveau champ `Type devis` (singleSelect Principal | Additif). Un projet peut avoir 1 devis Principal + N devis Additifs (augmentations de scope). Endpoint `/api/devis/import` accepte `type=Additif` (skip création client/projet auto, exige projetId).

**Réunions Plaud** : nouveau champ `Niveau` (singleSelect R1 | R2).
- R1 = découverte / avant chantier (découverte client, présentation devis)
- R2 = chantier / après pose (suivi chantier, SAV)
Le tab Plaud autonome a été retiré. R1/R2 se créent depuis la fiche projet. `/api/plaud/parse` accepte `niveau` (auto-déduit du type_reunion sinon).

**Fiche projet imprimable** : 2 modes
- 📋 **Fiche Tanguy** (interne) : budget, marge, devis, commandes, tâches, journal
- 🛠️ **Fiche Artisan** (transmise aux artisans) : SANS budget/marge/devis/commandes, AVEC plan technique embed

**Migration Airtable** : `node scripts/setup-projet-fields-v2.js --apply` (idempotent : rename + create + backfill).

## Spécificités métier
- Import bon de commande Winner/Métron (PDF) → parse Claude → création Devis + Zones + Lignes + Échéances
- Distinction artisan contractuel / non contractuel
- Calcul marge temps réel (fournisseurs + 5% artisans)
- Plateforme fournisseurs : Fundis (et autres)
- Intégration PLAUD pour réunions chantier (R1 découverte / R2 chantier)
