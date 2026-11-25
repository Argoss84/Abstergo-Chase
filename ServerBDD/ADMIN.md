# Back-office administrateur

La console est intégrée à ServerBDD et disponible sur /admin/. Elle réutilise la base MySQL de l’application, les API du collecteur et les commandes administrateur de la signalisation.

## Fonctions

- Tableau de bord des comptes, participants et manches du jour UTC, abonnements vérifiés et état des services.
- Monitoring des salons et parties, participants, compteurs de messages et notifications aux parties.
- Recherche des joueurs, profil, dix dernières manches terminées, suspension, réactivation et révocation des sessions.
- Historique par identifiant de manche, participants, résultats, événements et configuration. Plusieurs manches d’un même salon restent consultables séparément.
- Consultation des abonnements Google Play, plans, états et échéances.
- Diagnostics client, rapports anonymes, regroupements d’erreurs, sessions et événements serveur.
- Répartition du vocal en octets entre P2P, relais de l’infrastructure, autres relais et trajets indéterminés, avec les intervalles sans mesure.
- Publication versionnée des gains d’XP et des règles d’hébergement gratuit et premium. Les paliers et le catalogue des bonus sont consultables.
- Journal des connexions, changements de statut, révocations, publications de réglages et notifications administrateur.

## Déployer sur o2switch

1. Déployer le dossier ServerBDD hors de public_html, sur un sous-domaine HTTPS avec l’application Node.js 22 de cPanel. Utiliser app.cjs comme fichier de démarrage. L’API mobile et la console partagent ce service.
2. Renseigner les variables de connexion à la base MySQL et à Cognito de env.template. La base est accédée localement depuis o2switch. Installer les dépendances avec npm ci --omit=dev dans l’environnement Node.js de l’application.
3. Configurer NODE_ENV=production, PASSENGER=true et TRUST_PROXY=1 derrière le proxy HTTPS de cPanel. ADMIN_ORIGIN doit contenir l’origine HTTPS exacte, par exemple https://api.example.fr.
4. Choisir ADMIN_USERNAME et générer ADMIN_PASSWORD_HASH à partir d’un mot de passe dédié d’au moins 14 caractères. Depuis un terminal SSH dans ServerBDD, utiliser les commandes suivantes.

~~~sh
read -rs -p 'Mot de passe administrateur ' admin_password
printf '\n'
printf '%s' "$admin_password" | npm run --silent admin:password
unset admin_password
~~~

Copier l’empreinte obtenue dans la variable cPanel ADMIN_PASSWORD_HASH. La valeur commence par scrypt$. Dans un fichier .env ou un fichier de variables Docker Compose, entourer cette empreinte d’apostrophes simples pour conserver les caractères $. Dans le champ de variable cPanel, coller la valeur brute.

5. Renseigner ADMIN_SIGNALING_URL avec l’origine HTTPS de la signalisation et SIGNALING_ADMIN_TOKEN avec le même secret aléatoire dans ServerBDD et dans le serveur de jeu. SOCKET_IO_PATH peut préciser le chemin Socket.IO. Utiliser deux secrets différents pour SIGNALING_ADMIN_TOKEN et SIGNALING_INTERNAL_TOKEN.
6. Renseigner ADMIN_DIAGNOSTICS_URL avec l’origine HTTPS du collecteur. ERROR_ADMIN_TOKEN doit correspondre au jeton administrateur du collecteur.
7. Redémarrer l’application dans cPanel. Les migrations créent automatiquement les tables des sessions administrateur et de la limitation des connexions. Ouvrir https://api.example.fr/admin/.

La documentation o2switch décrit la gestion de l’application Node.js et son lancement par Passenger. [Guide officiel o2switch](https://faq.o2switch.fr/cpanel/logiciels/hebergement-nodejs-multi-version/)

## Accès et exploitation

Le navigateur reçoit un cookie de session HttpOnly, SameSite Strict et Secure en production. Les sessions sont conservées huit heures en MySQL et survivent au redémarrage des processus Passenger. La déconnexion supprime la session en base. Changer l’identifiant ou l’empreinte du mot de passe invalide les sessions précédentes. Les API administrateur contrôlent l’origine des écritures et un jeton CSRF lié à la session. Les secrets de la signalisation et du collecteur restent sur le serveur.

Chaque adresse dispose de dix tentatives de connexion par fenêtre de quinze minutes. Le compteur est partagé entre les processus via MySQL. Les sessions expirées et les anciens compteurs sont nettoyés lors des connexions réussies.

La suspension et la révocation retirent les sessions de jeu et les tickets de connexion. Le serveur de jeu contrôle régulièrement les sessions actives. La réactivation permet une nouvelle connexion Cognito.

Une publication de réglages ajoute une version et une entrée d’audit dans la même transaction. Un écran resté ouvert sur une version dépassée reçoit une erreur de conflit et doit être actualisé. Les paramètres de progression et d’hébergement sont pris en compte lors du démarrage des manches suivantes.

Un service optionnel indisponible est signalé sur le tableau de bord. Les fonctions qui dépendent de ce service affichent une erreur avec possibilité de réessayer.

## Essais

npm test exécute les tests HTTP, mots de passe, sessions, CSRF, origine, limitation des tentatives et validation des paramètres. Les tests MySQL s’activent avec RUN_DATABASE_TESTS=1 et une base isolée dont le nom commence par codex_platform_test.

Pour une base de test dédiée au back-office, exécuter node --test test/admin_database.test.mjs. Exécuter le test de cycle de partie sur une autre base isolée, car les tests administrateur modifient les règles de progression de leur base.

Avant publication, vérifier une connexion et une déconnexion via le domaine HTTPS final, l’accès au collecteur et à la signalisation, puis les cookies Secure et le refus d’accès après déconnexion.
