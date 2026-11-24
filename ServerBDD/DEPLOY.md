# Déployer la plateforme sur o2switch

## Base métier

1. Dans cPanel, créer une base MySQL et un utilisateur dédié. cPanel ajoute le préfixe du compte aux deux noms. Conserver le moteur InnoDB.
2. Créer une application Node.js 22 sous un domaine HTTPS, avec ServerBDD comme racine hors de public_html et app.cjs comme fichier de démarrage.
3. Installer les dépendances. Définir les variables de env.template dans cPanel, avec PASSENGER=true, DATABASE_HOST=localhost et les noms préfixés. Renseigner la région, le pool et le même client Cognito que Flutter.
4. Donner des valeurs aléatoires distinctes aux jetons SIGNALING_INTERNAL_TOKEN et PLATFORM_ADMIN_TOKEN. Les migrations démarrent avec l’application. GET /health doit retourner le statut ok.

Cette installation initialise une base neuve. Les migrations sont numérotées et leur exécution reprend après une interruption. MySQL 8.4 est la version testée en local. Sur l’hébergement, confirmer le moteur et sa version avec SELECT VERSION().

## Signalisation

Définir BDD_URL sur l’origine HTTPS de ServerBDD, SIGNALING_INTERNAL_TOKEN sur le même secret et REQUIRE_PLAYER_PLATFORM=true. Une portée SIGNALING_PERSISTENCE_SCOPE par serveur de jeu logique conserve les salons et les manches. Garder une seule instance active par portée. Les sauvegardes en cours de partie remplacent le dernier état connu. Le démarrage d’une manche enregistre son état initial avec la partie.

Les actions Socket.IO admin utilisent un jeton SIGNALING_ADMIN_TOKEN distinct, fourni par le monitoring dans auth.adminToken.

Le domaine Flutter SIGNALING_PRODUCTION_URL doit passer par HTTPS avec WebSocket activé. Le mobile demande un ticket court à l’API du compte pour chaque connexion. Le jeton Cognito reste sur le canal HTTPS de l’API.

La base est lue localement depuis l’application Node.js o2switch. La signalisation hébergée ailleurs communique avec cette API en HTTPS. [Accès SQL distant o2switch](https://faq.o2switch.fr/cpanel/bases-de-donnees/mysql-distant/)

## Google Play et publicités

Créer un abonnement et un plan de base sur la piste bêta. Renseigner PLAY_SUBSCRIPTION_PRODUCT_ID et PLAY_SUBSCRIPTION_BASE_PLAN_ID. Donner au compte de service l’accès à l’Android Publisher API pour le package PLAY_PACKAGE_NAME, puis renseigner PLAY_CLIENT_EMAIL et PLAY_PRIVATE_KEY. Le serveur vérifie le compte de jeu et confirme l’achat auprès de Google Play.

Faire pointer une souscription push Pub/Sub authentifiée sur /api/billing/play/notifications. Renseigner l’audience exacte du JWT et l’adresse du compte d’envoi via PLAY_PUBSUB_PUSH_AUDIENCE et PLAY_PUBSUB_PUSH_EMAIL. Tester paiement, restauration, annulation et révocation sur la piste de test. [Cycle de vie Google Play](https://developer.android.com/google/play/billing/lifecycle/subscriptions)

Pour les publicités Android, définir ADMOB_APP_ID dans les propriétés Gradle et ADMOB_BANNER_ID dans les variables Dart. Configurer le formulaire UMP. L’offre payante active retire la bannière après vérification du droit. Tester la piste bêta avec des appareils et unités publicitaires de test.

La version initiale des règles d’hébergement laisse les plafonds facultatifs. Pour les activer, ajouter une version à app_config_versions pour la clé hosting et renseigner free_daily_rounds et premium_daily_rounds. Le compteur porte sur les manches démarrées par l’hôte pendant le jour UTC. premium_settings accepte un objet par clé de la configuration de manche avec free_max ou free_values et, facultativement, feature. La valeur par défaut du code de droit est advanced_lobby_settings.

## Compilation Flutter

Dans config/cognito.release.json, renseigner SERVERBDD_PRODUCTION_URL et SIGNALING_PRODUCTION_URL avec les domaines HTTPS. Autoriser le scope aws.cognito.signin.user.admin sur le client Hosted UI si la suppression du compte est activée. Ajouter les variables de collecte du fichier config/error-reporting.production.example.json selon l’hébergement.

Lancer les builds depuis Flutter avec --dart-define-from-file=config/cognito.release.json. Les secrets du serveur et de Google Play restent dans les variables serveur.
