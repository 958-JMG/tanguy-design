# 04 — Architecture cible v3 (client-centric)

C'est le cœur du livrable. Toutes les décisions ici alimentent le plan d'implémentation (`05-plan-implementation.md`).

---

## 1. Principe directeur

> **Le client est l'unité de gravité. Tout part du client.**

Conséquences :
- L'écran le plus consulté après login = la **liste des clients** (et non plus la liste des projets).
- Pour créer un projet, on passe **toujours** par un client (existant ou créé à la volée).
- Un architecte = un client qui rattache d'autres clients (relation `Architecte → Clients finaux`).
- Le pipeline commercial est un **agrégat de projets** filtré par phase, pas un objet à part entière.

---

## 2. Navigation principale (refonte)

### v2 (existant) — 10 tabs
```
Dashboard · Clients · Projets · Commandes · Tâches · SAV · Artisans · Fournisseurs · Devis · Calendar  [+ Admin]
```

### v3 (cible) — 5 entrées + sous-menu Admin
```
🏠 Dashboard · 👤 Clients · 📊 Pipeline · 📅 Calendar · ⚙️ Admin
                                                       (Marges · Stock · Artisans · Fournisseurs · Coûts)
```

Les tabs Commandes / Tâches / SAV / Devis disparaissent de la nav principale — ces objets sont **toujours consultés depuis un projet** (et un projet toujours depuis un client). Cela rend la navigation plus prévisible.

Pour les recherches transverses (ex : "toutes les commandes en retard"), un menu **🔍 Recherche globale** accessible via raccourci `Cmd+K` ouvre une palette unifiée — pattern moderne, économe en espace nav.

### Mobile (≤ 760 px)
Bottom bar avec 5 icônes (🏠 👤 📊 📅 ⚙️). Le `Cmd+K` devient un bouton "Recherche" dans la top bar.

---

## 3. Modèle de données cible

### Évolutions table `Clients`

| Champ | Existant | Cible | Rôle |
|-------|----------|-------|------|
| `Nom` | ✅ | inchangé | |
| `Type` | ✅ (Particulier / Professionnel) | + ajouter `Architecte` | Distingue les 3 typologies |
| `Architecte référent` | ❌ | **nouveau** (linked Clients, multi) | Pour un client Particulier rattaché à un architecte |
| `Clients liés` | ❌ | **nouveau** (linked Clients inverse) | Pour un client Architecte : lookup auto des clients qui le réfèrent |
| `Date création` | ❌ | **nouveau** (date) | Pour calculer le ratio conversion temporel |
| `Source` | ✅ | inchangé | |
| `Notes` | ✅ | inchangé | |

### Évolutions table `Projets`

| Champ | Existant | Cible | Rôle |
|-------|----------|-------|------|
| `Référence` | ✅ | inchangé | |
| `Client` | ✅ (linked) | inchangé | |
| `Statut` | ✅ (12 valeurs mélangées) | **split en 2** ↓ | |
| `Phase commerciale` | ❌ | **nouveau** (singleSelect : Découverte / Dessin / Présentation devis / En attente décision / Signé) | Pipeline commercial avant signature |
| `Statut chantier` | ❌ | **nouveau** (singleSelect : Pré-pose / Pose en cours / Terminé / SAV / Archivé) | Après signature |
| `Date pose début` | ✅ (`Date pose prévue`) | renommé | |
| `Date pose fin` | ❌ | **nouveau** (date) | Pour drag-drop période sur calendar |
| `Budget HT`, `Marge prévi`, `Description` | ✅ | inchangés | |
| `Journal chantier` | ✅ | inchangé | |
| 4 attachments | ✅ | inchangés | |

**Migration douce** : un script idempotent (cf. `setup-projet-fields-v2.js` qui existe) backfille `Phase commerciale` depuis `Statut` actuel (mapping Découverte/Dessin/etc. → Statut historique). Le champ `Statut` legacy est conservé en lecture seule pendant 1 sprint puis supprimé.

### Évolutions table `Commandes`

| Champ | Existant | Cible | Rôle |
|-------|----------|-------|------|
| `BC parent` | ❌ | **nouveau** (linked Commandes, self) | Pour avenants : référence vers BC d'origine |
| `Type BC` | ❌ | **nouveau** (singleSelect : Initial / Avenant) | |
| `Montant net` | calculé front | **formule Airtable** | `Montant brut − somme(avenants enfants payés)` |
| `Lignes BC` | ❌ (texte libre `Notes`) | **nouveau** (linked Lignes commande, multi) | Lien vers Lignes devis du devis source |

**Nouvelle table** : `Lignes commande` (ou réutiliser `Lignes devis` selon parsing). Champs : `Commande`, `Position`, `Code`, `Description`, `SENS`, `Cote visible`, `Quantité`. Sert au rendu BC tableau sans montants.

### Évolutions table `Tâches`

| Champ | Existant | Cible | Rôle |
|-------|----------|-------|------|
| `Titre` | ✅ | inchangé | |
| `Client référent` | ❌ | **nouveau** (linked Clients) | Pour préfixe auto `[Junker] / Envoyer devis` |
| `Étape pipeline` | ❌ | **nouveau** (singleSelect : Découverte / Dessin / …) | Pour templates de tâches par étape |
| `Template d'origine` | ❌ | **nouveau** (linked Templates Tâches) | Pour identifier les tâches générées auto |
| `Date+Heure` (échéance) | ✅ partiel | **fix formatage** | Bug actuel à corriger |

**Nouvelle table** : `Templates Tâches`. Champs : `Nom`, `Étape pipeline`, `Titre par défaut`, `Assignée par défaut`, `Priorité`, `Description`. Permet à JMG / Tanguy de gérer les templates depuis l'admin.

---

## 4. Arbo des écrans cible

```
/                            → Dashboard (KPI + alertes + funnel cliquable)
/clients                     → Liste clients (filtrable type Pro/Particulier/Architecte)
/clients/:id                 → Fiche client (NOUVEAU)
/clients/:id/nouveau-projet  → Modale nouveau projet (préfille clientId)
/projets/:id                 → Fiche projet (refonte : zones progressives)
/pipeline                    → Tableau pipeline + taux conversion (NOUVEAU)
/pipeline/:phase             → Liste projets filtrés par phase (Découverte / Dessin / …)
/calendar                    → Calendar interactif drag-drop (REFONTE)
/admin                       → Menu admin (sous-écrans : marges, stock, artisans, fournisseurs, templates tâches, couts)
/admin/templates-taches      → CRUD templates de tâches (NOUVEAU)
/recherche                   → Cmd+K palette unifiée (NOUVEAU)
```

---

## 5. Wireframes ASCII des écrans clés

### 5.1 Dashboard refondu

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TANGUY DESIGN — Cockpit                  👤 Virginie   🔍 Cmd+K   ⚙️   │
├─────────────────────────────────────────────────────────────────────────┤
│ 🏠 Dashboard  👤 Clients  📊 Pipeline  📅 Calendar  ⚙️ Admin           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │ 32       │ │ 18       │ │ 248 k€   │ │ 22 %     │                  │
│  │ Clients  │ │ Projets  │ │ CA prévi │ │ Marge    │                  │
│  │ actifs   │ │ en cours │ │ 2026     │ │ moyenne  │                  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                  │
│                                                                         │
│  📊 PIPELINE COMMERCIAL                              [Voir détail →]  │
│  ┌──────────┬──────────┬──────────────┬──────────────┬────────────┐  │
│  │ 👋 Découv.│ 📐 Dessin │ 📄 Présentat.│ ⏳ En attente │ ✅ Signés  │  │
│  │   12      │    6      │      4       │      3        │    8       │  │
│  │   0%      │   25%     │     50%      │     75%       │   100%     │  │
│  └──────────┴──────────┴──────────────┴──────────────┴────────────┘  │
│   ↑ cliquable : filtre liste projets par phase                         │
│                                                                         │
│  ⚠️ ALERTES (5)                                                        │
│  ▸ 🔴 Projet Morales — pose dans 8 j, commandes non lancées            │
│  ▸ 🟠 Tâche Virginie : facture acompte Junker (retard 3 j)             │
│  ▸ 🟠 Devis Dubois en attente décision depuis 21 j                     │
│                                                                         │
│  📅 PROCHAINS JALONS (semaine)                                         │
│  ▸ Mer 22/05  R1 découverte avec Mme Lopez                             │
│  ▸ Jeu 23/05  Pose chantier Junker — début (5 j)                       │
│  ▸ Ven 24/05  RDV présentation devis Mme Dubois                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Liste Clients

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Clients (38)                                  [+ Nouveau client]        │
│ 🔍 Rechercher…              [Particulier] [Pro] [Architecte] [Archivés]│
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 👤 Junker, M. & Mme           ⚪ Particulier   📞 06...         │    │
│ │ 3 projets • 1 en cours • 18.4 k€ CA                              │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 🏛️ Cabinet Dupont           🟣 Architecte   📞 02...           │    │
│ │ 5 clients rattachés • 7 projets total                            │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 👤 Lopez, Mme                ⚪ Particulier (📐 via Dupont)    │    │
│ │ 1 projet • Découverte                                             │    │
│ └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Fiche client (NOUVEAU)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Clients > Junker, M. & Mme                              [⚙️ Éditer]    │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐  ┌────────────────────────────────────┐    │
│ │ Type     Particulier    │  │ Contact                            │    │
│ │ Source   Bouche-à-or.   │  │ 📞 06 12 34 56 78                 │    │
│ │ Architecte (none)       │  │ ✉️ junker@email.fr                │    │
│ │ Créé le  03/02/2025     │  │ 📍 12 rue de Vannes, 56000        │    │
│ └─────────────────────────┘  └────────────────────────────────────┘    │
│                                                                         │
│ 📋 PROJETS (3)                                      [+ Nouveau projet] │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 📂 Cuisine principale                       🔨 Pose en cours    │    │
│ │ Réf: TD-2024-018 • Pose: 28/05 → 02/06 • CA: 18 k€ • Marge 24% │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 📂 Avenant accessoires                      📐 Dessin           │    │
│ │ Réf: TD-2024-018-A • Pose à planifier • CA estimé: 2.4 k€       │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 📂 Salle de bain (2027)                     🗃️ Archivé          │    │
│ │ Réf: TD-2026-007 • Projet futur, non démarré                     │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│ 🗒️ NOTES CLIENT                                                       │
│ Client très exigeant sur la finition. Préfère contact mail. Femme      │
│ pilote les décisions. Aime les détails techniques.                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Modale "Nouveau projet" refondue

```
┌─────────────── Nouveau projet ───────────────────────┐
│                                                      │
│ Client *                                             │
│ ┌────────────────────────────────────┐ [+ Nouveau]  │
│ │ 🔍 Rechercher un client…           │              │
│ └────────────────────────────────────┘              │
│ Suggestions :                                        │
│   👤 Junker, M. & Mme                                │
│   👤 Junot, P.                                       │
│   🏛️ Cabinet Dupont                                 │
│                                                      │
│ ─────────────────────────────────────────────────── │
│                                                      │
│ Référence projet *      [TD-2026-XXX (auto)        ] │
│ Phase commerciale       [👋 Découverte         ▼   ] │
│ Budget HT estimé        [           €              ] │
│ Marge prévi             [    %                     ] │
│ Date pose souhaitée     [    /  /                  ] │
│ Description courte                                   │
│ ┌────────────────────────────────────────────────┐  │
│ │                                                │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ☑ Coller transcription Plaud R1 (optionnel)         │
│ ┌────────────────────────────────────────────────┐  │
│ │ Coller ici la transcription Plaud du RDV…     │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│                       [ Annuler ]  [ Créer projet ] │
└──────────────────────────────────────────────────────┘
```

### 5.5 Vue Pipeline (NOUVEAU)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 Pipeline commercial                    [Mois : Mai 2026 ▼] [Export] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ TAUX DE CONVERSION (12 derniers mois)                                  │
│                                                                         │
│  Découverte ──62%──> Dessin ──85%──> Présentation ──71%──> Signé      │
│    (24)              (15)              (13)                 (9)         │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ Phase      │ Nb │ CA estim. │ Âge moy. │ Conv. attendue        │    │
│ ├─────────────────────────────────────────────────────────────────┤    │
│ │ Découverte │ 12 │  62 k€    │ 8 j      │ ≈ 4.6 vers Dessin    │    │
│ │ Dessin     │  6 │  78 k€    │ 14 j     │ ≈ 5.1 vers Présent.  │    │
│ │ Présentat. │  4 │ 110 k€    │ 21 j     │ ≈ 2.8 vers Signé     │    │
│ │ En attente │  3 │  85 k€    │ 35 j 🔴  │ 2 risque perdu       │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│   ↑ clic ligne → liste projets de la phase                             │
│                                                                         │
│ ALERTES PIPELINE                                                        │
│ 🔴 3 projets bloqués > 30 j en "En attente décision"                   │
│ 🟠 2 projets en Découverte sans R1 Plaud                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.6 Calendar refondu (drag-and-drop)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📅 Calendar       [Mois ▼] [Mai 2026]   ◀ ▶                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Lun       Mar       Mer       Jeu       Ven       Sam       Dim       │
│ ───────────────────────────────────────────────────────────────────    │
│  19        20        21        22        23        24        25        │
│            R1        R2        BC        R1        Pose                │
│            Lopez               Junker    Dubois    Junker ─►           │
│                                                                         │
│  26        27        28        29        30        31        01        │
│  ◄─ Pose Junker (drag pour étendre)            (clic = ouvre projet)   │
│                                                                         │
│ LÉGENDE     🟦 R1   🟨 R2   🟪 BC à passer   🟩 Pose   🟧 Échéance     │
│                                                                         │
│ FILTRE      [☑ Réunions] [☑ Pose] [☑ Tâches] [☑ Échéances]            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.7 Fiche projet refondue (vue progressive)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Clients > Junker > Projet TD-2024-018 — Cuisine principale  [⚙️ Éditer] │
├─────────────────────────────────────────────────────────────────────────┤
│ STEPPER  👋──📐──📄──✍️──💶──📐──📦──🚚──🔨──📋──🧾──⭐               │
│           ✓   ✓   ✓   ✓   ✓   ✓   ✓   ●   ▣   ◯   ◯   ◯  (Pose en cours)│
│                                                                         │
│ ┌────────────────────────────────┐  ┌────────────────────────────────┐ │
│ │ Phase commerciale  ✅ Signé    │  │ Bilan financier  réalisé      │ │
│ │ Statut chantier    🔨 Pose     │  │ CA: 18 200 €                  │ │
│ │ Pose: 28/05 → 02/06            │  │ Coût total: 13 940 €           │ │
│ │ Client: Junker                 │  │ Marge: 4 260 € (23.4 %)       │ │
│ └────────────────────────────────┘  └────────────────────────────────┘ │
│                                                                         │
│ ZONES (repliées si étape non atteinte)                                  │
│ ▼ ✅ Devis Tanguy        Principal 18.2 k€ + Additif 2.4 k€            │
│ ▼ ✅ Facturation         Acompte ✓ • Réception ⏳ • Solde ◯           │
│ ▼ ✅ Commandes (12)      Cuisine, Plan travail, Électroménager...     │
│ ▼ ✅ Devis artisans (3)  Plomberie 2.2 k€ + Électricité 1.8 k€…       │
│ ▼ 🔵 Tâches (4 ouvertes) [+ Générer tâches type Pose]                  │
│ ▶ ✅ R1 Découverte                                                     │
│ ▶ ⏳ R2 Chantier                                                       │
│ ▶ 📓 Journal chantier (12 entrées)                                    │
│ ▶ 📎 Documents (Plan 3D 4 • Plan tech 2 • Images 18 • Docs 7)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.8 BC en tableau (envoi fournisseur)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Bon de commande #BC-2026-042                                            │
│ Projet Junker — Cuisine principale                                      │
│ Fournisseur : Schmidt — schmidt-vannes@fournisseur.fr                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Pos │ Code         │ Description                  │ SENS │ Cote │ Qté  │
│─────┼──────────────┼──────────────────────────────┼──────┼──────┼─────│
│  1  │ ABS-6090     │ Caisson bas 600×900          │   D  │ 600  │  2  │
│  2  │ ABS-4090     │ Caisson bas 400×900          │   G  │ 400  │  1  │
│  3  │ TIR-DAMP-450 │ Tiroir damper 450 mm         │   —  │  —   │  4  │
│  …  │ …            │ …                            │  …   │  …   │  …  │
├─────────────────────────────────────────────────────────────────────────┤
│ Livraison souhaitée : 12/06/2026                                        │
│ Adresse de livraison : Atelier Tanguy, 12 ZA Vannes-Est                 │
└─────────────────────────────────────────────────────────────────────────┘
(envoyé en HTML dans le mail, pas de montants visibles)
```

---

## 6. Logique de calendrier auto (rétro-planning)

À chaque création ou modification de `Date pose début` sur un projet, le serveur déclenche :

```
Date pose début = D

→ Créer ou MAJ tâche "📦 Lancer les commandes fournisseurs"
   - Assignée à : Virginie
   - Échéance : D − 3,5 mois (≈ 105 j)
   - Étape pipeline : Commandes
   - Si elle existe déjà : MAJ échéance

→ Créer ou MAJ tâche "📞 Rappel : planifier chantier avec artisans"
   - Assignée à : Sébastien (pose)
   - Échéance : D − 1,5 mois (≈ 45 j)
   - Étape pipeline : Pose

→ Notifier (toast UI) : "Rétro-planning recalculé : commandes au {D-105j}, planif chantier au {D-45j}"
```

À la signature d'un devis (`/api/devis/:id/sign`) → en plus de l'auto-création BC + tâche acompte déjà existante :

```
→ Créer tâche "📨 Envoyer infos artisans (devis OK + facturation possible)"
   - Assignée à : Virginie
   - Échéance : J+2 (2 jours après signature)

→ Créer tâche "📞 Relance artisans pour planification (à J+60)"
   - Assignée à : Sébastien
   - Échéance : J+60
```

---

## 7. Plaud R1 enrichi (prochaines actions auto)

Refonte du prompt Claude appelé par `/api/plaud/parse` :

**Sortie actuelle** : Synthèse / Contexte / Attentes / Points de douleur / Tâches identifiées.

**Sortie cible** : ajouter une section **Prochaines actions** avec champs structurés :

```json
{
  "synthese": "...",
  "contexte": "...",
  "attentes": "...",
  "points_douleur": "...",
  "taches_identifiees": [...],
  "prochaines_actions": [
    {
      "type": "rdv_presentation_devis",
      "date_souhaitee": "2026-06-12",
      "notes": "Présenter à la femme principalement"
    },
    {
      "type": "envoi_dossier_pdf",
      "date_souhaitee": "2026-06-05"
    }
  ]
}
```

Chaque `prochaines_actions[]` génère une tâche en base avec :
- `Titre` = `[Junker] / RDV présentation devis`
- `Échéance` = `date_souhaitee`
- `Description` = `notes` + lien projet
- `Assignée à` = `Solène` (dessin) ou `Virginie` (commercial) selon `type`

---

## 8. Templates de tâches par étape (admin)

Table `Templates Tâches` administrable depuis `/admin/templates-taches`. Lors d'une bascule de `Phase commerciale` (ex : Découverte → Dessin), bouton **[+ Générer tâches type]** sur la fiche projet propose les templates de l'étape Dessin :

```
┌── Générer tâches type pour la phase "Dessin" ──┐
│                                                │
│ ☑ Dessiner le projet sur Winner               │
│ ☑ Créer le dossier de présentation client     │
│ ☑ Estimatif chiffré sommaire                  │
│ ☐ Visualisation 3D haute qualité              │
│ ☐ Validation cohérence technique              │
│                                                │
│         [ Annuler ]  [ Créer 3 tâches ]       │
└────────────────────────────────────────────────┘
```

Chaque tâche cochée est créée avec : `Titre` (du template) / `Assignée à` (du template) / `Étape pipeline` (Dessin) / `Échéance` = J+template_offset_jours.

---

## 9. Architecte (recommandation finale)

**Choix retenu** : type de Client + relation self-référence (pas de nouvelle table dédiée).

Modèle :
```
Client (type = Architecte)
├── Cabinet Dupont
│   └── Clients liés (champ self) :
│       ├── Lopez, Mme (type = Particulier, Architecte référent = Cabinet Dupont)
│       └── Martin, M. (type = Particulier, Architecte référent = Cabinet Dupont)
```

UI :
- **Fiche client Architecte** : section "Clients rattachés" avec liste + total CA + Nombre projets agrégés
- **Fiche client Particulier** : badge "📐 via Cabinet Dupont" si Architecte référent renseigné
- **Liste clients** : filtre par type (☑ Particulier / ☑ Pro / ☑ Architecte)

Avantage : pas de migration lourde, schéma simple, recherches transparentes.

---

## 10. Cmd+K recherche globale (nice to have)

Palette unifiée accessible partout. Recherche dans :
- Clients (nom, contact)
- Projets (référence, description)
- Tâches (titre, assignée)
- Commandes (numéro, fournisseur)

Pattern courant (cf. Linear, Notion, Raycast). Implémentation : modal HTML/Alpine + endpoint `/api/search?q=…` qui fan-out sur les 4 tables Airtable avec match flou côté serveur.

---

## 11. Compatibilité v2 → v3 (transition douce)

Pour éviter le big bang :

1. **Démo `/v3/` isolée** (pattern cockpit-ui-v3 9·58) : tout le nouveau front sous `/v3/`, alimenté par les mêmes endpoints API, mock data pour validation visuelle.
2. **API étendue, jamais cassée** : les nouveaux champs (`Phase commerciale`, `Date pose fin`, etc.) sont ajoutés en parallèle, l'ancien `Statut` reste accessible en lecture.
3. **Backfill scripté** (idempotent) avant cutover : `setup-projet-fields-v3.js --apply` mappe l'ancien `Statut` vers `Phase commerciale` + `Statut chantier`.
4. **Cutover atomique** : une PR finale qui bascule la racine `/` vers le nouveau front, supprime l'ancien.

---

## 12. Décisions à valider avec Tanguy avant code

Récap (déjà dans `00-README.md`) :

1. ✅ **Architecte** = type de Client + self-référence
2. ✅ **Avenant BC** = record Commande avec `BC parent` + `Type = Avenant`
3. ✅ **Pipeline** = `Phase commerciale` (5 étapes) DISTINCT de `Statut chantier` (5 valeurs)
4. ✅ **Cmd+K** recherche globale : utile ou over-engineering ?
5. ✅ **Drag-drop calendar** : FullCalendar.js (open source MIT) acceptable ?
6. ✅ **Templates tâches** : admin par JMG, ou par Virginie ?

Une fois ces 6 points tranchés, le plan d'implémentation peut démarrer (cf. `05-plan-implementation.md`).
