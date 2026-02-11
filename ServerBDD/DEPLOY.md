# Déploiement ServerBDD sur O2Switch

## 1. Créer le sous-domaine

Dans cPanel > Sous-domaines :
- Sous-domaine : `bdd`
- Domaine : `abstergochase.fr`
- Document racine : `/bdd.abstergochase.fr` (ou laisser par défaut)

## 2. Créer l'application Node.js

Dans cPanel > Setup Node.js App :
- Version Node.js : 18 ou 20
- Mode : Production
- Application root : chemin vers le dossier ServerBDD (ex. `~/serverbdd`)
- Application URL : `bdd.abstergochase.fr` (ou le sous-domaine créé)
- Application startup file : `server.js`

## 3. Variables d'environnement

Dans l'interface Node.js App, ajouter :
- `DATABASE_HOST` = localhost
- `DATABASE_PORT` = 3306
- `DATABASE_NAME` = nite8495_AbstergoBase
- `DATABASE_USER` = nite8495
- `DATABASE_PASSWORD` = (votre mot de passe)

## 4. Adapter server.js pour Passenger

Passenger ne utilise pas le port 5175. Le fichier `server.js` utilise déjà `process.env.PORT` ; Passenger définit cette variable automatiquement.

## 5. Rebuild et restart

Après déploiement, cliquer sur "Restart" dans Setup Node.js App.

## 6. Lab - Build de production

Dans `Lab/.env` avant le build :
```
VITE_API_URL=https://bdd.abstergochase.fr
```

Puis `npm run build` et déployer le contenu de `dist/`.
