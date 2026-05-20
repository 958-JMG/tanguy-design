# Refonte v3 — Cockpit Tanguy Design

**Date** : 20 mai 2026
**Auteur** : Claude (en autonomie, sur la base PDF réunion + notes JMG)
**Branche** : `chore/menage-repo-2026-05-04`
**Sources** :
- PDF réunion 20 mai 2026 (Stratégie CRM, Pipeline Commercial, Automatisation)
- Notes JMG (retours réunion + retours utilisateurs Tanguy)
- Audit code existant (server.js 1142 l. + index.html monolithique 289 KB)

---

## TL;DR — le pivot v3

Le cockpit v2 (avril 2026) est **projet-centric** : on rentre par projet, le client est secondaire.
Le pivot v3 est **client-centric** : le client devient l'unité de gravité, un client peut porter plusieurs projets (cuisine principale + avenant accessoires, projet 1 + projet 2 d'un architecte, etc.).

Trois lignes de force :

1. **Navigation** : CLIENT → projets, plus l'inverse. Architecte = type de client qui rattache d'autres clients/projets.
2. **Pipeline commercial automatisé** : Découverte (0 %) → Dessin (25 %) → Présentation devis (50 %) → En attente décision (75 %) → Signé. Vue tableau avec taux de conversion, pas Kanban.
3. **Calendrier projet rétro-planifié** : on part de la date de pose prévisionnelle ; le système crée automatiquement les jalons (J−3,5 mois = commandes ; J−1,5 mois = rappel planif chantier).

À côté de ces 3 piliers : 11 demandes opérationnelles (drag-and-drop pose, BC en tableau sans montants, avenants, fix bugs tâches date/heure, plaud-action-presets, 2FA, etc.) — détaillées dans `02-matrice-ecart.md`.

---

## Sommaire du dossier

| Fichier | Quoi | Pour qui |
|---------|------|----------|
| [01-cartographie-existant.md](01-cartographie-existant.md) | État des lieux du code v2 (vues, API, modèle Airtable) | Dev / archi |
| [02-matrice-ecart.md](02-matrice-ecart.md) | Tableau cible vs existant : pour chaque décision/demande, statut + complexité + priorité | Dev / pilotage |
| [03-design-critique.md](03-design-critique.md) | Critique UX structurée de l'existant : hiérarchie, navigation, signal/bruit, mobile, accessibilité | Design / produit |
| [04-architecture-cible.md](04-architecture-cible.md) | **Le cœur du livrable** — proposition structure v3 : arbo des écrans, modèle de données cible, wireframes ASCII, principes navigation | JMG / Tanguy / Dev |
| [05-plan-implementation.md](05-plan-implementation.md) | Plan d'implémentation phasé en 6 sprints + estimation effort + démo `/v3/` isolée avant cutover | Dev / planning |
| [06-code-review-architecture.md](06-code-review-architecture.md) | **Revue senior code + archi + sécu** (tech-lead + security-reviewer) — Sprint 0.7 ajouté en prep refacto + 2 P0 bloquants | Dev / archi |
| [07-sprint-2-3-4-realise.md](07-sprint-2-3-4-realise.md) | **Bilan final** Sprints 2-4 livrés (fiche projet riche, BC tableau, Plaud auto, Calendar drag-drop, sécu P1+P2) | Dev / pilotage |
| [GUIDE-UTILISATEUR-V3.md](GUIDE-UTILISATEUR-V3.md) | **Guide pour Tanguy + Virginie** : parcours type, différences v2/v3, admin, sécurité, limites actuelles | Utilisateurs |
| [bug-morales-echeances.md](bug-morales-echeances.md) | Investigation bug parsing échéances : cause racine + fix proposé Sprint 4 | Dev |

---

## Décisions structurantes à valider avant développement

Avant toute ligne de code, 4 questions de produit à trancher avec Tanguy :

1. **Architecte** : entité séparée (nouvelle table Airtable) ou type de Client (`type = "Architecte"` + champ `Clients liés` self-référence) ?
   → Recommandation : **type de Client** (KISS, pas de migration lourde).

2. **Avenant BC** : nouveau record `Commande` lié au BC d'origine (relation `parent`) ou champ `Type = Avenant` + `BC parent` ?
   → Recommandation : **nouveau record avec relation parent** (audit trail propre, calcul net déduit du parent).

3. **Pipeline 5 étapes** : on garde aussi le `Statut projet` actuel (12 valeurs : En cours / Pose en cours / Terminé / SAV / Archivé / etc.) ?
   → Recommandation : **2 champs distincts** — `Phase commerciale` (Découverte → Signé) + `Statut chantier` (Pose / Terminé / SAV / Archivé). Le pipeline commercial ne s'applique qu'avant signature.

4. **Démo `/v3/`** : on suit le pattern validé sur d'autres cockpits 9·58 (démo isolée mock-data sur `/v3/` validée page par page, puis cutover atomique) ?
   → Recommandation : **oui**, sinon on casse la prod pendant 4 sprints.

---

## Méthodologie suivie

1. Lecture intégrale du PDF de la réunion + des notes JMG.
2. Cartographie de l'existant via 3 agents Explore parallèles (vues home/client, fiche projet/plaud, BC/admin).
3. Cross-référencement cible vs existant.
4. Critique UX de l'existant.
5. Architecture cible + wireframes ASCII pour valider la structure visuellement avant le code.
6. Plan d'implémentation phasé.

Aucun code modifié à ce stade. Le livrable est exclusivement documentaire — c'est l'étape "design before build".
