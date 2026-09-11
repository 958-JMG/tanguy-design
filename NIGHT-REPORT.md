# 🌙 NIGHT-REPORT — Tanguy Design — nuit du 2026-06-09

**Mode : BUILD ONLY.** 0 merge, 0 deploy, 0 mutation Airtable. Prod inchangée (toujours sur `e75f462`).
Toutes les branches partent de `main = e75f462`. Au matin : Mac-Claude relit chaque PR → merge (= deploy) **sur go JMG**, après avoir lancé les scripts de schéma additifs listés plus bas.

## Pile de PRs ouvertes (6)

| PR | Branche | Sujet | Schéma additif | Tests |
|----|---------|-------|----------------|-------|
| **#49** | `feat/tanguy-planning-artisans` | Planning chantier envoyable aux artisans (mailto) | aucun | 67/67 |
| **#50** | `feat/tanguy-retro-apporteur` | Rétro apporteur d'affaires 3 % (Solène) | `setup-apporteur-field.js` | 75/75 (+8) |
| **#51** | `feat/tanguy-sav-local` | Onglet SAV local — tableau + CRUD | `setup-sav-fields.js` | 67/67 |
| **#52** | `feat/tanguy-agenda-v2` | Agenda v2 (couleurs, drag RDV, réception semaine, RDV libre) | `setup-agenda-v2-types.js` (si Type = singleSelect) | 67/67 |
| **#53** | `feat/tanguy-taches-vue-globale` | Tâches — vue globale admin + suppression ; multi-assign flaggé | `setup-taches-multiassign.js` (**seulement si go modèle**) | 67/67 |
| **#54** | `feat/tanguy-ca-marge-aligne` | CA dashboard aligné sur le pipeline (CA signé) | aucun | 67/67 |

---

## ⚠️ Scripts de schéma ADDITIFS à lancer AVANT de merger la PR concernée
Tous idempotents, additifs (aucun changement de type, aucune suppression). Lancer le script **puis** merger.
```
# PR #50  — champ Apporteur (singleSelect) sur Clients
node scripts/setup-apporteur-field.js --apply
# PR #51  — Statut + Type SAV (singleSelect) sur la table sav
node scripts/setup-sav-fields.js --apply
# PR #52  — options « Réception » et « Pose » sur rendez-vous.Type (no-op si Type est du texte)
node scripts/setup-agenda-v2-types.js --apply
# PR #53  — champ Assignées à (multipleSelects) — UNIQUEMENT si JMG valide le modèle multi-assign
node scripts/setup-taches-multiassign.js --apply
```

---

## Détail par PR

### #49 — Planning chantier → artisans (sous-agent)
- **Fait** : bouton « Planning » dans la section Artisans de la fiche projet → récap (réf, dates pose, adresse chantier du client, artisans+spécialité) → modale d'aperçu → **mailto** pré-rempli aux emails des artisans (pattern identique aux commandes fournisseurs). Artisans sans email listés « à contacter manuellement ». Journalisation best-effort.
- **Tests** : 67/67 · `node --check` OK. **Fichier** : `views/projet.js`.
- **Flags modèle/données** : aucun (100 % lecture seule + mailto, pas de champ, pas d'ACL).
- **Non-fait** : pas de PDF joint (récap dans le corps du mail), comme les commandes.

### #50 — Rétro apporteur 3 % (sous-agent)
- **Fait** : champ additif `Apporteur` sur Clients (script) ; select Apporteur dans les modales client (création + édition) ; endpoint `GET /api/retro-apporteurs` (requireAdmin) + helper pur testé ; section « Rétrocessions apporteurs » dans Gestion → Trésorerie (KPI + table). Code défensif (champ absent → rapport vide).
- **Tests** : 75/75 (8 nouveaux). **Fichiers** : `scripts/setup-apporteur-field.js`, `services/acl.js`, `services/retro-apporteurs-helper.js(+.test)`, `server.js`, `views/clients.js`, `views/gestion.js`.
- **Flags modèle/données** : (1) options du select `Apporteur` = Virginie/Solène/Sébastien/Marine/Externe — **à confirmer** ; (2) assiette = **CA HT (Σ Budget HT)** et **non la marge** — à confirmer ; (3) périmètre = projets **Signé** uniquement.
- **Non-fait** : rien d'identifié.

### #51 — SAV local (sous-agent)
- **Fait** : vue `views/sav.js` (tableau Date/Client/Ville/Type/Statut + CRUD modale), route `sav`, nav desktop+mobile (icône `wrench`), helpers api, `scripts/setup-sav-fields.js`.
- **Tests** : 67/67 · `node --check` + smoke OK. **Fichiers** : `views/sav.js`, `core/router.js`, `core/api.js`, `index.html`, `styles.css` (`.table-scroll`), `services/acl.js`, script.
- **🔴 DÉCOUVERTE IMPORTANTE (à valider)** : **la whitelist ACL `sav` était périmée** — elle listait `Titre, Description, Statut, Priorité, Date, Projet`, or **aucun de ces champs n'existe** sur la vraie table SAV (vérifié en lecture via l'API Airtable). Vrais champs : `Référence, Client, Date demande, Type (multilineText), Commandé, Date réception, Réalisé par, Date réalisation, Facturé`. La whitelist a été **recalée sur le réel**.
- **Flags modèle/données** : (1) `Type` existant est un `multilineText` → **non converti** (règle dure) ; un champ additif `Type SAV` (singleSelect) est créé à la place, la vue lit `Type SAV` puis repli `Type`. (2) `Statut` (singleSelect) ajouté en additif. (3) `Ville` **dérivée** du client lié (pas de champ ajouté). (4) Pas de lien `Projet` sur SAV (rattachement par Client). (5) Table SAV **vide** (0 record) → aucun risque de migration.
- **Non-fait** : lien Projet optionnel non ajouté (possible plus tard).

### #52 — Agenda v2 (moi)
- **Fait** : couleurs statiques par Type de RDV (`.rtype-*`) ; **drag-and-drop des RDV** (préserve l'heure) ; **Réception** affichée en **n° de semaine ISO** + couleur dédiée ; split **Réception/Pose** (ancien combiné conservé pour l'historique) ; **Journée entière** sans champ Airtable (heuristique minuit) ; sélecteur **client recherchable** (datalist) + **Objet optionnel** ; bouton **Nouveau RDV** (libre, hors projet) ; **pose « fantôme » Guerrier** gérable (clic pose → modale : ouvrir projet / retirer du calendrier en vidant les dates de pose, réversible).
- **Tests** : 67/67 · `node --check` OK. **Fichiers** : `views/calendar.js`, `core/rdv.js`, `styles.css`, `scripts/setup-agenda-v2-types.js`.
- **Flags modèle/données** : (1) split Réception/Pose = ajout d'**options** au singleSelect Type → **lancer le script avant merge** (sinon créer un RDV Réception/Pose échoue côté Airtable si Type est un singleSelect ; le script est no-op si Type est du texte) ; (2) journée entière = **heuristique minuit** (pas de champ) — un RDV pile à 00:00 s'afficherait « journée » (acceptable) ; (3) « retirer la pose » **vide les dates de pose du projet** (réversible).
- **Non-fait** : vue semaine/jour (refonte plus lourde, non demandée explicitement cette nuit) ; rappels/notifications de RDV.

### #53 — Tâches : vue globale + suppression ; multi-assign flaggé (moi)
- **Fait** : vue `views/taches.js` « Toutes les tâches » (admin), route + nav admin-only ; filtres assignée/statut/priorité ; libellé client·dossier ; gestion en ligne (changer assignée, changer statut, cocher terminée, **supprimer** y compris les tâches auto-générées). La suppression existait déjà sur la fiche projet.
- **Tests** : 67/67 · `node --check` OK. **Fichiers** : `views/taches.js`, `core/router.js`, `index.html`, `styles.css`, `services/acl.js`, `scripts/setup-taches-multiassign.js`.
- **Flags modèle/données** : (1) **multi-assign = décision modèle** → champ additif `Assignées à` (multipleSelects) **proposé** (script + whitelist) mais **NON câblé en écriture** (pour ne pas casser la création de tâche si le champ n'existe pas). À activer seulement sur go JMG ; (2) `Assignée à` (single) **non touché** (règle dure).
- **Non-fait** : (a) câblage UI du multi-assign (attend go modèle) ; (b) **lien RDV ↔ tâche** : nécessite un champ de lien additif entre `taches` et `rendez-vous` = décision de modèle → **flaggé, non implémenté** (arbitrage attendu : lien Airtable bidirectionnel vs simple « créer une tâche depuis un RDV »).

### #54 — CA dashboard aligné sur le pipeline (moi)
- **Investigation** : le « CA ~20k » du dashboard = `Σ Budget HT` de **tous** les projets (signés + prospects + **archivés**, `dashboard.js:90`), alors que le Pipeline ne somme que les **non signés non archivés** (`pipeline.js:77`). Périmètres différents → jamais cohérents. Le 20k est en réalité dominé par les **dossiers signés de Guerrier** (Cuisine ≈ 20k).
- **Fait** : le KPI devient **« CA signé (HT) »** = `Σ Budget HT` des projets en phase **Signé** (archivés exclus) = CA engagé, **complémentaire** du « CA pipeline brut » (non signés) ⇒ pas de double comptage. Marge moyenne aussi calculée hors archivés.
- **Tests** : 67/67 · `node --check` OK. **Fichier** : `views/dashboard.js` (affichage seul, réversible, aucune donnée touchée).
- **Flags modèle/données** : **choix sémantique** — dashboard = CA **signé** (et le complément reste sur Pipeline). Alternative possible : afficher le **total prévisionnel** (signés + pipeline, archivés exclus) = 1 ligne à changer. À trancher par JMG.
- **Non-fait** : rien d'autre (pipeline.js déjà correct).

---

## Conflits de merge attendus (triviaux, à résoudre au matin)
- **`core/router.js`** + **`index.html`** : #51 (SAV) et #53 (Tâches) ajoutent chacun une route + une entrée de nav au même endroit.
- **`services/acl.js`** : #50, #51, #53 ajoutent chacun des entrées de whitelist (et #51 recale `sav`).
- **`views/gestion.js`** : #50 (section rétro) — pas d'autre PR dessus.
- **`views/projet.js`** : #49 (section artisans) — régions distinctes des autres, peu de risque.
- **`styles.css`** : ajouts en fin de fichier / blocs distincts → fusion simple.

## Ordre de merge conseillé (chaque merge = 1 deploy ; JMG valide PR par PR)
1. **#54** (CA) et **#49** (Planning) — aucun schéma, risque le plus faible, bon premier deploy de contrôle.
2. **#52** (Agenda v2) — lancer `setup-agenda-v2-types.js` avant.
3. **#50** (Rétro) — lancer `setup-apporteur-field.js` avant.
4. **#51** (SAV) — lancer `setup-sav-fields.js` avant ; **valider d'abord la recalibration ACL `sav`**.
5. **#53** (Tâches) — la vue globale est mergeable seule ; le multi-assign reste OFF tant que JMG n'a pas validé le modèle.

## Rappels prod (au merge)
- Merge sur `main` = **deploy auto**. Après chaque deploy : vérifier le **SHA image** du container (règle 5) + smoke (santé + render authentifié, règle 13 — tester un vrai rendu connecté, pas juste le GET non-auth).
- Cache-buster (`?v=`) : la SPA v3 charge les modules ES **sans** query-string ; la règle `?v=` vise `public/v4/` (absent de ce repo) → rien à bumper.
