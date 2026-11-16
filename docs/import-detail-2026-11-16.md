# Devis détaillés — préparation du 16 novembre 2026

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

## Mise en service autorisée

Branche `codex/tanguy-import-detail-20261116`, base `a33a11b`, worktree `Travaux/tanguy-import-detail-20261116`. Mise en ligne et ajout du champ autorisés explicitement par JMG le 16/11/2026. Le champ `Détail import` a été créé dans la base Tanguy et son type relu ; `Empreinte import`, les champs de lignes et les liens inverses client/projet/devis sont conformes. Aucun enregistrement client modifié ni envoi réalisé. Publication et vérification de la version déployée en cours.

1. Effectué : simulation puis migration additive `scripts/setup-devis-detail-field.js`, cible Tanguy vérifiée. Un seul champ ajouté : `Détail import` (texte long). Schéma relu après écriture, aucun contenu client modifié.
2. En cours : publication de la branche, revue/CI puis déploiement par le workflow habituel ; contrôles de disponibilité et d’import sans créer de devis client réel.
3. Recette métier d’un PDF réel, puis du fichier Excel réellement utilisé par Tanguy (non fourni à ce stade). L’extraction IA des deux PDF n’a pas été rejouée. Valider leur liste de références et leurs remises avant de créer un document commercial. Ne pas réimporter les anciens devis signés automatiquement.

Limites explicites : 300 lignes par import, deux taux de TVA, Excel/CSV limité à 5 Mo et un lecteur isolé (délai de huit secondes, tas limité à 128 Mo). Un écart d’arrondi créé par le découpage TVA de Pennylane bloque l’export au lieu de modifier les prix. Les nomenclatures sans prix par ligne gardent le parcours forfaitaire historique et son annexe ; cette évolution ne reconstitue pas des prix absents.

Dépendance de lecture : ExcelJS 4.4.0, API documentée dans son [README officiel](https://github.com/exceljs/exceljs). `uuid` limité à 11.1.1 dans cette dépendance ; les deux mises à jour transitives nécessaires sont `es-object-atoms` 1.1.2 et `which-typed-array` 1.1.24. Les dépendances métier existantes ne changent pas. L’audit npm reste à une alerte modérée préexistante sur `qs` ; aucun correctif transverse incorporé. Le rattachement PDF utilise l’API Pennylane des annexes déjà présente, sans changement d’envoi/finalisation.
