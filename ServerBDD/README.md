# ServerBDD

API Node.js/Express pour la persistance PostgreSQL et les fonctionnalités métier.

## Structure

- `src/server.js` : bootstrap HTTP.
- `src/app.js` : composition middleware et routes.
- `src/modules/` : modules métier (`users`, `games`, `social`, `progression`).
- `src/db/` : connexion PostgreSQL et migrations.
- `src/utils/` : utilitaires partagés (ex. `async-handler.js` pour factoriser les handlers async Express).
- `migrations/` : scripts SQL.

## Commandes utiles

- `npm run dev` : lancement en mode watch.
- `npm run start` : lancement standard.
- `npm run migrate` : exécution des migrations.
