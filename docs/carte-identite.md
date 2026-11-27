# Tanguy Design — état partagé

## 27 novembre 2026 — Correction Devis express publiée · Codex / Claude

- **En ligne** : PR165 fusionnée sur accord explicite de JMG ; image `63a18c759e1ccf2ec7ea1a206bb0a664535f2cd1` servie, déploiement GitHub `46061228146` réussi, santé HTTP200. Contrôle de l’accès import sans connexion : HTTP401.
- **Recette réelle après publication, vers 21 h 08 Paris** : session Safari de JMG, import du classeur fictif qui reproduisait l’erreur des notes Excel ; référence `0000123`, 10 HT / 12 TTC conservés, « Les totaux correspondent au document ». Aucun devis créé ; formulaire vidé après l’essai. Tests précédents : 762 verts et Chromium/WebKit en local. Relecture Claude **ok**, compétence commune disponible.
- **Suivi** : demande SAV et tâche existantes marquées publiées/vérifiées dans Pilotage avec preuve du déploiement ; aucun doublon, historique de mission conservé. Aucun message envoyé au client.
- **Limites** : fichier réel de Virginie non examiné, téléphone physique non testé. Réception et validation par la cliente non confirmées. Il s’agit de la correction SAV, pas d’une nouvelle livraison complète du cockpit.
- **Passation** : Codex, `codex/tanguy-publication-suivi-20261127`, documentation seule. Preuves conservées dans le dossier voisin suffixé `-preuves`. Aucun changement métier supplémentaire.


## 27 novembre 2026 — Correction Devis express prête à intégrer · Codex / Claude

- **Résultat** : import Excel corrigé pour les liens de notes que le lecteur ExcelJS ne reconnaît pas. Références et montants conservés ; aucune création de devis pendant la recette.
- **Relecture croisée** : accord JMG enregistré dans Pilotage ; Claude a validé le code `a3b54f7`. Compétence commune préparée dans `425d7f2`, avec points d’entrée Claude et Codex. Même tâche SAV, mission `2d1bef55-b2bc-432f-9b26-6083db19d947`, état terminé pour le code seulement.
- **Vérifié ensuite sur Mac** : 762 tests verts ; erreur « comments » reproduite sur l’ancien code avec un fichier fictif, absente après correction ; import HTTP réel local et parcours Chromium 1280 px / WebKit 390 px, référence 0000123 et totaux 10 HT / 12 TTC conservés. Aucune écriture client ni envoi. Preuves dans le dossier voisin `tanguy-recette-urgence-20261127-preuves`.
- **Limites** : fichier réel de Virginie non examiné, iPhone physique non testé. WebKit essayé sur serveur local HTTP avec la seule directive de montée HTTPS retirée dans le banc navigateur ; politique de production inchangée. ExcelJS reste figé en 4.4.0 ; relancer la régression avant toute mise à jour.
- **À faire** : revue de la demande de fusion puis publication sur accord JMG et contrôle réel après publication. Aucun déploiement, aucune livraison ni notification client à ce stade. Branche `codex/tanguy-recette-urgence-20261127` préparée pour GitHub ; historique agent conservé.


## 27 novembre 2026 — Import Excel du Devis express · Codex

- SAV existant `tk_16d0fded-477e-42bd-afc3-ab0ba7e1b58e` conservé. Erreur `reading 'comments'` reproduite avec un classeur fictif dont le lien interne vers une note est absolu. Le lecteur ignore désormais les liens vers les notes Excel avant de lire les cellules du devis.
- Vérifié sur données fictives : 7 tests de lecture, dont la comparaison intégrale des résultats avec et sans note, et 3 tests simulés de transport de l’analyse fournisseur. Le banc HTTP local est bloqué par `listen EPERM`. Aucune recette navigateur ni capture PNG disponible.
- Correctif local uniquement. Aucun push, déploiement, envoi ou livraison client confirmée.

## 18 novembre 2026 — Cache vérifié et PDF envoyés à Virginie · Codex

- Les deux anciennes URLs du descriptif signalé ne servent plus de copie en cache : HTTP401 sans connexion, HTTP200 avec la bonne annexe, puis HTTP401 après téléchargement. En-tête `private, no-store`, CDN BYPASS ; nouveau lien DYNAMIC. Neuf contrôles réels réussis et annexe Pennylane actuelle toujours jointe.
- La purge manuelle demandée le 17/11 n’est donc plus nécessaire ; aucune purge Cloudflare réalisée ni aucun droit élargi. Connexion de JMG à Cloudflare devenue inutile. Aucune nouvelle régénération, aucun montant ou calcul modifié. Version applicative `317ceec6d67a` inchangée.
- Preuve privée : `Travaux/tanguy-descriptifs-20261117-preuves/cache-cloture-20261118.json`. Mail envoyé sur demande de JMG à Virginie le 18/11 à 07:52 Europe/Paris, en réponse à « Devis et descriptif » du 17/11. Présence dans Envoyés et deux pièces jointes vérifiées : `Devis-MECHIN-D-2026-11-36.pdf` et `Descriptif-MECHIN-IMP-2026-016.pdf`. Montants inchangés rappelés dans le message.

- **Attente client** : Virginie doit confirmer la finition du plan de travail (résumé « Chianca di Ostuni » / repère 24 « Travertino Chiaro »). Libellés source conservés ; recette client et réception du mail non confirmées.
- **Passation** : Codex, branche `codex/tanguy-cache-cloture-20261118` ; documentation seule, `git diff --check` valide. Aucun nouveau déploiement applicatif.

## 17 novembre 2026 — Livraison vérifiée · Codex

- **En ligne** : PR161 puis PR162, version applicative finale `317ceec6d67a1494a181401669c498b12520695c`, déploiement [44124503881](https://github.com/958-JMG/tanguy-design/actions/runs/44124503881) réussi après **761 tests**. Disponibilité, version et lien de téléchargement publiés contrôlés.
- **Devis demandé** : régénération effectuée une seule fois ; nouveau numéro **D-2026-11-36**, lié à la même fiche `IMP-2026-016`, au même client et au même projet. Annexe actuelle jointe, ancien devis D-2026-11-35 conservé. Aucun envoi client.
- **Contrôle réel** : 33 lignes, références, prestations, remises, TVA, HT/TTC et échéances inchangés avant/après ; réconciliation 0,00 €. PDF officiel Pennylane sur une page et descriptif sur huit pages relus visuellement. Le détail chiffré de l’annexe est textuellement identique ; seules les mentions demandées ont été retirées. Sources et copies avant/après conservées hors dépôt.
- **Téléchargement** : nouveau lien sans extension, réponse `private, no-store`, CDN DYNAMIC ; accès anonyme HTTP401 avant et après téléchargement authentifié. L’ancien chemin, lorsqu’il atteint l’application, est également protégé (CDN BYPASS). Fichier reçu par le nouveau bouton identique aux huit pages relues.
- **Reste technique distinct** : purge de deux anciennes URLs conservées par le CDN. La clé Cloudflare disponible refuse cette opération (HTTP401), sans élargissement de droits ; connexion de JMG demandée dans Safari pour terminer. Le bouton actuel sert déjà le bon document avec connexion obligatoire. Ne pas déclarer cette purge terminée sans preuve.
- **Passation** : branche `codex/tanguy-descriptifs-cloture-20261117`, preuves privées `Travaux/tanguy-descriptifs-20261117-preuves`. Recette client non confirmée ; aucun message envoyé. PDF finaux préparés pour JMG après contrôle.

## 17 novembre 2026 — Livraison et téléchargement du descriptif · Codex

- Accord JMG : mise en ligne et régénération du devis signalé. PR161 déployée en `f541ac20cf38`, workflow44122648699 réussi, disponibilité et version vérifiées. Nouveau devis Pennylane créé une seule fois avec annexe jointe, sans avertissement ; ancien devis conservé, aucun envoi. Comparaison de la base : lignes, liens, remises, TVA, HT et TTC inchangés, réconciliation à 0,00 €.
- Contrôle réel : l’ancienne URL du descriptif PDF était conservée par le CDN et pouvait renvoyer le fichier sans connexion. Correctif complémentaire : lien sans extension, `private, no-store` avant l’authentification pour l’ancien et le nouveau chemin. Purge ciblée et contrôle final de production à terminer.
- Vérifications locales du complément : **761 tests réussis**, 0 échec/ignoré. Téléchargement authentifié puis refus anonyme contrôlés sur les deux routes. Branche `codex/tanguy-descriptifs-livraison-20261117` ; aucun changement de calcul. Preuves privées dans `Travaux/tanguy-descriptifs-20261117-preuves`.

## 17 novembre 2026 — Affichage devis et descriptif · Codex

- **Demande confirmée** : retirer les passages surlignés orange de l’affichage ; conserver tous les montants et calculs.
- **Préparé localement** : renvoi lisible au descriptif par numéro de devis, sans empreinte technique ni liste « Hors ensemble » répétée/tronquée ; remise article nulle et mention « Déjà déduites du total » retirées du résumé Pennylane ; remise globale et remises article positives conservées. Dans l’annexe, code de version masqué et rappel final standard livraison/pose/éco/remise retiré du seul descriptif général. Les variantes contenant une précision supplémentaire restent intactes.
- **Conservation** : aucune modification des sources, lignes, références, prix, TVA, remises ou éco. Version interne et contrôle de la bonne annexe maintenus. Les devis déjà liés gardent leur ancien rendu ; une création/régénération explicite passe au nouveau, sans modifier l’ancienne pièce jointe.
- **Vérifié** : 760 tests réussis, 0 échec/ignoré ; création, absence de doublon, ancien rendu puis régénération, refus d’annexe décalée, préservation des montants et liens testés avec Airtable/Pennylane fictifs. PDF fictif rendu et relu visuellement ; syntaxe et `git diff --check` valides. Le test historique de planning échouait aussi sur main après le 16/11 ; son horloge est désormais figée au jour de la recette, sans changement du planning métier.
- **État** : branche `codex/tanguy-descriptifs-20261117`, worktree `/Users/jmg/Developer/9-58/Travaux/tanguy-descriptifs-20261117`, non poussée. Aucun déploiement, aucune mutation de production, aucun envoi ni livraison client confirmée. Preuves locales : dossier voisin `tanguy-descriptifs-20261117-preuves`.
- **Suite** : accord de publication, CI et déploiement puis régénération explicite du devis signalé et relecture du PDF officiel Pennylane. Aucun devis existant n’a été remplacé pendant la préparation.

## 16 novembre 2026 — Devis détaillés PDF / Excel · Codex

- **Livré avec accord JMG** : PR157, PR158 et PR[159](https://github.com/958-JMG/tanguy-design/pull/159) fusionnées. Version finale `466444490b64` déployée par le [workflow 43829061810](https://github.com/958-JMG/tanguy-design/actions/runs/43829061810), 756 tests réussis ; disponibilité et version vérifiées à 09:12 Europe/Paris. Champ `Détail import` ajouté dans la base Tanguy, types et liens clients/projets/devis vérifiés. Aucun enregistrement client modifié.
- **Fonctionnement** : références complètes, descriptifs, remises article/globale, éco et contrôles HT/TVA/TTC ; reprise des imports interrompus ; annexe versionnée citée dans le devis Pennylane et contrôlée avant signature/téléchargement.
- **Vérifications** : 745 tests au premier déploiement ; CSV et XLSX fictifs relus sur le site publié avec références, remises et totaux conformes ; accès anonyme refusé. Parcours complet et annexe Pennylane vérifiés localement avec services simulés, bureau/mobile et PDF rendus.
- **Essais des PDF fournis** : lecture IA réelle effectuée en production, sans créer de devis. Mobilier : 33 lignes, références présentes et montants conformes ; six prestations/sur-mesure sans référence dans la source restent à confirmer. Électroménager : 10 lignes, remise article et globale correctement lues ; doublage de la ventilation éco détecté et bloqué. Complément ciblé : dédoublage de cette seule ventilation si les équations au centime et la répartition TVA le prouvent, sans changer les prix ni les descriptifs. Complément PR [158](https://github.com/958-JMG/tanguy-design/pull/158) déployé (`215728179fce`, [workflow 43828334966](https://github.com/958-JMG/tanguy-design/actions/runs/43828334966), 755 tests réussis). Nouvelle lecture IA du PDF électroménager sur cette version : 10 lignes, aucun écart, deux remises et éco conformes.
- **Téléchargement du modèle** : dernière vérification révélant une mise en cache du seul modèle vide par le CDN ; lien sans extension et réponse privée non conservable ajoutés. Aucun document client concerné. Correction déployée et contrôlée : téléchargement administrateur HTTP200, nouvelle requête sans connexion HTTP401, réponse `private, no-store`, CDN DYNAMIC, lien de l’écran conforme. Syntaxe et diff valides.
- **Reste client** : essai du véritable fichier Excel (non reçu) et validation d'un nouveau devis commercial/annexe avant envoi ; aucune reprise automatique des anciens devis. Aucun message client envoyé ; recette client non confirmée. Preuves privées : `Travaux/tanguy-import-detail-20261116-preuves`. [Note détaillée](import-detail-2026-11-16.md).

- **Projet** : cockpit Tanguy Design, `958-JMG/tanguy-design` ; production : https://tanguydesign.958.fr.
- **6 novembre 2026 · Codex · demande JMG** : correctif préparé sur `fix/winner-ordre-modules`, depuis `origin/main` `389bc56`. Copie de travail isolée sous `~/Developer/9-58/Travaux/tanguy-winner-20261106` ; branche de pose préservée dans le dépôt principal.
- **Réalisé** : ordre de lecture Winner persisté indépendamment des repères ; sections, fournisseurs explicites et marques conservés ; affichage dans le déroulé du PDF ; commandes séparées par module et fournisseur ; ordre du BC conservé en HTML/PDF ; identité des lignes conservée pour le suivi des commandes et des marges.
- **Vérifications** : référence PDF utilisateur lue localement. Tests automatisés avec 40 articles fictifs, Airtable/Pennylane simulés et lecture IA simulée ; contrôle visuel du rendu navigateur et d’un BC PDF fictif. Résultat final détaillé dans `a-faire.md`.
- **Accord JMG confirmé** : création des quatre champs Winner, publication et déploiement autorisés dans la conversation du 6 novembre. Les quatre champs ont été créés et vérifiés dans la base Tanguy de production (aucun enregistrement client modifié). PR #142 fusionnée après CI verte (678 tests). Version `c4e01d1` déployée et vérifiée (santé HTTP 200). PR #143 fusionnée et déployée (`8533be0`) : santé HTTP 200 et version `8533be0f7173` vérifiées. Aucun envoi client.
- **Limite** : l’ordre source des anciens imports n’existe pas en base. Leur affichage signale ce manque ; aucune réécriture automatique des anciens devis ou commandes signées. La lecture IA du vrai PDF n’a pas été rejouée.
- **Compléments demandés** : accès direct aux tâches, Kanban par défaut, création/édition et désassignation ; ticket SAV ouvert depuis le planning ; client sur les échéances en retard ; colonne Sanitaire utilisée pour le routage fournisseurs. Droits d’accès existants conservés.
- **Prochaine action** : recette métier d’un nouvel import réel et de son annexe Pennylane ; ne pas reprendre les anciens devis signés automatiquement.

- **Derniers retours JMG** : prix de vente HT conservé sans coefficient, éco incluse/exclue explicite, achat jamais déduit de la vente ; recherche projet/client ; attente animée et optimisation lecture PDF/cache ; annexe descriptive complète générée et joignable au devis Pennylane. 690 tests complets réussis, recette navigateur et trois pages PDF fictives vérifiées. Aucun test de mutation en production.

- **Devis non signés / relances** : contrôle en lecture du cas signalé par JMG ; les échéances étaient considérées dues sur leur seule date. Filtre strict sur le statut Signé pour les échéances à facturer et la trésorerie, refus serveur de facturer une échéance non signée. Aucun statut ni date client modifiés.

- **Nouveau complément du 6 novembre** : équipe proposée depuis les comptes actifs (case Airtable décochée correctement reconnue), fin des contacts Solène par défaut ; historique conservé. Plaque de cuisson : catégorie et colonne fournisseur distinctes, sans repli sur Électroménager/FINDIS. Aucun BC sans ligne créé à la signature. **693 tests réussis** ; choix de personnes vérifié visuellement sur données fictives.
- **Nettoyage production autorisé par JMG** : 158 commandes contrôlées, 38 bons automatiques réellement vides sauvegardés localement puis supprimés, dont trois Le Maire. Vérification de disparition effectuée ; la commande Cuisine réelle de Le Maire est conservée. Douze bons sans lignes mais avec AR/état métier conservés. Aucun email envoyé.

- **Livraison technique vérifiée le 06/11/2026** : PR #144 fusionnée, version applicative `91f0d1ae67fa5fca4533086b78ca8c0f3110540e` déployée. Workflow [42195941962](https://github.com/958-JMG/tanguy-design/actions/runs/42195941962) réussi avec 693 tests ; `/api/health` HTTP 200 et `/login` servant `91f0d1ae67fa` vérifiés. Nettoyage confirmé : 120 commandes restantes. Aucun message client envoyé.

- **Retour Devis express / éco, même jour** : régression du report automatique identifiée et corrigée. Les pièces calculables alimentent à nouveau le montant et la ligne éco Pennylane, sans coefficient ni double ajout ; éco explicite préservée, calcul incomplet signalé avant création. Nomenclatures relues visuellement. **702 tests réussis**, parcours Pennylane simulé et recette navigateur fictive réussis. PR #145 fusionnée ; déploiement [42198183674](https://github.com/958-JMG/tanguy-design/actions/runs/42198183674) réussi, version `a94368922068` et santé HTTP 200 vérifiées à 09:53 UTC. Le PDF source du dossier signalé n’a pas été retrouvé pour rejouer la lecture IA ; le brouillon existant n’a pas été recalculé arbitrairement. Aucun envoi client.

- **CTA création Express, retour suivant du 6 novembre** : fin du bouton désactivé sans effet au clic ; motif de validation visible et focus sur le champ à compléter, erreur persistante dans la modale, bouton Pennylane mis en évidence après création. **703 tests réussis** et parcours navigateur fictif jusqu’à l’appel Pennylane simulé vérifié. PR #147 déployée, workflow 42201217918 réussi, version `6421c2ca56af` et santé HTTP 200 vérifiées à 10:18 UTC ; aucune création de devis réel ni communication client pendant la recette.

- **Analyse > 5 minutes / Failed to fetch** : plafond de production 300s constaté, cohérent avec la durée signalée. Workflow corrigé à 900s, lecture fournisseur en flux bornée à 8 minutes sans relances implicites, erreur explicite et bouton de reprise du même fichier. **711 tests réussis**, SDK SSE et coupure/reprise navigateur fictifs vérifiés. PR #148 déployée, workflow [42203103175](https://github.com/958-JMG/tanguy-design/actions/runs/42203103175) réussi ; santé HTTP 200 et version servie `4a3699772ee9` vérifiées le 06/11 à 10:35 UTC, conteneur ready et délai 900s relus. Nouvel essai du PDF client proposé à JMG, résultat métier encore à confirmer. Pas de gain de rapidité mesuré annoncé, pas de devis client créé pendant les tests.

- **Retour suivant / descriptif Le Guennec** : JMG confirme la réussite du nouvel import. L’annexe du devis Pennylane `D-2026-11-27` (`EXP-2026-010` dans le cockpit) est effectivement présente : PDF récupéré via l’API Pennylane et vérifié, deux pages et 67 repères. Aucun ajout en double ni mutation du devis. Clarification de la fiche : état réel de l’annexe actuelle contrôlé en lecture seule, confirmation persistante et explication du PDF séparé à joindre à l’envoi. **716 tests réussis**, parcours navigateur fictifs présent/absent/reprise/panne vérifiés ; PR #150 déployée, workflow [42205802593](https://github.com/958-JMG/tanguy-design/actions/runs/42205802593) réussi ; santé HTTP 200 et version `4ab791bf31b1` vérifiées à 11:52 Europe/Paris le 06/11. Envoi client non réalisé.

- **Éco HT / TTC, demande suivante** : JMG confirme la confusion de TVA, puis demande les deux montants côte à côte dans l’import. Affichage TTC et taux ajouté, actualisé lors des changements de montant/TVA et du report depuis les pièces. Recette navigateur fictive réussie aux taux 20/10/5,5 %, champs vide/zéro/négatif et calcul des pièces ; syntaxe/diff valides. PR #152 déployée ; workflow [42208145998](https://github.com/958-JMG/tanguy-design/actions/runs/42208145998) réussi, santé HTTP 200 et version `7cfce4728cfa` vérifiées le 06/11 à 12:11 Europe/Paris. Aucun changement des montants client ; recette client du nouvel affichage non encore confirmée.

## 9 novembre 2026 — Extension du SAV autonome (Codex)

Préparation autorisée par Jean Marc : rattachement au SAV Pilotage, corrections d’affichage mineures limitées à la CSS et vérifiées avant/après, revue humaine pour le métier, les droits, les données et toute modification importante. Chaque mise en ligne exige la suite du cockpit et le contrôle de l’image ainsi que du CSS réellement servis.

Les quotas restent fermés par choix de Jean Marc : aucun appel payant du SAV avant son accord sur l’enveloppe. Les essais utilisent des comptes et bases fictifs, sans fournisseur IA réel. Mise en ligne et recette du parc en cours ; cette note ne constitue pas une preuve de déploiement ou de livraison client. Aucun nouveau message client envoyé.

### Contrôle du SAV — complément du 9 novembre 2026

Seule la feuille CSS V3 devient lisible sans connexion pour prouver la mise en ligne d’une correction. Les pages, scripts métier et API restent authentifiés, vérifiés par requêtes HTTP dans la suite complète isolée : 717 tests verts. Déploiement de ce complément en cours.

## 9 novembre 2026 — SAV du parc vérifié (Codex)

Extension mise en service à la demande de Jean Marc. Image de production contrôlée : `1098a9a4f6cfb76d22aa565af4511a4142a010e1` ; service disponible, connexion SAV authentifiée vérifiée avec des requêtes invalides sans création de ticket.

Suite complète isolée verte ; pages /v3/ vérifiées sur 320, 390 et 1280 px. Défaut fictif reproduit puis corrigé par le moteur de correction, sans toucher à la production.

Le worker commun fonctionne sur le hub toutes les cinq minutes, indépendamment du Mac. Les petites corrections d’affichage CSS peuvent être publiées après reproduction, correction, suite verte et contrôle du fichier réellement servi ; une modification importante ou hors recette revient à Jean Marc. Les demandes, décisions et reprises sont conservées.

**Quotas fermés : aucune activation client, aucun appel IA payant.** Jean Marc doit fixer et valider le quota avant l’exécution autonome payante. Aucun mail client de test ; aucune livraison ou acceptation client déduite de cette recette technique. LCDP reste archivé et exclu.

Preuves privées : `Travaux/sav-parc-20261109/preuves` sur le Mac et `Donnees-privees/sav-parc-20261109/preuves` sur le hub. Ne pas recréer une tâche d’installation de ce raccordement ; prochaine décision éventuelle : validation d’un quota par client.



## Préparation sécurité du 12 novembre 2026 - Codex

OPTION DISTINCTE DE CONFINEMENT : connexions des comptes activés préservées ; aucun QR ni confirmation, création de compte ou reset 2FA.

Validation : tests locaux et fixtures ; voir le dossier de preuves livré. Aucun déploiement, envoi client, migration distante, rotation réelle ni changement d’accès de production. Les dépôts partagés sont préservés.

Suite : Validation explicite séparée requise. Les nouveaux accès et les téléphones perdus ne peuvent pas être récupérés durant le confinement. Aucun nouveau stockage ni service ; Airtable doit répondre pour une nouvelle connexion. Une vraie session pending créée par le serveur de la révision publiée est refusée sur les deux nouveaux serveurs, même avec le bon code. Ne pas combiner ce patch avec le candidat complet bloqué. Reprendre l’enrôlement uniquement avec une solution durable validée, jamais en revenant à la version vulnérable.
