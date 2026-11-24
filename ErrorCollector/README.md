# Diagnostics Broken Veil Protocol

Le collecteur Node.js conserve les événements dans une base MySQL distincte. Flutter écrit ses rapports dans SQLite puis transmet des lots acquittés. Les erreurs avant connexion passent par /api/errors/anonymous avec une limite de débit dédiée et un filtrage renforcé. Les erreurs et compteurs de vocal après connexion utilisent un jeton d’accès Cognito.

## Part du vocal relayé

Interroger GET /api/voice-routes/summary avec le jeton d’administration. Les paramètres since et until sont des dates UTC et environment permet de sélectionner production. La réponse donne les octets par chemin, leurs pourcentages et le détail par phase du jeu.

- p2p compte les octets audio sortants échangés directement entre deux pairs.
- ownTurn compte ceux passés par un candidat relais du projet à l’une ou l’autre extrémité.
- otherTurn compte ceux attribués à un relais tiers identifiable.
- unknown conserve les octets dont le trajet est indéterminé, y compris lors d’un changement de paire entre deux relevés.

Le dénominateur est le total d’octets RTP audio sortants observés. En comptant uniquement la direction sortante, un même flux ne compte qu’une fois. La réponse indique séparément le nombre d’intervalles où les compteurs sont indisponibles. Les octets mesurés n’incluent pas le surcoût de transport ni le trafic de signalisation.

Dans Flutter, configurer VOICE_OWN_TURN_HOSTS avec les noms de serveurs TURN et leurs adresses publiques de relais séparés par des virgules. Ces entrées servent à reconnaître le relais local et celui du pair distant. Les adresses des joueurs, le contenu vocal et les identifiants ICE ne sont pas envoyés.

## Déploiement et conservation

Créer une base et un utilisateur cPanel distincts de ServerBDD. Déployer app.cjs en tant qu’application Node.js 22 sur un domaine HTTPS avec PASSENGER=true, DATABASE_HOST=localhost et les valeurs de .env.example dans l’environnement cPanel. Installer les dépendances puis exécuter npm run migrate dans l’environnement Node. Fournir l’URL HTTPS /api/errors au build Flutter. Le déploiement en sous-chemin utilise APP_BASE_PATH.

Pour collecter les erreurs du serveur de signalisation, définir son DIAGNOSTICS_SERVER_URL vers /api/diagnostics/server et partager DIAGNOSTICS_SERVER_TOKEN uniquement entre les deux services.

Exécuter npm run retention chaque jour avec le cron cPanel. La commande purge les événements reçus il y a plus de 30 jours. DIAGNOSTICS_MAX_BYTES est un plafond facultatif exprimé en octets de données logiques. Une valeur de zéro applique la durée de conservation seule. Les tables réutilisent l’espace libéré.

Les routes de lecture et d’export requièrent ERROR_ADMIN_TOKEN. GET /api/error-signatures regroupe les erreurs récurrentes par signature. Les journaux locaux restent accessibles dans Paramètres, Journal des erreurs.

## Tests

npm test exécute les tests HTTP et du calcul des proportions. RUN_MYSQL_TESTS=1 active les tests avec les paramètres d’une base MySQL jetable.
