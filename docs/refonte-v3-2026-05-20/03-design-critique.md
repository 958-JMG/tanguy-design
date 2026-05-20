# 03 — Design critique de l'existant

Lecture critique structurée du cockpit v2 (avril 2026) pour identifier les sources de friction perçues par Tanguy et son équipe, classées par axe.

---

## Axe 1 — Hiérarchie de l'information

### Ce qui marche
- **Fiche projet** : le stepper en haut donne une lecture instantanée de l'état d'avancement. C'est l'élément le plus réussi du cockpit.
- **Bilan financier** : positionné en haut de la fiche, juste après le stepper. C'est le bon ordre (état → chiffres → détails).
- **Onglets attachments (Plan 3D / Plan technique / Images / Documents)** : 4 cases bien nommées et bien séparées, lisible.

### Ce qui pose problème
- **Le projet est l'unité de gravité au lieu du client.** Dans le PDF de la réunion, c'est LA décision structurante. Aujourd'hui, pour retrouver "tous les projets de Junker" ou "tous les projets de l'architecte Dupont", il faut filtrer la liste projets — pas naturel pour quelqu'un qui pense en termes de relation client.
- **Le pipeline commercial est dilué dans le champ `Statut`** (12 valeurs mélangées : En cours, Pose, SAV, Archivé, Découverte, Présenté…). Conceptuellement c'est 2 choses : la **phase commerciale** (avant signature) et l'**état du chantier** (après signature).
- **La liste des 11 zones dans la fiche projet est trop linéaire.** L'œil descend sans hiérarchie claire. Un projet en phase Découverte n'a pas besoin de voir les commandes ou la facturation. Un projet en pose n'a plus besoin de voir le devis prévi.

### Recommandation
- **Re-cadrer la navigation : Client > Projet > Détail**, avec un breadcrumb visible en haut.
- **Séparer `Phase commerciale` et `Statut chantier`** dans le modèle de données.
- **Replier les zones non pertinentes selon la phase** : sur la fiche projet, montrer par défaut les zones de l'étape courante + 1, replier le reste en accordéon.

---

## Axe 2 — Navigation et information architecture

### Ce qui marche
- Navigation par tabs claire et standard (Dashboard / Clients / Projets / Commandes / Tâches / SAV / Artisans / Fournisseurs / Devis / Calendar).
- Tab Admin réservé aux admins (séparation des préoccupations).
- Décision avril 2026 de retirer les tabs Plaud et Fiches découverte autonomes : excellente — ça correspond au principe "tout part du projet".

### Ce qui pose problème
- **10 tabs en navigation principale** = trop. Sur écran tablette (1024 px) ou mobile, ça surcharge.
- **Pas de navigation contextuelle** : depuis une fiche projet, pas de bouton "voir le client" ou "voir les autres projets du même client".
- **Le pipeline funnel du Dashboard n'est pas cliquable.** Si je vois "5 projets en Découverte", je ne peux pas cliquer pour les lister. C'est une visualisation morte.
- **Pas de fiche client détaillée** — c'est l'angle mort majeur. La modale d'édition n'est pas une fiche.

### Recommandation
- **Réduire la nav principale à 5 entrées** : Dashboard · **Clients** · Projets · Pipeline · Calendar. (Commandes / Tâches / SAV / Artisans / Fournisseurs / Devis deviennent des sous-vues ou listes filtrées contextuelles.)
- **Funnel cliquable** sur le Dashboard.
- **Fiche client = vraie page**, avec liste des projets, contact, historique, et bouton "+ Nouveau projet" qui ouvre la modale pré-remplie.
- **Breadcrumb en haut de chaque écran** : `Clients > Junker > Projets > Cuisine principale`.

---

## Axe 3 — Friction de saisie

### Ce qui marche
- **Import PDF Winner** : énorme gain de productivité, le parsing Claude évite des heures de saisie.
- **Auto-création tâches Virginie** à la signature : automation pertinente.
- **Modal édition tâche au clic sur une ligne** : pattern bien réalisé.

### Ce qui pose problème
- **Modale nouveau projet sans choix client** : provoque des doublons clients quand on crée un projet manuel (à la main, ou si Winner n'a pas été utilisé).
- **Pas de drag-and-drop sur le calendrier** : pour ajuster la date de pose, il faut ouvrir la fiche projet, trouver le champ date, le modifier. Multipliez par 30 projets, c'est lourd.
- **Pas d'actions pré-enregistrées par étape** : à chaque R1 Découverte, l'équipe ré-écrit les mêmes 5 tâches type ("Dessiner le projet", "Créer dossier présentation", etc.). Devrait être un template.
- **Champ Notes des commandes = texte brut libre** : ce qu'on envoie au fournisseur est moche et difficile à parser de l'autre côté.

### Recommandation
- **Modale nouveau projet en 2 temps** :
  1. **Choisir / créer client** (combobox recherche + bouton "+")
  2. **Détail projet** (référence, statut, budget…)
- **Drag-and-drop sur calendrier** (FullCalendar.js) avec gestion période début/fin de pose.
- **Templates de tâches par étape** : à l'arrivée en phase "Dessin", proposer un bouton "Générer les tâches type" qui crée les 5 tâches standard à valider/cocher.
- **BC en tableau HTML** avec Pos / Code / Description / SENS / Cote visible / Quantité, sans montants — mail propre et professionnel.

---

## Axe 4 — Signal vs bruit

### Ce qui marche
- **Alert bar** Dashboard (projets retardataires, tâches urgentes) : focalise l'attention.
- **Badges urgence rouges** dans la sidebar TOC fiche projet : bon signal visuel.

### Ce qui pose problème
- **Trop d'informations sur la fiche projet** quand le projet n'est qu'en Découverte. Le bilan financier prévi montre 0 €, les commandes affichent 0, les tâches sont vides… mais tout est affiché quand même.
- **Bug visuel sur les tâches date+heure** : signalé dans les notes JMG. À investiguer.
- **Affichage du champ Notes de commandes** sous forme de bloc texte : illisible quand il y a 30+ lignes.

### Recommandation
- **Mode "Vue progressive" sur la fiche projet** : zones repliées par défaut si pas encore atteintes par le stepper, expanded à partir de l'étape courante.
- **Refonte rendu Notes commandes** : si formaté comme un BC (lignes structurées), parser et afficher en table — sinon garder texte.
- **Fix bug tâche date+heure** : prioriser P1 sprint 2.

---

## Axe 5 — Mobile

### Ce qui marche
- **Stepper compact horizontalement scrollable** sur mobile (≤ 760 px) : pattern responsive correct.
- **Modale plein écran** sur mobile : bonne UX tactile.

### Ce qui pose problème
- **Navigation tabs en haut** : sur iPhone 13 (390 px), les 10 tabs ne tiennent pas. Probablement scroll horizontal ou stack vertical — à vérifier.
- **Tableau marges Admin** : tableau dense non optimisé mobile.

### Recommandation
- **Nav mobile en bottom bar** avec 5 icônes (cf. recommandation Axe 2).
- **Tableau Admin : version "card stack" sur mobile**, avec accordéon par projet.

---

## Axe 6 — Accessibilité

### Ce qui marche (depuis commit `e591922` du 2026-05-04)
- `role="dialog"` sur modales.
- `Esc` global pour fermer.
- Cards focusables au clavier.
- `--ink3` contraste 4.6:1.
- Stepper en `<button>` avec `aria-current` et `aria-label`.

### Ce qui pose problème
- **Calendar** : pas vérifié pour la navigation clavier, jamais audité.
- **Modale "Importer PDF"** : pas de gestion focus retour à la fermeture (probable).
- **Pictos emoji dans le stepper** : utilisés pour le sens (étape SAV = 🛠️). Lecteurs d'écran lisent l'emoji littéralement — manque potentiellement `aria-hidden="true"` + label texte explicite.

### Recommandation
- **Audit a11y complet** sur la nouvelle structure v3 avant cutover (skill `design:accessibility-review` ou `Lighthouse`).
- **Continuer la baseline a11y** déjà bien entamée. Stepper en `<button>` est exemplaire — étendre la même rigueur au funnel pipeline.

---

## Synthèse : les 5 douleurs principales

1. **Pas de fiche client** = obligation de chercher un projet pour savoir ce qu'on fait d'un client. Anti-pattern total.
2. **Pipeline commercial pauvre** = pas de visibilité sur le ratio de conversion ni la santé du flux d'affaires.
3. **Calendar passif** = pas de manipulation directe des dates, ce qui rend l'agenda inutile pour la planification active.
4. **BC moche et non structuré** = image dégradée vis-à-vis des fournisseurs, et difficulté pour eux à traiter la commande.
5. **Saisie redondante** (clients dupliqués, tâches type re-écrites) = perte de temps quotidien.

Ces 5 douleurs guident l'architecture cible (`04-architecture-cible.md`) et le plan d'implémentation (`05-plan-implementation.md`).
