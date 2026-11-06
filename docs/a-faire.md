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


### ✅ État vérifié avant retour Devis express — 6 novembre 2026

- Les trois lots sont en production : Winner/Kanban/SAV/Sanitaire (#142), prix/éco/recherche/attente/annexe Pennylane/échéances signées (#143), équipe active/plaques/fin des BC vides (#144). Version servie : `91f0d1ae67fa`.
- 38 commandes vides supprimées sur autorisation explicite, 120 restantes. Sauvegarde avant suppression et manifeste de vérification conservés localement hors Git. Aucune commande renseignée, facture ou AR supprimé.
- 693 tests passent dans la chaîne de livraison, contrôles locaux navigateur/PDF sur données fictives effectués. Recette métier réelle IA et annexe Pennylane restant à faire ; aucun gain de vitesse mesuré sur un PDF client réel annoncé.
- Les historiques de personnes, les anciens montants et les anciens imports ne sont pas réécrits. Fournisseurs des colonnes Sanitaire/Plaque de cuisson à renseigner selon le choix métier. Aucun envoi client.

### 🔧 Régression Devis express → ligne éco Pennylane — 6 novembre 2026

- Signalement JMG confirmé sur les données du dossier indiqué : le descriptif du nouveau brouillon contient les panneaux et leurs dimensions, mais le montant d’éco est absent. La passe précédente avait retiré le report initial du calcul ; le tableau seul ne suffisait plus à alimenter le devis.
- Report automatique rétabli quand le document n’indique pas déjà un montant d’éco, puis recalcul après modification des pièces. Un montant explicite ou saisi à la main reste prioritaire ; « Reporter » permet de revenir au calcul des pièces.
- Création bloquée pendant le calcul, en cas de données manquantes ou d’échec du calcul automatique. Une ancienne réponse ne peut plus écraser une nouvelle saisie. Tableau placé avant le descriptif et le bouton de création, état du report visible près du prix.
- Nomenclatures Novamobili/Metron et documents de panneaux relus avec le PDF visuel pour conserver les colonnes. Instruction renforcée : composants présents dans le descriptif également attendus dans les pièces éco, même sans prix par ligne. Une épaisseur explicitement inconnue reste à compléter.
- Validation : **702 tests réussis, 0 échec, 0 ignoré**. Parcours simulé panneaux → barème → report automatique → création Express → une seule ligne éco Pennylane, montant et total préservés pour éco incluse/exclue. Tests de réponses obsolètes, saisie prioritaire, dimensions absentes et panne réseau. Recette navigateur fictive : 4 tablettes donnent 2,88 € HT, 8 donnent 5,76 €, dimension effacée bloque la création ; inclusion inconnue reste à confirmer.
- Le PDF source du cas signalé n’a pas été retrouvé dans les fichiers locaux/hub consultés ; aucune lecture IA réelle rejouée et aucun montant historique copié dans le nouveau brouillon. Reprendre ce brouillon avec les pièces du PDF source lors de la recette métier, sans recréer un devis Pennylane déjà existant.
- Mise en ligne du correctif : PR #145 fusionnée, version `a943689220681464d37849670cbe243cba685d28`. Déploiement [42198183674](https://github.com/958-JMG/tanguy-design/actions/runs/42198183674) réussi après 702 tests ; santé HTTP 200 et `/login` servant `a94368922068` vérifiés le 06/11/2026 à 09:53 UTC. Recette métier du PDF source et reprise éventuelle du brouillon toujours à faire. Aucun envoi client.

### 🔧 CTA « Créer le devis client » — retour JMG du 6 novembre 2026

- Le bouton était désactivé tant que l’éco restait à confirmer ou son calcul incomplet : cliquer n’apportait aucune explication. Il reste maintenant accessible et, si les données sont incomplètes, affiche le motif près du prix et du CTA puis déplace le focus sur le champ concerné. Aucune création invalide n’est autorisée ; contrôle serveur conservé.
- Dans la fenêtre de création, un projet/client manquant et un échec serveur restent affichés. Fermeture et doubles clics neutralisés pendant la requête. Sur la fiche créée, l’action Pennylane devient visuellement prioritaire.
- **703 tests réussis**, syntaxe et diff contrôlés. Recette navigateur sur données fictives : clic avec éco non confirmée → focus sur son choix ; confirmation → modale ; projet manquant → message ; choix projet → devis créé et fiche ouverte ; bouton Pennylane → création simulée avec éco et annexe. Aucun devis client réel créé et aucun email envoyé.
- PR #147 fusionnée et déployée : workflow [42201217918](https://github.com/958-JMG/tanguy-design/actions/runs/42201217918) réussi ; version `6421c2ca56af` et santé HTTP 200 vérifiées le 06/11 à 10:18 UTC.

### 🔧 Analyse longue / « Failed to fetch » — 6 novembre 2026

- JMG constate un échec après plus de cinq minutes. Lecture de la configuration réelle : conteneur Tanguy `e5df4178-a619-43e3-8808-9009986bc837`, délai **300 secondes**, état ready. Ce plafond correspond à la durée signalée ; faute d’accès aux logs Cockpit, l’interruption précise de cette requête n’est pas prouvée. Le déploiement #147 a également remplacé l’instance vers 10:16 UTC.
- Délai de requête porté à **900 secondes dans le workflow**, avec vérification de sa valeur dans le smoke test. L’analyse fournisseur utilise le flux Anthropic, borné à **8 minutes** avec annulation réelle et sans les deux relances implicites du SDK ; les autres appels IA conservent leur comportement. Une réponse tronquée n’est ni acceptée ni mise en cache.
- Coupure réseau au départ ou pendant la lecture de la réponse : message compréhensible, PDF conservé uniquement dans la mémoire de l’onglet et bouton **Réessayer l’analyse**, sans création de devis ni relance automatique. Session expirée et erreur serveur sont distinguées.
- Validation : **711 tests réussis**, dont flux SSE avec le SDK installé contre un serveur local fictif, annulation au délai, erreur après keep-alive, coupure du corps, 504 et session expirée. Recette navigateur : coupure forcée puis reprise réussie avec le même fichier sans le sélectionner à nouveau. Aucun appel IA réel ni nouveau devis client de production.
- Documentation primaire consultée : [Scaleway, durée des requêtes](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/) et [Anthropic, streaming et délais du SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript). La correction vise l’interruption et la reprise ; aucun gain de vitesse mesuré sur le PDF client n’est annoncé.
- PR #148 fusionnée et déployée : version `4a3699772ee971a247abb19f3e668d92adbf4712`, workflow [42203103175](https://github.com/958-JMG/tanguy-design/actions/runs/42203103175) réussi après 711 tests et contrôle du délai. `/api/health` HTTP 200 et `/login` servant `4a3699772ee9` vérifiés le 06/11 à 10:35 UTC ; configuration Scaleway relue à 900 secondes, conteneur ready sur cette image. Rechargement puis nouveau dépôt du PDF proposés à JMG ; résultat métier du document client encore à confirmer. Aucun devis réel créé pendant les tests.

### ✅ Import Le Guennec confirmé / annexe Pennylane — retour suivant du 6 novembre 2026

- JMG confirme que le nouvel import fonctionne et signale le descriptif apparemment absent de Pennylane. Contrôle réel en lecture seule : le devis cockpit `EXP-2026-010` correspond au devis Pennylane `D-2026-11-27`. Son annexe descriptive était déjà jointe le 06/11 à 11:40 (Europe/Paris). PDF récupéré depuis la liste des annexes Pennylane : **deux pages, 67 repères, aucun repère manquant**, pages rendues et vérifiées. Aucune annexe recréée, aucun devis modifié ni email envoyé pendant ce contrôle.
- L’annexe est un document PDF distinct du PDF commercial. La documentation [Pennylane sur l’envoi des devis](https://help.pennylane.com/fr/articles/18740-envoyer-des-factures-et-des-devis) décrit sa présence en pièce jointe lors de l’envoi ; présence et sélection à vérifier dans la fenêtre d’envoi. L’envoi réel au client n’a pas été effectué ni validé ici.
- La fiche cockpit contrôle maintenant la présence de la **version actuelle** du descriptif via l’API Pennylane et affiche une confirmation persistante, une absence ou un échec de vérification. Après ajout manuel, le statut est relu ; les réponses obsolètes sont ignorées. Aucune écriture depuis ce contrôle. La mention « pas encore envoyé » est retirée du bandeau permanent, car le cockpit ne suit pas les envois manuels Pennylane.
- **716 tests réussis**, dont présence exacte, version modifiée, refus 403, pagination et absence d’écriture lors du contrôle. Recette navigateur fictive : présent, absent puis ajouté, panne explicitement signalée. PR #150 fusionnée et déployée : workflow [42205802593](https://github.com/958-JMG/tanguy-design/actions/runs/42205802593) réussi ; santé HTTP 200 et version servie `4ab791bf31b1` vérifiées le 06/11 à 11:52 Europe/Paris. L’annexe réelle est vérifiée indépendamment de la recette fictive ; sélection dans la fenêtre d’envoi et livraison au client non testées.
