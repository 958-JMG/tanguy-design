# Retours SAV persistants

Les réponses de résolution n8n étaient conservées dans une Map du processus. Avec plusieurs conteneurs (jusqu'à cinq), une réponse pouvait disparaître ou être présentée comme non lue après lecture. Le navigateur masquait aussi une réponse même si le serveur avait refusé son marquage.

Le correctif utilise une table indépendante Airtable SAV_Notifications. Créer avant le déploiement ces champs, noms exacts : Event Key (primaire texte), Recipient, Ticket, Status, Title (texte), Message (texte long), Read (case à cocher décochée par défaut). Le PAT et la base existants sont réutilisés, aucun secret ajouté. Les anciennes notifications en mémoire ne sont pas migrables de façon fiable. En cas de table manquante ou fournisseur indisponible, une erreur 503 remonte et le navigateur conserve la notification.

Le contrat des routes et la charte restent identiques. Upsert par clé de contenu canonique, jamais de remise à zéro de Read. Compte destinataire actif contrôlé au callback, lectures et marquages limités à la session, cache désactivé, erreurs fournisseur sans secret. Lecture des 30 derniers jours. Les devis, projets, documents et flux Pennylane restent inchangés.

648 tests locaux passent, y compris les nouveaux tests de double instance, répétition d'un callback, isolation entre utilisateurs, erreurs HTTP et badge obsolète. Les fournisseurs sont simulés dans ces tests. La recette réelle après déploiement doit envoyer un retour SAV fictif au seul compte de test, le lire, recharger et renvoyer le même callback pour prouver l'absence de doublon.

Fusion et déploiement après go nommé JMG. Retour arrière : image 281a60b9a08e482d4ba4f43304b9df1876b59a24 ; conserver la nouvelle table, aucun autre schéma modifié. L'ancienne image réintroduirait la volatilité du SAV.

## Adresse du devis Pennylane

Le PDF réel du devis fictif D-2026-10-23 a révélé un second défaut : les champs CP et Ville de la fiche étaient ignorés. Le correctif les transmet à la création d’un nouveau client Pennylane, avec repli sur le format historique multiligne. Aucun client Pennylane existant n’est modifié automatiquement. Les compléments de rue sont préservés. Quatre tests couvrent ces formats et le refus d’une adresse absente. La recette après déploiement doit utiliser un nouveau client fictif pour vérifier cette création.
