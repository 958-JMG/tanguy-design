# Devis détaillés — livraison du 16 novembre 2026

Les devis PDF avec des prix par article ouvrent maintenant une relecture détaillée. Les références (zéros initiaux et références multiples compris), descriptifs complets, quantités, remises article et globale sont conservés. Les montants sont comparés au document avant toute création. L’éco comprise dans le prix n’est pas ajoutée une seconde fois.

Un import crée les lignes réelles du devis, relié à son projet et à son client. Le nouvel écran de fiche montre les références et remises sans devoir ouvrir une succession de documents. Une interruption laisse un import incomplet, signalé et bloqué pour les documents contractuels ; le même fichier corrigé de la même manière, sur la même cible, reprend uniquement les lignes manquantes. La perte de la réponse de création du projet ou d’un lot est couverte par les tests.

Le devis Pennylane conserve sa présentation commerciale par taux de TVA. Il indique les remises déjà déduites et cite le nom exact de l’annexe versionnée. Cette annexe générée contient tous les descriptifs relus, références, quantités, prix unitaires lorsqu’ils sont connus, remises et nets. Une modification ne peut pas joindre une nouvelle version à un devis commercial qui cite l’ancienne : régénération requise. Vérifier les pièces jointes lors de l’envoi dans Pennylane reste nécessaire ; aucun envoi automatique n’a été ajouté.

## Excel

Formats acceptés : `.xlsx` et CSV UTF-8. Le modèle CSV téléchargeable s’ouvre dans Excel et peut être enregistré en `.xlsx`. Une ligne par article ; colonnes de référence en texte. Les formats numériques explicitement composés de zéros sont respectés, aucune longueur de référence n’est supposée. Les formules ne sont pas exécutées : leur résultat enregistré est utilisé ; sinon le fichier doit être recalculé dans Excel. Toute colonne renseignée ou feuille non reconnue est signalée, jamais abandonnée silencieusement.

Le récapitulatif du document doit porter le total HT, TTC, l’éco (0 si aucune), son inclusion et la remise globale éventuelle. Les lignes portent leurs propres remises, distinctes du récapitulatif. Les familles restent corrigeables avant création.

## Vérification locale

- 745 tests réussis, aucun échec ou test ignoré, Airtable/Pennylane et lecture IA simulés ; aucun appel IA payant.
- Parcours Chrome isolé : import CSV, affichage de toutes les lignes, erreur de remise visible, confirmation réinitialisée après correction, choix du projet, fiche client/projet liée, annexe jointe au Pennylane simulé. Bureau 1280 px et mobile 390 px sans débordement, aucune erreur JavaScript.
- PDF fictif rendu et relu visuellement ; test multipage relisant la dernière ligne, les références et les deux remises.
- Les deux PDF fournis ont été examinés localement avant développement. Pas d’import réel, pas de devis client créé, pas de modification des anciens documents. Les tarifs fournisseur et l’éligibilité des taux de TVA n’ont pas été contrôlés ; les tests vérifient les calculs et la conservation des valeurs fournies.

Preuves locales : `Travaux/tanguy-import-detail-20261116-preuves/` (journal de tests, recette navigateur, captures et PDF fictif).

## Mise en service vérifiée

Branche `codex/tanguy-import-detail-20261116`, base `a33a11b`, worktree `Travaux/tanguy-import-detail-20261116`. Mise en ligne et ajout du champ autorisés explicitement par JMG le 16/11/2026. Le champ `Détail import` a été créé dans la base Tanguy et son type relu ; `Empreinte import`, les champs de lignes et les liens inverses client/projet/devis sont conformes. Aucun enregistrement client modifié ni envoi réalisé. PR [157](https://github.com/958-JMG/tanguy-design/pull/157) fusionnée, version `cef605365b37` déployée et vérifiée (workflow [43827175743](https://github.com/958-JMG/tanguy-design/actions/runs/43827175743), santé HTTP 200). Accès administrateur, modules, modèle CSV et lecteurs CSV/XLSX vérifiés en production sans création de devis.

1. Effectué : simulation puis migration additive `scripts/setup-devis-detail-field.js`, cible Tanguy vérifiée. Un seul champ ajouté : `Détail import` (texte long). Schéma relu après écriture, aucun contenu client modifié.
2. Effectué pour la première version : revue/CI, déploiement par le workflow habituel, contrôles de disponibilité et lecteurs Excel/CSV. Complément éco publié en PR158, voir ci-dessous.
3. Lectures IA réelles des deux PDF effectuées ; reste l’Excel réellement utilisé (non fourni), puis la recette client du nouveau devis commercial et de son annexe avant envoi. Ne pas réimporter les anciens devis signés automatiquement.

Limites explicites : 300 lignes par import, deux taux de TVA, Excel/CSV limité à 5 Mo et un lecteur isolé (délai de huit secondes, tas limité à 128 Mo). Un écart d’arrondi créé par le découpage TVA de Pennylane bloque l’export au lieu de modifier les prix. Les nomenclatures sans prix par ligne gardent le parcours forfaitaire historique et son annexe ; cette évolution ne reconstitue pas des prix absents.

Dépendance de lecture : ExcelJS 4.4.0, API documentée dans son [README officiel](https://github.com/exceljs/exceljs). `uuid` limité à 11.1.1 dans cette dépendance ; les deux mises à jour transitives nécessaires sont `es-object-atoms` 1.1.2 et `which-typed-array` 1.1.24. Les dépendances métier existantes ne changent pas. L’audit npm reste à une alerte modérée préexistante sur `qs` ; aucun correctif transverse incorporé. Le rattachement PDF utilise l’API Pennylane des annexes déjà présente, sans changement d’envoi/finalisation.

## Complément après lecture réelle

Le PDF électroménager détaille par appareil les composantes d’une ligne éco distincte. L’IA avait recopié ces montants aussi dans les articles : le contrôle a bloqué l’import avant toute écriture. La lecture précise désormais cette présentation et normalise seulement les duplications prouvées par les montants au centime, les prix nets et les taux de TVA. Le descriptif de ventilation, tous les prix, références et remises restent inchangés ; si la preuve manque, le contrôle continue de bloquer.

Vérification des résultats réels après correction locale : électroménager, 10 lignes, remise article 384 HT, remise globale 1 111,22 HT, éco 57,76 HT et TTC 17 365,64 ; mobilier, 33 lignes, remise globale 1 212,25 HT, éco 124,82 HT et TTC 32 634,36. Les six lignes mobilier sans code dans la source (fond céramique, crédence, plan céramique, pied en verre, livraison, pose) requièrent la confirmation explicite « Sans référence », conservée par le correctif. Aucune référence catalogue inventée ni validation de tarif fournisseur.

Complément validé localement par 755 tests, zéro échec, syntaxe et diff valides ; cas ambigus (prix absent, TVA différente, ventilation partielle, remise incohérente) conservés pour blocage.

La PR [158](https://github.com/958-JMG/tanguy-design/pull/158) est déployée : image `215728179fce`, [workflow 43828334966](https://github.com/958-JMG/tanguy-design/actions/runs/43828334966) réussi. Une nouvelle extraction IA du PDF électroménager, appelée depuis le site publié, est entièrement conforme : 10 lignes, zéro erreur de contrôle, références et deux remises présentes, éco 57,76 HT et TTC 17 365,64. Les contrôles CSV/XLSX, version et accès administrateur ont été rejoués avec succès ; aucun devis réel créé.

Dernier complément de livraison : le modèle CSV vide avait été mis en cache par le CDN à cause de l’extension de son URL. Le lien utilisé par l’écran n’a plus d’extension, conserve le nom de téléchargement `.csv`, et la réponse interdit le stockage partagé. Ce modèle ne contient aucune donnée client. Les routes de lecture et création sont restées protégées. Nouvelle URL vérifiée après publication : administrateur HTTP200 puis appel anonyme HTTP401, cache privé non conservable, CDN DYNAMIC. Aucune règle globale du CDN modifiée.

## État final — 09:12 Europe/Paris

PR [159](https://github.com/958-JMG/tanguy-design/pull/159) déployée : version `466444490b64998c51ef347f12378212ec8deacf`, [workflow 43829061810](https://github.com/958-JMG/tanguy-design/actions/runs/43829061810) réussi après 756 tests. Version publique, santé HTTP200, schéma de la base, lien du modèle et contrôles d’accès vérifiés. Aucun devis réel créé et aucun message envoyé pendant la recette. Le parcours complet jusqu’à l’annexe Pennylane reste une recette avec services simulés ; les lectures IA des PDF et Excel/CSV ont été contrôlées sur le site publié. Recette client du document commercial à faire avant envoi ; véritable fichier Excel non reçu.

Passation Codex : code et notes partagés sur main distant. Les worktrees et branches locales de ce travail sont fermés après fusion, les preuves restent dans `Travaux/tanguy-import-detail-20261116-preuves`. Aucun autre worktree modifié. Les résultats de préparation locale ci-dessus restent l’historique de cette livraison, et ne remplacent pas cette vérification finale.
