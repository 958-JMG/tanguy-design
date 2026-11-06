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

**Premier lot déployé le 6 novembre 2026 et vérifié (`c4e01d1`). Compléments import/Pennylane/échéances : version `8533be0` déployée, santé HTTP 200 et version servie vérifiées. Livraison client confirmée : non.**


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


## 6 novembre 2026 · Équipe, plaques de cuisson, commandes vides · Codex / retours JMG

- Solène n’existe plus dans les comptes actifs ; les listes figées de tâches, RDV, SAV, contacts BC et nouveaux apporteurs sont remplacées par une liste issue des comptes actifs. Les anciennes valeurs restent conservables sur leur fiche avec la mention « ancien ». Les tâches historiques restent visibles dans le groupe Anciens membres. Aucun calcul de rétrocession historique modifié.
- Une case Actif décochée est omise par Airtable : le chargeur la reconnaît désormais comme inactive. La liste d’équipe ne reprend pas les comptes du secours d’environnement. Les nouveaux BC utilisent le contact actif qui les crée, sans ancien prénom par défaut ; les suggestions Plaud ne réaffectent pas un membre absent.
- Nouvelle catégorie **Plaque de cuisson**, conservant l’ordre et la section Winner, avec un badge dans le détail et une colonne fournisseur distincte. Fournisseur explicite prioritaire ; sinon grille Plaque de cuisson uniquement, fournisseur à choisir si absent/ambigu. Aucun fournisseur coché arbitrairement. Les découpes de plan et meubles sous plaque ne changent pas de famille. L’option Airtable est créée au premier enregistrement avec typecast, comme Sanitaire.
- Suppression du forçage d’un bon de plan de travail vide à chaque signature. Les articles réels à prix nul restent conservés dans leurs BC.
- JMG a explicitement demandé la suppression des trois bons Le Maire vides, puis des bons vides des autres dossiers. Audit des **158 commandes** : **50 sans lignes**, dont **38 réellement vides supprimées** après relecture inchangée et sauvegarde locale ; **12 protégées** car AR ou état métier, donc non vides au sens opérationnel. La commande Cuisine Le Maire contenant les articles a été conservée et relue après suppression. Aucun autre dossier supprimé, aucune facture modifiée. Sauvegarde hors dépôt synchronisé : `~/Developer/9-58/Administration/Sauvegardes/tanguy-2026-11-06/commandes-vides-avant-suppression.json` (accès local privé).
- Validation : suite complète **693 tests réussis**, syntaxe et diff contrôlés ; cas membre actif/inactif, case absente, fournisseur plaques distinct, aucun repli électro, préservation des lignes et absence de BC forcé. Recette navigateur fictive : nouvelle tâche propose uniquement l’équipe active. Aucun nouveau devis signé en production pour les tests.
- Déploiement du lot précédent : https://github.com/958-JMG/tanguy-design/actions/runs/42193903681 réussi, version servie `8533be0f7173`. Dernier complément équipe/plaques : PR #144 fusionnée, déploiement [42195941962](https://github.com/958-JMG/tanguy-design/actions/runs/42195941962) réussi ; version applicative `91f0d1ae67fa` et santé HTTP 200 vérifiées le 06/11/2026. Livraison client confirmée : non.


### ✅ État final vérifié — 6 novembre 2026

- Les trois lots sont en production : Winner/Kanban/SAV/Sanitaire (#142), prix/éco/recherche/attente/annexe Pennylane/échéances signées (#143), équipe active/plaques/fin des BC vides (#144). Version servie : `91f0d1ae67fa`.
- 38 commandes vides supprimées sur autorisation explicite, 120 restantes. Sauvegarde avant suppression et manifeste de vérification conservés localement hors Git. Aucune commande renseignée, facture ou AR supprimé.
- 693 tests passent dans la chaîne de livraison, contrôles locaux navigateur/PDF sur données fictives effectués. Recette métier réelle IA et annexe Pennylane restant à faire ; aucun gain de vitesse mesuré sur un PDF client réel annoncé.
- Les historiques de personnes, les anciens montants et les anciens imports ne sont pas réécrits. Fournisseurs des colonnes Sanitaire/Plaque de cuisson à renseigner selon le choix métier. Aucun envoi client.
