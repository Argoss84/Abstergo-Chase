# ServerBDD

API MySQL pour Broken Veil Protocol. Les migrations InnoDB créent la base métier à partir d’un schéma vide. Le collecteur de diagnostics dispose de son propre schéma.

- users porte l’identité Cognito et l’identifiant public. user_active_sessions représente l’appareil actif. signaling_tickets autorise une connexion WebSocket à usage unique.
- user_settings synchronise les préférences par compte et lobby_presets conserve les configurations de salon choisies.
- lobbies possède le code partagé. games numérote les manches. Chaque manche conserve ses règles, ses objectifs, ses participations et ses résultats. runtime_snapshots garde le dernier état reprenable par portée de signalisation.
- game_players lie l’historique au compte et conserve le pseudo utilisé. Le profil d’un compte supprimé affiche « Agent décommissionné ».
- friendships et blocked_users gèrent les relations. xp_events garantit un crédit unique par source. player_stats et level_thresholds portent le niveau. bonuses et player_bonus_unlocks conservent le rôle, l’équipement et les charges éventuelles.
- play_subscriptions et play_subscription_items enregistrent le statut vérifié et l’échéance. play_plan_features rattache les droits aux offres et play_billing_events déduplique les notifications.
- app_config_versions conserve les paramètres de progression et d’hébergement. Une victoire vaut provisoirement 150 XP. Les défaites et abandons valent zéro. Le catalogue de bonus reçoit les effets décidés pour le jeu.

Les résultats, les gains d’XP et les déblocages partagent une transaction. Les règles contrôlant les créations et les paramètres premium sont vérifiées côté serveur.

## Démarrage local

Depuis la racine du dépôt.

~~~sh
docker compose --env-file Docker/env.serverbdd.example -f Docker/docker-compose.serverbdd.yml up --build
~~~

Sur une base de test dont le nom commence par codex_platform_test, RUN_DATABASE_TESTS=1 active les tests d’intégration de npm test dans ServerBDD. Les variables de connexion suivent env.template. [Déploiement o2switch](DEPLOY.md)
