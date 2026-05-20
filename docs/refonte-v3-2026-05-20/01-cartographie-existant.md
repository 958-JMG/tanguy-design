# 01 — Cartographie de l'existant (v2 — avril 2026)

## Architecture technique

- **Stack** : Node 18+ / Express 4.19 / Airtable / session bcrypt + cookie / Scaleway Serverless Containers (fr-par)
- **Code** : 1 `server.js` (1142 l.) + 1 `public/index.html` monolithique (289 KB, HTML+CSS+JS vanilla + Alpine.js)
- **Auth** : 4 users (Virginie / Solène / Sébastien / Marine), bcrypt rounds=10, sessions cookie signées
- **Admin** : `ADMIN_LOGINS` env (Virginie par défaut) → accès menu Marges + Stock
- **Sécurité** : Helmet + rate-limit (300 req/min, 10 login/15 min), HSTS prod, SESSION_SECRET 64 chars
- **Déploiement** : workflow `deploy-scaleway.yml` manual dispatch depuis `main`

## Modèle Airtable (15 tables)

| Table | Rôle | Champs notables |
|-------|------|-----------------|
| `Clients` | Annuaire clients | Nom, Type, Source, Email, Téléphone, Adresse |
| `Projets` | Cœur métier | Référence, Statut, Budget HT, Marge prévi, Date découverte, Date pose, Description, Journal chantier (long text), 4 attachments (Plan 3D / Plan technique / Images / Documents projet) |
| `Artisans` | Annuaire pose | Contractuel oui/non (5 % rétro-commission si oui) |
| `Fournisseurs` | Annuaire achats | Famille (Cuisine / Électroménager / Plan de travail / …) |
| `Commandes` | Bons de commande | Numéro, projetId, fournisseurId, Notes (texte libre) |
| `Tâches` | Actions à faire | Titre, Assignée à (Virginie/Solène/Sébastien/Marine), Priorité, Statut, Échéance, Description |
| `SAV` | Service après-vente | (peu utilisé) |
| `Devis` | Devis Tanguy | + `Type devis` (Principal / Additif) ajouté avril 2026 |
| `Zones devis` / `Lignes devis` / `Échéances devis` | Détail devis parsé du PDF Winner | |
| `Devis Artisans` | Devis sous-traitants | + rétro-commission 5 % auto si artisan contractuel |
| `Réunions Plaud` | Transcriptions chantier | + `Niveau` (R1 / R2) ajouté avril 2026 |
| `Stock` | Inventaire | (peu utilisé) |
| `Fiches découverte` | Brief initial client | (peu utilisé, supplanté par R1 Plaud) |

## Vues frontales (index.html)

### Navigation (lignes 668-750)
Tabs horizontales en haut : **Dashboard · Clients · Projets · Commandes · Tâches · SAV · Artisans · Fournisseurs · Devis · Calendar** (+ Admin si user dans ADMIN_LOGINS).

Le tab autonome "Plaud" et "Fiches découverte" ont été retirés (avril 2026, intégrés à la fiche projet via R1/R2).

### Dashboard (lignes 755-850 / renderDashboard 1328-1472)
- **KPI counters** : clients actifs · projets en cours · CA prévu · marge
- **Pipeline funnel** : 4 étapes visuelles (Découverte → Dessin → Présentation → En attente)
- **Calendar overlay** : événements (projets, réunions Plaud)
- **Alert bar** : projets retardataires, tâches urgentes

### Vue Clients (lignes 1651-1903)
- Liste avec recherche par nom/contact
- Card layout simple : Nom, Type (Particulier/Professionnel), Source, Email, Téléphone
- Modal CRUD via `openModal()`
- **❌ Pas de fiche client détaillée** affichant les projets liés. Le clic sur un client n'amène pas à une "page client" — on reste dans la modale.

### Vue Projets — Fiche projet (lignes 2368-2526)
**11 zones** affichées dans cet ordre :

1. **Stepper parcours 12 étapes** (Découverte → SAV) — calcul 100 % front avec badges done/cur/partial/pending
2. **Bilan financier** (CA, fournisseurs, artisans − rétro 5 %, marge € + %)
3. **Infos projet** (Référence / Statut / Budget / Marge / Dates / Description)
4. **Devis Tanguy** (lignes avec badges Type Principal/Additif et Statut)
5. **Facturation** (Acompte 30 % / Réception 40 % / Solde 30 %) → crée tâches `[FACTURATION]` Virginie
6. **Commandes fournisseurs** par Type (Cuisine / Électroménager / Plan de travail / Sanitaire / Plan technique / Accessoires / Autre)
7. **Devis artisans** (avec rétro 5 % auto)
8. **Tâches liées** (création/édition modal, assignation, suppression inline)
9. **Réunions Plaud** R1 (Découverte) et R2 (Chantier) — transcription collée → parsée par Claude (Synthèse / Contexte / Attentes / Points douleur / Tâches identifiées)
10. **Journal chantier** (entrées datées libres, plus récent en haut, éditable/supprimable)
11. **Attachments 4 onglets** : Plan 3D / Plan technique / Images / Documents projet

### Modale Nouveau projet (lignes 4568-4670)
**Champs** : Référence (req) / Statut / Budget HT / Marge prévi / Date découverte / Date pose / Description.

**Raccourci "Importer PDF Winner"** : redirect vers tab Devis pour upload PDF.

**Enrichissement Plaud** : checkbox optionnelle → si activé, Type réunion + Transcription textarea → appel `/api/plaud/parse` après création projet.

**❌ Pas de champ "rattacher à client existant"**. Le client est créé automatiquement par l'import PDF Winner ou manuellement séparément.

### Vue Calendar
Calendrier mensuel avec événements projet (date découverte / pose / réunions). Lecture seule.

### Vue Admin (lignes 886-888, accès `ADMIN_LOGINS`)
- Onglet **Marges** : tableau marges par projet avec code couleur
- Onglet **Stock** : tableau inventaire

## Endpoints API (server.js)

| Endpoint | Méthode | Rôle |
|----------|---------|------|
| `/api/login` `/api/logout` `/api/me` | POST / POST / GET | Auth |
| `/api/data/:table` | GET | Liste records d'une table |
| `/api/data/:table` | POST | Création |
| `/api/data/:table/:id` | PATCH | Update |
| `/api/data/:table/:id` | DELETE | Suppression |
| `/api/devis/import` | POST | Upload PDF Winner → parsing Claude → création Devis + Zones + Lignes + Échéances (+ Client + Projet si Principal) |
| `/api/devis/:id/sign` | POST | Signature devis → auto-création Commandes + Tâches `[FACTURATION]` Virginie |
| `/api/artisan-devis/import` | POST | Upload PDF devis artisan → parse → création Devis Artisan + rétro 5 % si contractuel |
| `/api/plaud/parse` | POST | Coller transcription → parsing Claude → création Réunion Plaud avec niveau R1/R2 |
| `/api/projets/:id/journal` | POST / PATCH / DELETE | Entrées datées journal chantier |
| `/api/projets/:id/attachments` | POST | Upload multipart vers les 4 champs attachments |

## Ce qui fonctionne bien (à conserver)

- **Stepper 12 étapes** : très bon, lisible, calcul front sans round-trip serveur
- **Bilan financier auto** : marge calculée live à partir des commandes + devis artisans − 5 % rétro
- **R1/R2 Plaud intégrés à la fiche projet** : excellent (refonte avril 2026 réussie)
- **Import PDF Winner Principal/Additif** : robuste, parse Claude fiable
- **Auto-création tâches Virginie** à la signature : économise du travail manuel
- **Sécurité** : Helmet + rate-limit + bcrypt + sessions signées = état de l'art

## Ce qui pose problème (à refondre)

Voir `02-matrice-ecart.md` pour le détail. Synthèse des 11 points :

1. **Pas de fiche client détaillée** — bloquant pour le pivot client-centric
2. **Pas de rattachement client dans modale nouveau projet** — créé des doublons
3. **Pas d'architecte / pro distinction** — empêche workflow B2B
4. **Pipeline funnel statique** — pas cliquable, pas de filtre, pas de taux conversion
5. **Pas de drag-and-drop pose** sur calendrier
6. **Pas d'automation rétro-planning** (J−3,5 mois commandes / J−1,5 mois rappel)
7. **BC en texte brut** dans champ Notes, pas un tableau formaté
8. **Pas d'avenants BC** (modif post-signature, déduction du payé)
9. **Plans de travail rangés en "Divers"** au lieu d'une famille fournisseur
10. **Affichage tâche date+heure** : bug visuel
11. **Pas d'actions pré-enregistrées par étape** (Plaud R1 → checklist "présenter devis", "envoyer dossier", etc.)

À cela s'ajoute des évolutions transverses :
- **2FA Authentificator** (sécurité)
- **Bouton support** intégré (signalement bug)
- **IA d'analyse cockpit** (suggestions auto) — futur
