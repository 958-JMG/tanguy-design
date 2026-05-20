# 02 — Matrice écart : cible vs existant

Légende statut :
- ✅ **Existe** — déjà fait, à conserver
- 🟡 **Partiel** — base présente, à enrichir
- ❌ **Absent** — à construire
- ⚠️ **Bug** — existe mais cassé

Légende complexité :
- 🟢 **S** — 1-3 h (champ ajouté, petit composant)
- 🟡 **M** — 0,5-2 j (nouveau écran, refonte composant)
- 🔴 **L** — 3-7 j (refonte structurelle, nouvelle table/API, parsing complexe)

Légende priorité :
- **P0** — bloquant le pivot client-centric (sprint 1)
- **P1** — fort impact opérationnel (sprint 2-3)
- **P2** — confort / futur (sprint 4+)

---

## A. Navigation client-centric (PDF §1)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Entrée principale = Client (pas projet) | ❌ | 🔴 L | **P0** | Refonte navigation principale + Home + fiche client |
| Fiche client détaillée affichant tous les projets liés | ❌ | 🟡 M | **P0** | Nouveau écran (vue actuelle = juste card liste) |
| Bouton "Nouveau projet" depuis fiche client | ❌ | 🟢 S | **P0** | Pré-remplit `clientId` |
| Bouton "Archiver projet" | ❌ | 🟢 S | **P1** | Ajout valeur `Archivé` au champ Statut + filtre par défaut |
| Sous-catégorie architecte (rattacher clients/projets) | ❌ | 🟡 M | **P1** | Voir décision arbitrale dans `00-README.md` (recommandation : type Client + self-référence) |
| Distinction pro / particulier | 🟡 | 🟢 S | **P1** | Champ `Type` existe déjà sur Clients (Particulier/Professionnel) — non exploité dans l'UI |

---

## B. Pipeline commercial (PDF §2 + notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| 5 étapes Découverte (0 %) → Dessin (25 %) → Présentation devis (50 %) → En attente décision (75 %) → Signé | 🟡 | 🟡 M | **P0** | Pipeline funnel existant mais 4 étapes hardcodées différentes — ajouter `Phase commerciale` distinct du `Statut chantier` |
| Étape "Dessin / Présentation projet" entre Découverte et Présentation devis | ❌ | 🟢 S | **P0** | Une fois `Phase commerciale` créée |
| Tableau suivi prospects + taux conversion (PAS Kanban) | ❌ | 🟡 M | **P0** | Nouvel écran Admin/Pipeline avec calcul ratio par étape |
| Funnel cliquable : clic "Découverte" → liste projets en découverte | ❌ | 🟢 S | **P1** | Lien depuis Dashboard vers liste filtrée |
| Label visuel "Pipeline projet" avec pictos fiche projet | ❌ | 🟢 S | **P1** | Réutiliser les emojis du stepper actuel |
| Conserver `Statut` chantier séparé (Pose / Terminé / SAV / Archivé) | — | — | — | Décision archi (voir README) |

---

## C. Plaud R1 / R2 (notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Retranscription Plaud active dans fiche projet | ✅ | — | — | OK |
| Retranscription Plaud dans modale nouveau projet | 🟡 | 🟢 S | **P1** | Checkbox existe — vérifier qu'elle fonctionne (regression ?) |
| Plaud R1 → prochaines actions (ex : date présentation devis) | ❌ | 🟡 M | **P0** | Enrichir le prompt Claude `/api/plaud/parse` pour extraire "prochaines actions" + dates + créer tâches auto |
| Tâche pour client → nommage auto `[Nom Client] / [Titre tâche]` | ❌ | 🟢 S | **P1** | Côté serveur, ajouter prefix dans Titre lors création depuis fiche projet |
| Bug affichage tâche date+heure | ⚠️ | 🟢 S | **P1** | À investiguer (probable formatage Airtable vs UI) |
| Actions pré-enregistrées par étape, marquables "Fait" | ❌ | 🔴 L | **P2** | Nouveau modèle : table `Templates Tâches` × Étape pipeline, génération bulk |

---

## D. Modale nouveau projet (notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Choix client (existant ou créer) | ❌ | 🟡 M | **P0** | Combobox recherche client + bouton "+ nouveau" |
| Champs actuels (Référence, Statut, Budget, Marge, Dates, Description) | ✅ | — | — | OK |
| Si pas de client choisi : créer client en même temps | ❌ | 🟡 M | **P0** | UI à 2 étapes (Client puis Projet) ou champ inline |

---

## E. Timeline / calendrier (PDF §4 + notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Drag-and-drop pose : telle date → telle date = Période de pose | ❌ | 🔴 L | **P1** | Lib drag-drop calendar (FullCalendar.js ?) + nouveau champ `Date pose début` + `Date pose fin` sur Projets |
| Rétro-planning auto depuis date pose | ❌ | 🟡 M | **P0** | Cron ou trigger : à création/update `Date pose début`, créer 2 tâches auto (J−3,5 mois commandes / J−1,5 mois rappel planif chantier) |
| Signature devis → tâche "envoyer infos artisan + relance 2 mois" | 🟡 | 🟢 S | **P1** | Auto-création BC + tâche acompte existe — ajouter aussi tâches artisans + relance |
| Tâches visibles dans agenda du projet | ❌ | 🟡 M | **P1** | Vue Calendar projet : afficher tâches dont `Échéance` dans la période |

---

## F. Bons de commande (PDF §4 + notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| BC format tableau (Pos / Code / Description / SENS / Cote visible / Quantité) | ❌ | 🟡 M | **P0** | Refonte génération mail : HTML table au lieu de texte brut. Source = Lignes devis du devis Winner |
| Pas de montants sur BC | 🟡 | 🟢 S | **P0** | Filtre dans le template |
| Reprendre exactement la commande Winner | ❌ | 🟡 M | **P0** | Les Lignes devis sont parsées par Claude — vérifier qu'on garde `Position`, `Code`, `Description`, `SENS`, `Cote visible`, `Quantité` (au-delà du strict prix) |
| Avenant BC (modif post-signature, déduction payé) | ❌ | 🔴 L | **P1** | Nouvelle entité `BC parent` + calcul `Montant net = BC − somme(avenants payés)` |
| Maquettes BC à revoir | ❌ | 🟡 M | **P1** | Design + validation Tanguy avant code |

---

## G. Facture acompte (notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Tâche Virginie à signature devis (facture acompte 30 %) | ✅ | — | — | OK |
| Si Virginie marque tâche "Fait" → MAJ projet (déclencheur stepper) | 🟡 | 🟢 S | **P0** | Stepper utilise déjà statut tâches `[FACTURATION]` — vérifier que ça remonte correctement |

---

## H. Multi-projets par client (notes JMG)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Plusieurs projets rattachés au même client | ✅ | — | — | Schéma Airtable supporte (Projets.Client = linked field) |
| Cuisine + accessoires = 2 projets séparés | ✅ | — | — | OK (mais nécessite UI fiche client pour le voir, voir A) |
| Tous projets visibles sous le client | ❌ | 🟡 M | **P0** | Dépend de la fiche client (A) |
| Import devis Winner sur projet existant (relais) | ✅ | — | — | Logique Additif existe — vérifier qu'on peut aussi remplacer le Principal estimé par un Principal signé |

---

## I. Plans de travail (PDF §3)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Plans de travail assignés à famille + fournisseur correct | 🟡 | 🟢 S | **P1** | Famille `Plan de travail` existe — corriger le parsing Winner pour ne plus router vers "Divers" |

---

## J. Sécurité (PDF §5)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| 2FA Authentificator (TOTP) | ❌ | 🔴 L | **P2** | Lib `otplib` + QR code setup + table users avec secret TOTP. Garder bcrypt en backup |
| Bouton support / signaler problème | ❌ | 🟢 S | **P2** | Bouton flottant → ouvre modal → POST mail à JMG |
| IA d'analyse cockpit (suggestions auto) | ❌ | 🔴 L | **P2** | Cron quotidien : Claude lit l'état du cockpit (projets en retard, marges faibles, etc.) → suggestion email JMG |

---

## K. Admin & data quality (PDF §3 + §5)

| Demande | Statut | Complexité | Priorité | Notes |
|---------|--------|------------|----------|-------|
| Convention de nommage documents | ❌ | 🟡 M | **P1** | Spec à valider : `[CLIENT]_[PROJET]_[TYPE]_[DATE].ext` |
| Centralisation base documentaire | ✅ | — | — | 4 champs attachments existent — OK |
| Section Admin pour stocks / coûts / marges | 🟡 | 🟡 M | **P2** | Admin existe (Marges + Stock) — enrichir avec coûts par famille fournisseur |
| Bug import devis Morales (échéanciers incorrects) | ⚠️ | 🟡 M | **P0** | À investiguer — probablement parsing date pose mal interprétée |

---

## Synthèse priorité

### P0 — Sprint 1 (Pivot client-centric, ~2 semaines)
1. Refonte navigation : Home client-centric
2. Fiche client détaillée + bouton "Nouveau projet"
3. Modale nouveau projet avec rattachement client
4. Phase commerciale (5 étapes pipeline) + statut chantier séparés
5. Tableau pipeline + taux conversion
6. Rétro-planning auto depuis date pose
7. BC en tableau sans montants
8. Fix bug import Morales (échéanciers)
9. Vérifier Plaud dans modale nouveau projet

### P1 — Sprint 2 (Enrichissement opérationnel, ~2 semaines)
1. Bouton archive projet
2. Architecte / pro distinction
3. Funnel cliquable
4. Drag-and-drop pose
5. Tâches dans agenda projet
6. Avenant BC
7. Maquettes BC revisées
8. Plaud R1 enrichi (prochaines actions)
9. Nommage auto client/tâche
10. Fix bug affichage tâche date+heure
11. Plans de travail famille correcte
12. Convention nommage documents

### P2 — Sprint 3+ (Confort & futur)
1. 2FA Authentificator
2. Bouton support
3. IA d'analyse cockpit
4. Actions pré-enregistrées par étape
5. Admin enrichi (coûts par famille)
