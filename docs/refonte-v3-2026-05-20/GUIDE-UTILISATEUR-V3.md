# Guide utilisateur — Cockpit v3

**Pour** : Tanguy, Virginie, Solène, Sébastien, Marine
**URL** : https://tanguydesign.958.fr/v3/
**Statut** : preview (la v2 reste sur `/` jusqu'au cutover)

---

## 1. Ce qui change par rapport à la v2

| Avant (v2) | Maintenant (v3) |
|------------|------------------|
| 10 onglets en haut (Clients, Projets, Commandes, Tâches, …) | 5 sections : Dashboard, Clients, Pipeline, Calendar, Admin |
| Le **projet** était l'entrée principale | Le **client** est l'entrée principale, les projets sont **rattachés** au client |
| Modale Nouveau projet sans rattachement client → doublons | Toujours via la fiche client → **zéro doublon possible** |
| Pipeline = funnel statique non cliquable | Pipeline = tableau avec **taux de conversion** + filtres par phase |
| Calendrier passif | Calendar **drag-and-drop** sur les périodes de pose |
| Bons de commande en texte brut | BC en **tableau structuré** Pos / Code / Description / SENS / Cote / Qté (sans montants) |
| Pas de palette de recherche | **Cmd+K** (⌘K) pour recherche transverse |
| Bouton bug : aucun | **Bouton rouge en bas à droite** → "Signaler un problème" |

---

## 2. Parcours type pour gérer un nouveau projet

### a. Création d'un client + projet

1. **Clients** dans la nav → **+ Nouveau client**
2. Remplis nom + type + contact + email + téléphone + adresse + source + notes → **Créer client**
3. Tu es sur la fiche client → **+ Nouveau projet**
4. Référence (auto si vide) + Phase = Découverte + Budget HT estimé + Date pose souhaitée + Description → **Créer projet**
5. Optionnel : coche **Coller transcription Plaud R1** → colle la transcription → l'IA extrait les **prochaines actions** et crée automatiquement les tâches préfixées `[Nom Client] / ...`

### b. Suivi d'un projet existant

1. **Clients** → cherche le client (recherche live)
2. Click le client → fiche client avec **liste des projets** rattachés
3. Click le projet → fiche projet complète :
   - **Stepper 12 étapes** (Découverte → SAV) avec couleurs done/cours/à venir
   - **Bilan financier** (CA, fournisseurs, artisans − 5 % rétro, marge)
   - **Tâches** éditables (checkbox toggle, edit/delete inline, nouvelle tâche en haut)
   - **Commandes** fournisseurs
   - **Devis** Tanguy + artisans
   - **Réunions Plaud R1 / R2** (déplier pour voir Synthèse, Attentes, Tâches identifiées)
   - **Journal chantier** (ajout d'entrée daté + auteur auto)
   - **Documents** : 4 zones (Plan 3D / Plan technique / Images / Documents projet) avec **drag-drop fichier** ou clic + pour ajouter

### c. Pipeline commercial

1. **Pipeline** dans la nav
2. Vois en haut le **taux de conversion entre phases** (Découverte → Dessin → Présentation devis → En attente → Signé)
3. Tableau détaillé : pour chaque phase, le nombre de projets + CA estimé + âge moyen + état (bloqué > 30 j)
4. Click **Voir N →** sur une phase → liste des projets en filtrage
5. Click un projet → fiche projet directement

### d. Calendar

1. **Calendar** dans la nav
2. Mois courant affiché, ton **jour d'aujourd'hui** est cerclé en sombre
3. Pose visible en barre rouille étalée sur les jours
4. **Drag** sur une barre de pose → **drop** sur un autre jour → confirmation → la date est sauvegardée
5. Click sur une barre de pose → fiche du projet

### e. Recherche rapide (Cmd+K)

Appuie sur **⌘K** (Mac) ou **Ctrl+K** (Windows) depuis n'importe où.
Tape un nom client / projet / référence devis → liste filtrée → Enter pour ouvrir la fiche.

---

## 3. Admin (Virginie)

Onglet **Admin** visible uniquement pour les comptes administrateurs (Virginie par défaut).

### a. Briefing IA quotidien

1. **Admin** → **Générer le briefing** (en haut)
2. Claude (Sonnet 4.5) analyse le cockpit pendant 10-30 s
3. Affichage :
   - Alerte critique (encart rouille) si situation urgente
   - Synthèse 2-3 phrases (santé pipeline, charge, points chauds)
   - 3-5 points d'attention pour aujourd'hui
   - 5 suggestions actionnables pour la semaine
   - Métriques snapshot (clients, projets en cours, tâches retard, projets bloqués)

### b. Marges par projet

1. **Admin** → **Charger** (section Marges par projet)
2. Tableau de tous les projets avec : Référence, Client, Phase, CA HT, Fournisseurs, Artisans, Rétro (+5 % artisans contractuels), Marge €, Marge %
3. KPI globaux en haut : CA cumul, marge cumul, marge moyenne %, nombre de projets en perte
4. Click ligne → fiche projet

---

## 4. Pour signaler un bug ou demander une amélioration

**Bouton rouge en bas à droite** (visible partout dans la v3) → **Signaler un problème**.

Décris le bug + ce que tu attendais → **Envoyer**.
JMG voit le message dans les logs Scaleway, avec l'URL où tu étais + ton navigateur.

---

## 5. Limites actuelles (à connaître)

- **Architecte** : la valeur dans le filtre Type sera fonctionnelle **dès que JMG a ajouté la valeur "Architecte" manuellement dans Airtable** (l'API a refusé la modification auto). Pour l'instant elle est dans le menu mais Airtable refuse les enregistrements.
- **Plaud R1 enrichi** : la création automatique des tâches depuis les transcriptions ne fonctionne que pour les nouvelles transcriptions parsées via l'IA (pas pour les R1 historiques).
- **Stepper** : les jalons sont calculés depuis les tâches existantes (titre contenant "acompte", "solde", etc.). Si tu nommes une tâche différemment, le stepper peut ne pas la détecter — re-nomme la tâche pour activer la coche verte.
- **Calendar** : seules les **périodes de pose** sont visibles. Les Plaud, commandes et tâches sur le calendar viendront plus tard.
- **Bouton archive** : archive le **chantier** (Statut chantier = Archivé). Le projet reste lié au client, juste replié sous "Voir N projet(s) archivé(s)".

---

## 6. Sécurité

- **Session de 30 jours** : tu restes connecté(e) si tu reviens dans le mois.
- **Lockout par compte** : 5 tentatives login échouées = compte verrouillé 15 minutes (toi inclus). Vérifie la casse de ton mot de passe.
- **5 MB max par fichier upload** (limite Airtable).
- **Pas de stockage local** : tout est dans Airtable, tu peux fermer le browser sans souci.

---

## 7. Quand basculer définitivement vers v3 ?

Le plan : la v2 sur `/` reste active tant que vous (Tanguy + Virginie) n'avez pas testé **/v3/** pendant 1 semaine sans nous remonter de bug bloquant.

Quand vous me dites « v3 OK », JMG bascule `/` vers v3, archive l'ancienne version, et la v2 disparaît.

En attendant, vous pouvez **passer d'une version à l'autre** :
- La bannière jaune en haut de la v3 a un lien **« retour cockpit v2 »**
- Pour revenir à v3 depuis v2 : tape `/v3/` dans la barre d'adresse

---

*Guide à jour au 20/05/2026. Si quelque chose n'est pas clair ou ne marche pas → bouton support en bas à droite.*
