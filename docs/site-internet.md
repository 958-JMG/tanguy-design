# Site internet Tanguy Design

Version de validation : https://tanguydesign.958.fr/site/ — identifiant et mot de passe partagés, sans compte ChatGPT, noindex. Les accès sont transmis séparément, jamais enregistrés dans Git.
Gestion : https://tanguydesign.958.fr/gestion-site — connexion du cockpit, administrateurs uniquement. Menu Gestion > Site internet sur ordinateur, Plus > Site internet sur mobile.

## Modifier le site

Choisir une rubrique. Modifier les textes, les titres et descriptions pour Google, ou remplacer une photo. Enregistrer le brouillon, cliquer Prévisualiser, puis Publier le brouillon. Les changements sont visibles sous 10 secondes sur toutes les instances. Restaurer la publication précédente permet de revenir à la dernière publication ; elle remplace aussi le brouillon, et l’écran le dit quand celui-ci porte des modifications non publiées. Abandonner le brouillon le remet sur la version en ligne. Une nouvelle réalisation peut être ajoutée dans Réalisations, et retirée du brouillon par « Supprimer cette réalisation » ; les cinq réalisations d’origine se modifient mais ne se suppriment pas (leurs pages les lisent par leur position). Les URL existantes restent stables.

Les photos acceptées sont JPG, PNG et WebP, jusqu’à 8 Mo. Préférer des images optimisées de 1 600 à 2 000 pixels, idéalement sous 500 Ko. Le texte doit décrire ce qui est réellement visible. Ne pas publier de nom/adresse de client sans son accord. Aucun plug-in WordPress ni service CMS externe.

## Fonctionnement

Le module Express `services/site-vitrine.js` sert du HTML rendu côté serveur. Les templates, contenus initiaux et assets publics sont dans `website/`. La conception initiale et le générateur sont conservés dans le projet local `tanguy-design/web`. Le cockpit fournit ses contrôles d’authentification et de rôle existants. Aucune nouvelle dépendance npm.

Le contenu est durable dans le bucket Scaleway privé `tanguy-vitrine-958`, projet dédié au site. `website/state.json` contient brouillon, publication et version précédente. Les versions S3 et les snapshots `website/history/` permettent une récupération technique supplémentaire. Les médias sont dans `website/media/`. L’application ne peut pas supprimer les sauvegardes. Les écritures conditionnelles sur ETag refusent un enregistrement si une autre personne a modifié la version entre-temps. En cas d’indisponibilité du stockage, l’erreur est affichée : aucune fausse confirmation d’enregistrement.

Configuration : `SITE_BUCKET`, `SITE_S3_ACCESS_KEY`, `SITE_S3_SECRET_KEY`, `SITE_S3_ENDPOINT` facultatif. Clés dans les secrets du conteneur uniquement. `SITE_ORIGIN` vaut par défaut https://tanguydesign.958.fr. Ne pas publier les fichiers d’environnement.

## Accès de validation

Activer `SITE_REVIEW_ENABLED=true` et définir `SITE_REVIEW_LOGIN`. Placer uniquement le hash bcrypt (10 tours) du mot de passe dans le secret `SITE_REVIEW_PASSWORD_HASH`. La connexion `/site/acces` accorde un accès de lecture pendant sept jours, sans créer de compte cockpit. Pages, médias, CSS, images et sitemap sont protégés ; les réponses sont privées et non indexables. Les administrateurs déjà connectés au cockpit conservent l’accès aux aperçus et aux images du CMS. Une modification de l’identifiant ou du hash invalide immédiatement les anciens accès de validation.

Les formulaires utilisent un jeton de session et une limite de 20 échecs par IP sur 15 minutes par instance. Le cookie est signé, HttpOnly et Secure en production. La porte de validation reste active sur le sous-domaine 9·58 et sur l’adresse technique du conteneur après la mise en ligne commerciale. Le domaine commercial configuré par `SITE_PUBLIC_ORIGIN` devient public ; sa variante avec/sans www est redirigée en 301 vers la forme canonique.

L’ancienne copie de présentation sur ChatGPT Sites a été rendue privée ; seul le lien de validation hébergé par 9·58 est à transmettre au client.

## Référencement et bascule commerciale

Le site actuel `www.tanguydesign.com` reste en place pendant la validation. Conserver ce domaine pour sa continuité SEO. L’hébergement sera celui de 9·58 : domaine et hébergeur sont indépendants.

Après validation des pages, des mentions légales et de la migration historique :

1. Terminer la reprise des galeries et pages de marques restantes dans `../migration-plan.csv` du dossier de livraison ; ne pas basculer en perdant ces URL.
2. Relier `tanguydesign.com` et `www.tanguydesign.com` au conteneur (DNS Cloudflare + certificats Scaleway). Voir `dns-tanguydesign.txt`. Conserver `https://www.tanguydesign.com` comme adresse canonique, déjà utilisée par le site actuel ; la variante sans www sera redirigée en 301, chemin et paramètres conservés.
3. Définir `SITE_PUBLIC_ORIGIN=https://www.tanguydesign.com` et `SITE_INDEXABLE=true`. Le routeur sert alors la vitrine à la racine uniquement sur ce domaine. Les routes du cockpit restent inaccessibles sur le domaine commercial. La copie /site/ reste noindex.
4. Les redirections 301 de `website/redirects.json` ne s’appliquent que sur le domaine commercial. Les autres URL restent à compléter avant la bascule. Pas de redirection générale de toutes les anciennes pages vers l’accueil.
5. Vérifier canoniques, robots, sitemap, 404, liens, images et performances sur le vrai domaine. Soumettre `/sitemap.xml` à Google Search Console et Bing Webmaster Tools. Contrôler les erreurs de couverture et les pages exclues.
6. Mettre à jour la fiche Google Business Profile : nom, adresse d’Auray, téléphone, horaires confirmés, catégorie pertinente et lien du site. Ajouter des photos de réalisations autorisées et demander de vrais avis sans contrepartie.

L’accueil cible « cuisiniste Auray » et l’offre d’agencement ; la page cuisine couvre « cuisiniste haut de gamme Vannes », Auray et le Golfe du Morbihan avec showroom réel à Auray. Aucune fausse implantation à Vannes. Les réalisations pourront enrichir le référencement avec la commune, les contraintes et les solutions effectivement documentées. Un paragraphe authentique par projet vaut mieux que des pages identiques multipliées par commune.

Titres/descriptions uniques, HTML lisible sans JavaScript, données structurées entreprise/services/fil d’Ariane/FAQ, images locales, maillage entre cuisine/showroom/réalisations/contact, sitemap et URL stables sont présents. Les données FAQ n’impliquent pas un résultat enrichi garanti. Aucun score ou classement Google n’est garanti.

Sources : https://developers.google.com/search/docs/appearance/ai-features ; https://support.google.com/business/answer/7091?hl=fr ; https://developers.google.com/search/docs/essentials/spam-policies

## Limites à finaliser avec Tanguy Design

Identité juridique, responsable de publication, horaires et éventuelles marques à confirmer ; photos propres aux cuisines extérieures/dressings ; descriptions et communes des réalisations ; reprise des galeries historiques restantes. Le formulaire prépare un e-mail dans la messagerie du visiteur : il ne prétend pas transmettre une demande au cockpit. Aucun mail automatique ajouté.
