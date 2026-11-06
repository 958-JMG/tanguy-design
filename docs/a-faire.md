# Tanguy Design — réalisé et suite

## 6 novembre 2026 · Import Winner · Codex / demande JMG

### ✅ Préparé localement

- Conserver l’ordre des pages et lignes, sans tri numérique global : meubles jusqu’à 503, puis plan 20, panneau 15, électroménager, sanitaire, accessoires 2.1 / 4.2 dans l’exemple de référence.
- Garder les sections et repères, y compris les sous-lignes éloignées de leur parent, les lignes sans code et à montant nul. Une ligne commune « plans et crédences » reste indivisible.
- Séparer les modules et les fournisseurs pour les BC ; afficher distinctement marque/catalogue et fournisseur. Un fournisseur explicitement inconnu ou ambigu n’est jamais remplacé par un choix de grille. Une marque seule ne prouve pas son distributeur.
- Préserver le modèle de la zone concernée, l’identité des lignes, le suivi des lignes non commandées et la ventilation des AR dans les parties de marge existantes.
- Migration additive `scripts/setup-winner-fields.js` : `Ordre Winner` (nombre entier), `Section Winner`, `Fournisseur Winner`, `Marque Winner` (textes). Simulation par défaut ; `--apply` nécessaire pour écrire. Vérification de la cible et des types ; idempotence testée. L’import refuse avant toute création si ces champs ne sont pas lisibles.

### 🧪 Validation locale

- Suite complète Node : **677 tests réussis, 0 échec, 0 ignoré**, puis test ciblé de conservation des catégories fournisseurs réussi, avec environnement vidé des secrets hérités ; vérifications de syntaxe et `git diff --check` réussies.
- Tests de routes : import → détail dans un ordre Airtable inversé → signature → six commandes → aucune des 40 lignes perdue ; refus des sélections manuelles multi-fournisseurs.
- Tests de migration simulée, anciens imports, repères décimaux, homonymes fournisseurs, modèle par zone, marges et PDF.
- Rendu navigateur et PDF vérifiés visuellement sur données fictives. Aucun appel réel à l’IA ni test d’import du document client dans la base de production.

### ✅ Compléments et accord du 6 novembre

- JMG a autorisé la migration additive et la mise en ligne. Les quatre champs Winner sont créés et leur type vérifié en production ; aucun enregistrement client modifié.
- Tâches : raccourci direct pour les administrateurs, Kanban par défaut, préférence Liste/Kanban mémorisée, création/édition avec client et dossier, statut, affectations, priorité et échéance.
- Planning : une réception SAV ouvre le ticket précis ; ticket absent signalé. Recette navigateur fictive réussie, ainsi que création et modification d’une tâche.
- Échéances : nom du client résolu par le projet du devis, puis par le lien Client du devis en repli. L’absence de client reste explicite. Route testée avec données fictives.
- Fournisseurs : colonne Sanitaire indépendante pour les commandes ; ventilation financière historique conservée. Les anciens tags invisibles restent préservés à la sauvegarde. L’option Airtable sera créée au premier cochage enregistré via le `typecast` déjà utilisé par l’API. Aucun fournisseur n’est coché automatiquement.

### ⏳ Mise en ligne autorisée et suite

1. Migration Winner additive : réalisée et vérifiée.
2. Publier la branche, fusionner après revue et déployer ; vérifier la version effectivement servie.
3. Faire la recette d’un nouvel import : ordre, sections, marques/fournisseurs, contenu et destination des bons. La fidélité de la lecture IA reste à vérifier sur un import réel autorisé.
4. Décider séparément de la reprise des anciens imports et BC : le même PDF est dédupliqué, un réimport identique ne répare pas les anciens enregistrements. Ne pas supprimer ni recréer de commandes signées sans plan validé.

**Déploiement prouvé : non. Livraison client confirmée : non. Aucune date de mise en ligne confirmée.**
