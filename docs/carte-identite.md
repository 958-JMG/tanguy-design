# Tanguy Design — état partagé

- **Projet** : cockpit Tanguy Design, `958-JMG/tanguy-design` ; production : https://tanguydesign.958.fr.
- **6 novembre 2026 · Codex · demande JMG** : correctif préparé sur `fix/winner-ordre-modules`, depuis `origin/main` `389bc56`. Copie de travail isolée sous `~/Developer/9-58/Travaux/tanguy-winner-20261106` ; branche de pose préservée dans le dépôt principal.
- **Réalisé** : ordre de lecture Winner persisté indépendamment des repères ; sections, fournisseurs explicites et marques conservés ; affichage dans le déroulé du PDF ; commandes séparées par module et fournisseur ; ordre du BC conservé en HTML/PDF ; identité des lignes conservée pour le suivi des commandes et des marges.
- **Vérifications** : référence PDF utilisateur lue localement. Tests automatisés avec 40 articles fictifs, Airtable/Pennylane simulés et lecture IA simulée ; contrôle visuel du rendu navigateur et d’un BC PDF fictif. Résultat final détaillé dans `a-faire.md`.
- **Accord JMG confirmé** : création des quatre champs Winner, publication et déploiement autorisés dans la conversation du 6 novembre. Les quatre champs ont été créés et vérifiés dans la base Tanguy de production (aucun enregistrement client modifié). Publication et déploiement en cours ; preuve à compléter. Aucun envoi client.
- **Limite** : l’ordre source des anciens imports n’existe pas en base. Leur affichage signale ce manque ; aucune réécriture automatique des anciens devis ou commandes signées. La lecture IA du vrai PDF n’a pas été rejouée.
- **Compléments demandés** : accès direct aux tâches, Kanban par défaut, création/édition et désassignation ; ticket SAV ouvert depuis le planning ; client sur les échéances en retard ; colonne Sanitaire utilisée pour le routage fournisseurs. Droits d’accès existants conservés.
- **Prochaine action** : CI distante, fusion, déploiement et vérification de la version servie.
