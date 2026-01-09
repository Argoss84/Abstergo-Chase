# Guide de Déploiement sur O2Switch

## 📦 Déploiement du Serveur Node.js WebSocket

### Étape 1 : Configuration O2Switch

O2Switch propose des hébergements mutualisés qui peuvent exécuter Node.js. Voici les options :

#### Option A : Node.js Application (Recommandé)
O2Switch permet de créer des applications Node.js via cPanel.

1. **Connectez-vous à votre cPanel O2Switch**

2. **Créez une application Node.js :**
   - Cherchez "Setup Node.js App" dans cPanel
   - Cliquez sur "Create Application"
   - Configurez :
     - **Node.js version** : 18.x ou supérieur
     - **Application mode** : Production
     - **Application root** : `/home/votre-user/abstergo-server` (ou autre dossier)
     - **Application URL** : votre-domaine.com
     - **Application startup file** : `server.js`
     - **Port** : Laissez O2Switch attribuer automatiquement un port

3. **Notez le port attribué** par O2Switch (généralement visible dans les détails de l'application)

### Étape 2 : Upload des fichiers du serveur

#### Via FTP/SFTP :
1. Connectez-vous avec FileZilla ou WinSCP
2. Uploadez ces fichiers dans le dossier d'application :
   ```
   server.js
   package.json
   package-lock.json
   ```

#### Via SSH (si disponible) :
```bash
# Connectez-vous en SSH
ssh votre-user@votre-domaine.com

# Créez le dossier de l'application
mkdir -p ~/abstergo-server
cd ~/abstergo-server

# Uploadez vos fichiers (via scp depuis votre machine locale)
# Depuis votre machine locale dans un autre terminal :
scp server.js package.json package-lock.json votre-user@votre-domaine.com:~/abstergo-server/
```

### Étape 3 : Installation des dépendances

Via l'interface cPanel Node.js App :
1. Allez dans "Setup Node.js App"
2. Cliquez sur votre application
3. Dans la section "Detected configuration files", cliquez sur "Run NPM Install"

OU via SSH :
```bash
cd ~/abstergo-server
npm install
```

### Étape 4 : Configuration des variables d'environnement

Dans cPanel Node.js App, ajoutez les variables d'environnement :
- **SIGNALING_PORT** : Le port fourni par O2Switch (ex: 5174)

### Étape 5 : Démarrage de l'application

Via cPanel :
1. Cliquez sur "Restart" dans votre application Node.js
2. Vérifiez que le statut est "Running"

Via SSH :
```bash
cd ~/abstergo-server
npm start
```

### Étape 6 : Configuration du pare-feu et des ports

⚠️ **Important** : O2Switch peut avoir des restrictions sur les ports WebSocket.

**Contactez le support O2Switch** pour :
1. Ouvrir le port WebSocket de votre application
2. Configurer un reverse proxy si nécessaire
3. Activer le protocole WebSocket (ws:// ou wss://)

### Étape 7 : SSL/TLS pour WebSocket Sécurisé (wss://)

Pour utiliser `wss://` (recommandé pour la production) :

1. **Obtenez un certificat SSL** (O2Switch fournit Let's Encrypt gratuitement)
2. **Configurez le serveur pour utiliser HTTPS/WSS** :

Modifiez `server.js` pour supporter SSL :

```javascript
import { createServer } from 'https';
import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.SIGNALING_PORT || 5174;

// Configuration SSL (adaptez les chemins selon O2Switch)
const serverOptions = process.env.NODE_ENV === 'production' ? {
  cert: readFileSync('/home/votre-user/ssl/cert.pem'),
  key: readFileSync('/home/votre-user/ssl/key.pem')
} : {};

const server = process.env.NODE_ENV === 'production' 
  ? createServer(serverOptions)
  : createServer();

const wss = new WebSocketServer({ server });

// ... reste du code inchangé ...
```

## 🔧 Configuration de l'Application Frontend

### Étape 1 : Créer les fichiers de variables d'environnement

Dans le dossier `Application/`, créez ces fichiers :

#### `.env.example` (Template pour les développeurs)
```env
# Configuration du serveur de signalisation WebSocket
# Pour le développement local, utilisez : ws://localhost:5174
# Pour la production, utilisez votre URL O2Switch

VITE_SIGNALING_URL=ws://localhost:5174
```

#### `.env` (Développement local)
```env
# URL du serveur WebSocket de signalisation - Développement
VITE_SIGNALING_URL=ws://localhost:5174
```

#### `.env.production` (Production)
```env
# URL du serveur WebSocket de signalisation - Production O2Switch
# Remplacez par votre vrai domaine et port

# Avec SSL (recommandé)
VITE_SIGNALING_URL=wss://votre-domaine.com:5174

# OU Sans SSL (non recommandé pour la production)
# VITE_SIGNALING_URL=ws://votre-domaine.com:5174
```

### Étape 2 : Mettre à jour le .gitignore

Assurez-vous que votre `.gitignore` contient :
```
# Fichiers d'environnement
.env
.env.local
.env.production
.env.*.local
```

### Étape 3 : Build de l'application

```bash
cd Application

# Pour le développement
npm run dev

# Pour la production
npm run build
```

### Étape 4 : Variables d'environnement au build

Lors du build de production, assurez-vous que la variable est définie :

```bash
# Linux/Mac
export VITE_SIGNALING_URL=wss://votre-domaine.com:5174
npm run build

# Windows PowerShell
$env:VITE_SIGNALING_URL="wss://votre-domaine.com:5174"
npm run build

# Windows CMD
set VITE_SIGNALING_URL=wss://votre-domaine.com:5174
npm run build
```

OU simplement avoir le fichier `.env.production` avec la bonne configuration.

## 🧪 Tests

### Test du serveur WebSocket

1. **Via navigateur** :
```javascript
// Console du navigateur
const ws = new WebSocket('wss://votre-domaine.com:5174');
ws.onopen = () => console.log('Connecté !');
ws.onerror = (err) => console.error('Erreur:', err);
```

2. **Via outil en ligne** :
   - https://www.websocket.org/echo.html
   - Entrez votre URL WebSocket : `wss://votre-domaine.com:5174`

### Test de l'application

1. Buildez l'application avec la configuration production
2. Testez en créant un lobby
3. Vérifiez les logs du serveur Node.js dans cPanel

## 🚨 Troubleshooting

### Problème : WebSocket ne se connecte pas

**Solution 1** : Vérifier les logs du serveur
```bash
# Via SSH ou cPanel logs viewer
tail -f ~/abstergo-server/logs/app.log
```

**Solution 2** : Vérifier le pare-feu
- Contactez le support O2Switch pour confirmer que le port WebSocket est ouvert

**Solution 3** : Utiliser un reverse proxy
O2Switch peut nécessiter un reverse proxy. Demandez au support de configurer :
```
wss://votre-domaine.com/ws → localhost:5174
```

### Problème : Mixed Content (HTTP + WebSocket)

Si votre site est en HTTPS mais le WebSocket en WS (non sécurisé), les navigateurs bloqueront la connexion.

**Solution** : Utilisez toujours `wss://` si votre site est en `https://`

### Problème : Port non accessible

O2Switch peut restreindre certains ports. 

**Solution** : 
1. Utilisez le port attribué par O2Switch
2. OU configurez un reverse proxy via .htaccess :

Créez un fichier `.htaccess` dans votre domaine :
```apache
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^ws/(.*)$ ws://localhost:5174/$1 [P,L]
```

Puis utilisez l'URL : `wss://votre-domaine.com/ws`

## 📞 Support O2Switch

Pour toute question spécifique à O2Switch, contactez leur support :
- **Email** : support@o2switch.fr
- **Téléphone** : Voir votre espace client
- **Demandes courantes** :
  - "J'ai besoin d'ouvrir un port WebSocket pour une application Node.js"
  - "Comment configurer un reverse proxy pour WebSocket ?"
  - "Où trouver mes certificats SSL pour WSS ?"

## 📚 Ressources

- [Documentation Node.js cPanel](https://docs.cpanel.net/cpanel/software/application-manager/)
- [WebSocket sur hébergement mutualisé](https://developer.mozilla.org/fr/docs/Web/API/WebSocket)
- [Let's Encrypt SSL](https://letsencrypt.org/)

## 🎯 Checklist Finale

- [ ] Application Node.js créée dans cPanel
- [ ] Fichiers uploadés (server.js, package.json)
- [ ] npm install exécuté
- [ ] Port WebSocket ouvert/configuré
- [ ] SSL configuré (pour wss://)
- [ ] Variables d'environnement définies
- [ ] Application redémarrée
- [ ] .env.production créé dans Application/
- [ ] Build de production testé
- [ ] Test de connexion WebSocket réussi
- [ ] Application mobile/web déployée et testée
