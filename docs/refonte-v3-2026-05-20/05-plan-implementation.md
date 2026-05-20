# 05 — Plan d'implémentation v3

Suit le pattern validé sur d'autres cockpits 9·58 : **démo `/v3/` isolée** alimentée en mock-data, validée page par page, puis cutover atomique en 1 commit final.

---

## Hypothèses de planning

- Vitesse : Claude Code en pair-programming avec JMG, sessions ~3 h/jour.
- 1 sprint = 1 semaine calendrier.
- Validation visuelle Tanguy entre chaque sprint.

---

## Sprint 0 — Décisions produit (3 jours)

**Objectif** : trancher les 6 questions ouvertes (`04-architecture-cible.md §12`) avant code.

- [ ] Atelier 1 h avec Tanguy : valider l'arbo des écrans cible (wireframes ASCII `04`)
- [ ] Trancher Architecte (type Client vs nouvelle table) → ✍️ ADR
- [ ] Trancher Avenant BC (record lié vs flag) → ✍️ ADR
- [ ] Trancher Phase commerciale vs Statut chantier → ✍️ ADR + spec migration
- [ ] Trancher Cmd+K (in ou out du scope v3 ?)
- [ ] Trancher drag-drop calendar lib (FullCalendar vs autre)
- [ ] Trancher templates tâches (admin JMG ou Virginie ?)

**Livrable** : 1 doc `docs/refonte-v3-2026-05-20/ADR.md` consigné par décision.

---

## Sprint 1 — Pivot client-centric (5 jours)

**Objectif** : rendre la nouvelle navigation utilisable de bout en bout, sans encore toucher au pipeline ou au calendrier.

### Backend
- [ ] Script `setup-clients-fields-v3.js` (idempotent) : ajoute `Architecte référent`, `Clients liés`, `Date création` sur Clients
- [ ] Script `setup-projets-fields-v3.js` (idempotent) : ajoute `Phase commerciale` (singleSelect), `Statut chantier` (singleSelect), `Date pose fin`
- [ ] Backfill : pour chaque projet existant, mapper `Statut` → `Phase commerciale` + `Statut chantier`
- [ ] Endpoint `GET /api/clients/:id` : fiche client détaillée (client + projets liés)
- [ ] Endpoint `GET /api/clients/:id/projets` : liste projets d'un client
- [ ] Endpoint `POST /api/clients/:id/projets` : créer projet rattaché (alternatif au POST `/api/data/projets`)

### Frontend (sous `/v3/`)
- [ ] Setup démo `/v3/` isolée (HTML/CSS/Alpine vanilla, pattern 9·58)
- [ ] Nav principale 5 entrées + mobile bottom bar
- [ ] Écran `/v3/clients` : liste avec filtres type
- [ ] Écran `/v3/clients/:id` : fiche client avec liste projets + bouton "+ Nouveau projet"
- [ ] Modale "Nouveau projet" : combobox client (recherche + bouton + nouveau)
- [ ] Validation Tanguy 30 min — feedback

**Critère de done** : Tanguy peut créer un nouveau client + projet rattaché depuis l'UI v3, sans toucher la v2.

---

## Sprint 2 — Pipeline commercial automatisé (5 jours)

**Objectif** : remplacer le funnel statique par une vraie vue pipeline cliquable avec taux de conversion.

### Backend
- [ ] Endpoint `GET /api/pipeline` : agrège par `Phase commerciale` + calculs taux conversion 12 derniers mois
- [ ] Endpoint `GET /api/pipeline/:phase` : liste projets filtrés
- [ ] Logique de transition de phase : à la création d'un devis signé → bascule auto `Phase commerciale = Signé`
- [ ] Alertes pipeline : projet > 30 j en "En attente décision" → flag risque

### Frontend `/v3/`
- [ ] Écran `/v3/pipeline` : tableau avec taux conversion + agrégats
- [ ] Écran `/v3/pipeline/:phase` : liste projets de la phase
- [ ] Dashboard refondu : funnel cliquable + alertes pipeline
- [ ] Bouton "Archiver projet" (set `Statut chantier = Archivé`)
- [ ] Filtre par défaut "non archivés" dans listes projets/clients
- [ ] Validation Tanguy 30 min

**Critère de done** : Tanguy voit son taux de conversion réel, clique sur "Découverte" et obtient la liste des 12 projets en cours.

---

## Sprint 3 — Calendrier + rétro-planning (5 jours)

**Objectif** : transformer le calendrier passif en outil de planification active.

### Backend
- [ ] Logique rétro-planning : à la création/MAJ `Date pose début`, créer/MAJ tâches J−3,5 mois et J−1,5 mois
- [ ] Endpoint `PATCH /api/projets/:id/pose` : update période pose (drag-drop)
- [ ] Endpoint `GET /api/calendar/events?start=…&end=…` : agrège réunions Plaud + pose + tâches + échéances devis

### Frontend `/v3/`
- [ ] Intégrer FullCalendar.js (lib MIT, vanilla, pas de framework)
- [ ] Vue mois avec événements colorés (R1 / R2 / Pose / Tâches / Échéances)
- [ ] Drag-and-drop sur événements Pose → PATCH `Date pose début` / `Date pose fin`
- [ ] Filtres événements par type
- [ ] Fiche projet : zone "📅 Agenda projet" mini-calendar inline
- [ ] Validation Tanguy 30 min

**Critère de done** : Tanguy étend la pose Junker en glissant la barre de 5 j à 7 j, voit les tâches J−3,5 mois et J−1,5 mois se créer automatiquement.

---

## Sprint 4 — BC tableau + Plaud enrichi + bugs (5 jours)

**Objectif** : finaliser les fonctionnalités P0/P1 restantes.

### Bons de commande
- [ ] Refonte génération BC : template HTML tableau (Pos / Code / Description / SENS / Cote visible / Quantité)
- [ ] Filtrage : ne pas afficher montants
- [ ] Source = Lignes devis du devis Winner
- [ ] Avenant BC : nouvelle UI fiche projet "+ Créer avenant" → modale lignes à modifier → POST `/api/commandes` avec `BC parent`
- [ ] Calcul montant net = brut − somme(avenants payés)

### Plaud R1 enrichi
- [ ] Refonte prompt Claude : ajouter section `prochaines_actions[]` structurée
- [ ] Backend `/api/plaud/parse` : créer tâches auto depuis prochaines_actions
- [ ] Nommage auto tâches `[Nom Client] / [Titre]`
- [ ] Bug : checkbox Plaud dans modale nouveau projet (vérifier régression)

### Bugs & confort
- [ ] Fix bug affichage tâche date+heure
- [ ] Fix bug import devis Morales (échéanciers)
- [ ] Plans de travail : router parsing Winner vers famille `Plan de travail` (pas `Divers`)
- [ ] Convention nommage documents : ajout helper auto-rename à l'upload (`[CLIENT]_[PROJET]_[TYPE]_[DATE].ext`)

### Frontend `/v3/`
- [ ] Fiche projet refondue (vue progressive) : zones repliées selon stepper
- [ ] Validation Tanguy 1 h — feedback

**Critère de done** : Tanguy envoie un BC fournisseur en tableau propre. Un R1 Plaud parsé crée automatiquement 3 tâches "à faire avant présentation devis".

---

## Sprint 5 — Cutover + a11y + nettoyage (3 jours)

**Objectif** : basculer la prod sur v3, supprimer la v2.

- [ ] Audit a11y complet sur `/v3/` (skill `design:accessibility-review` + Lighthouse)
- [ ] Tests manuels golden path + edge cases (notamment mobile 390px)
- [ ] Cutover atomique : 1 PR qui bascule la racine `/` sur v3, archive `/v3/` → `/`, supprime ancien front
- [ ] Communication Tanguy + Virginie : nouveau parcours, changements visibles
- [ ] Champ legacy `Statut` projet : supprimer après 1 semaine d'observation

**Critère de done** : URL prod `tanguydesign.958.fr` sert l'UI v3, l'équipe utilise sans friction.

---

## Sprint 6+ — Confort & futur (P2, non-bloquant)

À planifier après validation v3 :

- **2FA Authentificator** : 3 j (lib `otplib` + QR code setup + table users TOTP)
- **Bouton support** : 0,5 j (modal + POST mail à JMG)
- **IA d'analyse cockpit** : 5 j (cron quotidien Claude lit l'état + email suggestions)
- **Templates de tâches par étape** : 3 j (table + admin UI + bouton génération)
- **Admin coûts par famille** : 2 j (rollup Airtable + UI)
- **Cmd+K recherche globale** : 2 j (palette + fan-out API)

Total P2 : ~16 jours, à étaler sur 6-8 semaines selon priorité Tanguy.

---

## Estimation globale

| Sprint | Durée | Cumul | Livrable |
|--------|-------|-------|----------|
| 0   | 3 j | 3 j  | Décisions tranchées + ADR |
| 0.5 | 1 j | 4 j  | **Audit data quality Airtable** (ajouté en revue senior) |
| 1   | 5 j | 9 j  | Client-centric utilisable |
| 2   | 5 j | 14 j | Pipeline + alertes |
| 3   | 5 j | 19 j | Calendar drag-drop + rétro-planning |
| 4   | 5 j | 24 j | BC tableau + Plaud enrichi + bugs |
| 5   | 3 j | 27 j | Cutover prod + rollback plan |

**Total v3** : ~5,5 semaines calendaires (en pair-programming Claude+JMG, ~3 h/j).

**Date cible de cutover** : ≈ fin juin / début juillet 2026 (en partant du 1er juin pour Sprint 0).

---

## Risques & mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Migration Airtable mal backfillée (perte données) | 🔴 critique | Script idempotent + dry-run + backup CSV avant `--apply` |
| Régression sur prod pendant les sprints | 🟠 moyen | Démo `/v3/` isolée — la prod v2 continue de tourner |
| Drag-drop calendar incompatible mobile | 🟠 moyen | Test mobile dès sprint 3, sinon fallback : modal de modification |
| Avenants BC : confusion sur les montants | 🟠 moyen | UI explicite "Montant net = brut − payé" + tests sur 2-3 projets pilotes |
| Sur-engagement de Tanguy en validation | 🟢 faible | Validation 30 min cadré entre sprints, pas plus |
| Bug Morales (échéanciers) plus profond que prévu | 🟢 faible | Investiguer dès Sprint 0, fix dans Sprint 4 |

---

## Définition de "Done" pour la v3

- [ ] L'équipe Tanguy utilise spontanément v3 sans demander "où est l'ancien écran ?"
- [ ] Le pipeline commercial montre un vrai taux de conversion à 30/90/365 jours
- [ ] La date de pose modifiée déclenche bien le rétro-planning auto
- [ ] Les BC envoyés sont des tableaux propres sans montants
- [ ] Un nouveau projet est toujours rattaché à un client (zéro doublon client)
- [ ] Un architecte voit ses clients/projets rattachés
- [ ] L'UI est utilisable en mobile 390 px iPhone Safari sans dégradation
- [ ] Baseline a11y maintenue (`role="dialog"`, `aria-*`, contraste, focus visible)

---

## Notes opérationnelles

- **Démo `/v3/` mock-data first** : on ne touche pas Airtable tant que la validation visuelle Tanguy n'est pas faite, ça permet d'itérer vite.
- **Commits séparés** : 1 commit = 1 endpoint/écran/sprint. Pas de gros commit fourre-tout.
- **PR par sprint** : merge sur `main` à la fin de chaque sprint, deploy Scaleway en workflow_dispatch.
- **Tests manuels documentés** : pour chaque sprint, une checklist test plan dans la PR description.
- **Communication équipe** : à chaque sprint, capture vidéo 1 min envoyée à Virginie/Solène pour validation latente.

---

## Revue senior — points d'attention complémentaires (ajout 20/05/2026)

Post-rédaction de la v1 du plan, revue critique en mode dev senior. Quatre risques sous-estimés et trois manques structurels identifiés.

### Risque #1 — Migration `Statut` → `Phase commerciale` + `Statut chantier`

Le split conceptuel est propre, mais Airtable **n'a pas de transactions**. Si le backfill plante en cours, on se retrouve avec des projets en état mixte.

Cas tordus à mapper explicitement avant `--apply` :

| Statut historique | Phase commerciale cible | Statut chantier cible | Notes |
|-------------------|-------------------------|------------------------|-------|
| Découverte | Découverte | (vide) | |
| Dessin / Présentation | Dessin | (vide) | |
| Devis envoyé | Présentation devis | (vide) | |
| En attente décision | En attente décision | (vide) | |
| Signé | Signé | Pré-pose | Auto-transition à la signature |
| Pose en cours | Signé | Pose en cours | Conserve les 2 |
| Terminé | Signé | Terminé | |
| SAV | Signé | SAV | |
| Archivé | Signé | Archivé | |
| (inconnu / vide) | Découverte | (vide) | Fallback par défaut |

**Mitigation obligatoire** :
1. Exporter Projets en CSV avant tout (`scripts/backup-projets-csv.js`)
2. Script `setup-projets-fields-v3.js --dry-run` qui sort un rapport :
   - Nombre de projets par mapping cible
   - Projets en état inattendu (Statut absent du tableau ci-dessus)
3. Validation explicite par Tanguy avant `--apply`
4. Conservation du champ `Statut` legacy en lecture seule pendant ≥ 2 sprints

### Risque #2 — Mock-data `/v3/` qui dérive de la prod

5 semaines de mock-data = 5 semaines de drift vs vraies données Tanguy. On découvre les vrais edge cases au cutover, et la migration finale prend en compte la dérive.

**Mitigation** :
- Sprint 1 : démo `/v3/` en mock-data (validation visuelle).
- **Sprint 2 (dès le 2e sprint)** : brancher `/v3/` sur l'API réelle en **lecture seule** d'abord. Tester avec les vrais projets Tanguy actifs.
- Sprint 3+ : passer en lecture/écriture progressivement.

### Risque #3 — Drag-drop calendar sous-estimé sur mobile

FullCalendar.js fonctionne bien en desktop, mais les libs drag-drop sur tactile (iPad / iPhone Safari) sont historiquement fragiles. L'estimation 5 j ne tient que pour desktop.

**Décision à prendre en Sprint 0** : poser à Tanguy / Virginie : "tu planifies la pose depuis ton bureau ou ton iPhone ?". Si réponse = bureau → desktop only OK, garder 5 j. Si réponse = mobile → +3 j ou fallback modal de modification.

### Risque #4 — Avenant BC : modélisation comptable

`Montant net = brut − somme(avenants payés)` est une **simplification trompeuse**. Cas réels à modéliser :

- Avenant **partiellement payé** : un acompte sur avenant, comment gérer le delta ?
- Avenant **annulé** : on rembourse, on supprime, on archive ?
- Avenant à **delta négatif** (changement électroménager : −1 modèle à 800 € + 1 modèle à 1200 € = +400 € net)
- Avenant qui **dépasse le scope** d'un BC d'origine (le BC initial était à 18 k€, l'avenant le porte à 21 k€ — c'est un avenant ou un nouveau BC ?)

**Mitigation obligatoire** : atelier 30 min en Sprint 0 avec Tanguy + Virginie pour cartographier **3-4 avenants réels** rencontrés en 2025-2026 (cas historiques). Modéliser à partir de cas concrets, pas d'une abstraction.

---

### Manque #1 — Sprint 0.5 : audit data quality Airtable

Le pivot client-centric va exposer toutes les saletés actuelles. À faire avant Sprint 1 :

- [ ] Combien de **clients en doublon** ? (même nom, même téléphone, même email) → script de détection
- [ ] Combien de **projets sans client lié** ? → 0 est l'objectif
- [ ] Combien de **projets avec statut incohérent** ? (ex : "Pose en cours" mais date pose dans le futur)
- [ ] Combien de **clients sans aucun projet** ? (cleanup ou archive)
- [ ] Plans de travail en famille "Divers" → liste à reclasser
- [ ] Bug Morales : analyser dès maintenant (échéanciers incorrects) pour estimer fix Sprint 4

**Livrable** : 1 rapport markdown `docs/refonte-v3-2026-05-20/data-audit.md` + scripts nettoyage idempotents validés par Tanguy.

### Manque #2 — Plan de rollback prod (Sprint 5)

Le `git revert` ne suffit pas si on a modifié Airtable. Plan de rollback :

1. **Snapshot avant cutover** : export CSV de toutes les tables modifiées (Clients, Projets, Commandes) + dump des nouveaux fieldIds dans `scripts/airtable-rollback.json`
2. **Procédure de retour arrière** documentée :
   - `git revert <SHA cutover>` puis `npm start` local pour smoke test
   - Si bug bloquant en prod après cutover : redéployer le commit précédent via workflow Scaleway
   - Si bug sur les données : script `scripts/rollback-airtable.js --from-snapshot=<date>` qui restaure les fieldIds legacy en lecture seule
3. **Fenêtre d'observation** : 72 h après cutover avant suppression définitive des champs legacy

### Manque #3 — Observabilité

Aucune mention de logs structurés ou monitoring dans le plan v1. À l'échelle 4 utilisateurs, c'est tolérable, mais a minima :

- **Logs structurés Scaleway** : déjà partiellement présent (auth FAIL/OK) — étendre à toutes les routes critiques (signature devis, création BC, parsing Plaud).
- **Endpoint `/api/health/v3`** : retourne le statut des nouveaux composants (Airtable Meta API, parsing Claude, cron rétro-planning).
- **Alerting léger** : un cron quotidien qui ping `/api/health/v3` et email JMG si KO 3 fois de suite. Lib `node-cron` + Brevo (déjà dispo dans l'écosystème 9·58).
- **Page `/admin/health`** : tableau des derniers parses Plaud / imports Winner / signatures, avec lien vers logs en cas d'erreur. Utile pour Tanguy en cas de support.

À ajouter en **Sprint 5** (1 j supplémentaire, déjà absorbé dans les 3 j prévus si pas de blocage).

---

## Checklist senior — à valider avant Sprint 0

- [ ] Backup CSV Projets / Clients / Commandes existe (snapshot pré-refonte)
- [ ] Mapping `Statut → Phase commerciale + Statut chantier` validé par Tanguy ligne par ligne
- [ ] Réponse Tanguy : "tu planifies la pose depuis bureau ou mobile ?"
- [ ] Atelier avenants : 3-4 cas historiques cartographiés
- [ ] Script `setup-projets-fields-v3.js --dry-run` testé sur snapshot local
- [ ] Plan de rollback rédigé et stocké dans `docs/refonte-v3-2026-05-20/rollback-plan.md`
- [ ] Conventions de logs Scaleway alignées avec ce qui existe déjà
- [ ] Sprint 0.5 budgeté (1 j supplémentaire — pas de cause à effets sur la cible cutover fin juin)
