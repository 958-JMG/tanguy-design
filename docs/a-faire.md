# Tanguy Design — réalisé et suite

## 6 novembre 2026 · Import Winner · Codex / demande JMG

### ✅ Préparé localement

- Conserver l’ordre des pages et lignes, sans tri numérique global : meubles jusqu’à 503, puis plan 20, panneau 15, électroménager, sanitaire, accessoires 2.1 / 4.2 dans l’exemple de référence.
- Garder les sections et repères, y compris les sous-lignes éloignées de leur parent, les lignes sans code et à montant nul. Une ligne commune « plans et crédences » reste indivisible.
- Séparer les modules et les fournisseurs pour les BC ; afficher distinctement marque/catalogue et fournisseur. Un fournisseur explicitement inconnu ou ambigu n’est jamais remplacé par un choix de grille. Une marque seule ne prouve pas son distributeur.
- Préserver le modèle de la zone concernée, l’identité des lignes, le suivi des lignes non commandées et la ventilation des AR dans les parties de marge existantes.
- Migration additive `scripts/setup-winner-fields.js` : `Ordre Winner` (nombre entier), `Section Winner`, `Fournisseur Winner`, `Marque Winner` (textes). Simulation par défaut ; `--apply` nécessaire pour écrire. Vérification de la cible et des types ; idempotence testée. L’import refuse avant toute création si ces champs ne sont pas lisibles.

### 🧪 Validation locale

- Suite complète Node : **678 tests réussis, 0 échec, 0 ignoré** dans la CI de la PR #142 (42189759317), avec environnement vidé des secrets hérités ; vérifications de syntaxe et `git diff --check` réussies.
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
2. PR #142 publiée et fusionnée (`c4e01d1`), CI verte. Déploiement #42189909389 réussi : version `c4e01d19e2a1` et santé HTTP 200 vérifiées. Correctif complémentaire du menu tablette : la variable CSS des liens admin est explicitement activée pour les administrateurs. Contrôle de cette dernière version à compléter.
3. Faire la recette d’un nouvel import : ordre, sections, marques/fournisseurs, contenu et destination des bons. La fidélité de la lecture IA reste à vérifier sur un import réel autorisé.
4. Décider séparément de la reprise des anciens imports et BC : le même PDF est dédupliqué, un réimport identique ne répare pas les anciens enregistrements. Ne pas supprimer ni recréer de commandes signées sans plan validé.

**Premier lot déployé le 6 novembre 2026 et vérifié (`c4e01d1`). Compléments ci-dessous : publication en cours. Livraison client confirmée : non.**


## 6 novembre 2026 · Compléments import et Pennylane · Codex / retours JMG

- Prix du document traité comme **vente HT**, sans coefficient ; prix d’achat facultatif distinct. Éco explicitement incluse ou ajoutée une seule fois. Contrôle identique dans l’écran et côté serveur ; ambiguïté bloquée avant création. Le calcul des panneaux ne remplace plus automatiquement l’éco lue.
- Recherche des projets par référence et nom client, insensible aux accents ; disponible en devis fournisseur et FINDIS.
- Animation dès le dépôt, temps écoulé réel, protection contre le double dépôt. Résultat fournisseur retrouvé après navigation. Animation également sur les imports Winner et FINDIS.
- Lecture locale des PDF textuels avant analyse ; repli au PDF pour les pages peu lisibles/scannées. Suppression des consultations de grille marge/forfait éco devenues inutiles. Résultats en mémoire dix minutes (8 fichiers maximum), appels simultanés du même fichier mutualisés ; échecs non mémorisés. Aucun gain chiffré promis sans mesure sur les documents réels.
- Descriptif technique complet relisible et modifiable avant création ; conservé dans la désignation. PDF annexe sans reprise des champs prix d’achat, marges ou notes internes, ordre Winner conservé. Téléchargement local disponible.
- Pennylane : ajout au devis via `POST /api/external/v2/quotes/{id}/appendices`, scope `quotes:all`. Vérification préalable de l’empreinte dans le nom du fichier, pagination et protection contre les reprises. Échec signalé sans recréer le devis ; bouton « Joindre le descriptif » pour réessayer. Aucun email automatique.
- Sources API officielles vérifiées : https://pennylane.readme.io/reference/postquoteappendices et https://pennylane.readme.io/reference/getquoteappendices (schémas OpenAPI inclus dans leurs versions `.md`).
- Validation : **687 tests complets réussis**, dont prix/éco aux coefficients 1/2/3, recalcul serveur, descriptif > 1000 caractères, annexe et reprise sans doublon, refus API explicite et recherche projet. Recette navigateur avec API fictive : attente visible, prix inclus/exclus, recherche sans résultat puis sélection. Trois pages d’annexe PDF fictive rendues et vérifiées.
- Limites : lecture IA réelle et autorisation effective de l’annexe avec le jeton Pennylane de production à confirmer lors de la recette métier. Aucun ancien montant recalculé, aucun ancien devis Pennylane modifié par ces tests. Le descriptif anciennement perdu à l’import ne peut pas être recréé sans sa source.


## 6 novembre 2026 · Échéances avant signature · Codex / retour JMG

- Cause confirmée par lecture des données du dossier signalé : deux devis non signés et six échéances importées à la date du devis, sans facture liée. L’ancien calcul retenait uniquement la date passée. Aucun enregistrement client modifié.
- Les échéances à facturer et les encaissements prévisionnels du plan de trésorerie exigent maintenant un devis au statut **Signé**. Les brouillons, devis présentés, en attente, refusés et liens manquants sont exclus. La route de création de facture depuis une échéance refuse également un devis non signé.
- Les factures déjà émises restent suivies indépendamment du statut commercial ; aucune suppression de pièce ou modification comptable.
- Validation complète après ces changements : **690 tests réussis, 0 échec, 0 ignoré**. Cas signés, non signés, lien absent, protection de la création et absence de doublon vérifiés avec données fictives. Recette navigateur : l’import en cours et son temps écoulé sont retrouvés après navigation.
