# Tanguy Design — état partagé

- **Projet** : cockpit Tanguy Design, `958-JMG/tanguy-design` ; production : https://tanguydesign.958.fr.
- **6 novembre 2026 · Codex · demande JMG** : correctif préparé sur `fix/winner-ordre-modules`, depuis `origin/main` `389bc56`. Copie de travail isolée sous `~/Developer/9-58/Travaux/tanguy-winner-20261106` ; branche de pose préservée dans le dépôt principal.
- **Réalisé** : ordre de lecture Winner persisté indépendamment des repères ; sections, fournisseurs explicites et marques conservés ; affichage dans le déroulé du PDF ; commandes séparées par module et fournisseur ; ordre du BC conservé en HTML/PDF ; identité des lignes conservée pour le suivi des commandes et des marges.
- **Vérifications** : référence PDF utilisateur lue localement. Tests automatisés avec 40 articles fictifs, Airtable/Pennylane simulés et lecture IA simulée ; contrôle visuel du rendu navigateur et d’un BC PDF fictif. Résultat final détaillé dans `a-faire.md`.
- **Production / livraison** : aucun push, déploiement, changement de base client ou envoi client effectué par cette intervention. Le correctif local n’est pas encore visible par Pilotage sur le `main` distant.
- **Limite** : l’ordre source des anciens imports n’existe pas en base. Leur affichage signale ce manque ; aucune réécriture automatique des anciens devis ou commandes signées. La lecture IA du vrai PDF n’a pas été rejouée.
- **Prochaine action** : revue, autorisation de mise en ligne, création additive des quatre champs Winner puis déploiement et recette fonctionnelle.
