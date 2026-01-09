# Configuration des Variables d'Environnement

## 📝 Fichiers à créer

Pour configurer votre application pour pointer vers le bon serveur WebSocket, vous devez créer les fichiers suivants dans le dossier `Application/` :

### 1. `.env.example` (Template - à commiter)

Créez `Application/.env.example` :

```env
# Configuration du serveur de signalisation WebSocket
# Pour le développement local, utilisez : ws://localhost:5174
# Pour la production, utilisez votre URL O2Switch (voir ci-dessous)

# URL du serveur WebSocket de signalisation
# Format: ws://votre-domaine.com:port OU wss://votre-domaine.com:port (SSL recommandé)
VITE_SIGNALING_URL=ws://localhost:5174

# Exemples de configuration :
# Développement local : ws://localhost:5174
# Production O2Switch (sans SSL) : ws://votre-domaine.com:5174
# Production O2Switch (avec SSL) : wss://votre-domaine.com:5174
```

### 2. `.env` (Développement local - NE PAS commiter)

Créez `Application/.env` :

```env
# Configuration du serveur de signalisation WebSocket
# ⚠️ NE PAS COMMITER CE FICHIER - Il est dans .gitignore

# URL du serveur WebSocket de signalisation - LOCAL
VITE_SIGNALING_URL=ws://localhost:5174
```

### 3. `.env.production` (Production - NE PAS commiter)

Créez `Application/.env.production` :

```env
# Configuration de production pour O2Switch
# Remplacez 'votre-domaine.com' et '5174' par vos vraies valeurs

# URL du serveur WebSocket de signalisation en production
# Utilisez wss:// si vous avez configuré SSL (recommandé)
VITE_SIGNALING_URL=wss://votre-domaine.com:5174

# Alternative sans SSL (moins sécurisé, non recommandé)
# VITE_SIGNALING_URL=ws://votre-domaine.com:5174
```

## 🔍 Comment ça fonctionne ?

Votre application utilise déjà cette configuration dans `src/services/GameSessionService.ts` :

```typescript
const url = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:5174';
```

Vite va automatiquement charger le bon fichier `.env` selon le mode :
- `npm run dev` → `.env`
- `npm run build` → `.env.production`

## 🚀 Utilisation

### Développement local

```bash
cd Application
npm run dev
```

L'application utilisera `VITE_SIGNALING_URL` depuis `.env` (ws://localhost:5174)

### Build de production

```bash
cd Application
npm run build
```

L'application utilisera `VITE_SIGNALING_URL` depuis `.env.production`

### Build avec override manuel

Si vous voulez forcer une URL spécifique au moment du build :

**Linux/Mac :**
```bash
export VITE_SIGNALING_URL=wss://mon-domaine.com:5174
npm run build
```

**Windows PowerShell :**
```powershell
$env:VITE_SIGNALING_URL="wss://mon-domaine.com:5174"
npm run build
```

**Windows CMD :**
```cmd
set VITE_SIGNALING_URL=wss://mon-domaine.com:5174
npm run build
```

## 🔒 Sécurité

### ⚠️ Important : .gitignore

Vérifiez que votre `Application/.gitignore` contient :

```
# Fichiers d'environnement (ne jamais commiter)
.env
.env.local
.env.production
.env.production.local
.env.*.local
```

**SEUL `.env.example` doit être commité** pour servir de template aux autres développeurs.

## 📋 Configuration selon l'environnement

| Environnement | Fichier | URL Recommandée | Protocole |
|---------------|---------|-----------------|-----------|
| Développement local | `.env` | `ws://localhost:5174` | WS (non sécurisé OK en local) |
| Production O2Switch | `.env.production` | `wss://votre-domaine.com:5174` | WSS (sécurisé recommandé) |
| Test/Staging | `.env.staging` | `wss://staging.votre-domaine.com:5174` | WSS |

## 🧪 Test de la configuration

### 1. Vérifier que la variable est chargée

Ajoutez temporairement dans votre code (par exemple dans `src/main.tsx`) :

```typescript
console.log('WebSocket URL:', import.meta.env.VITE_SIGNALING_URL);
```

### 2. Test en développement

```bash
npm run dev
```

Ouvrez la console du navigateur et vérifiez l'URL affichée.

### 3. Test du build de production

```bash
npm run build
npm run preview
```

Vérifiez dans la console que l'URL correspond à votre `.env.production`.

## 🎯 Checklist

- [ ] Créer `Application/.env.example` (avec URL d'exemple)
- [ ] Créer `Application/.env` (avec ws://localhost:5174)
- [ ] Créer `Application/.env.production` (avec votre URL O2Switch)
- [ ] Vérifier que `.gitignore` exclut les fichiers .env
- [ ] Commiter uniquement `.env.example`
- [ ] Tester `npm run dev` → connexion locale
- [ ] Tester `npm run build` → vérifie l'URL en console
- [ ] Déployer le build sur votre hébergeur
- [ ] Tester la connexion WebSocket en production

## 🚨 Troubleshooting

### ❌ Erreur : "Cannot connect to WebSocket"

**Vérifiez :**
1. Le fichier `.env` (ou `.env.production`) existe
2. La variable `VITE_SIGNALING_URL` est bien définie
3. L'URL est correcte (wss:// pour HTTPS, ws:// pour HTTP)
4. Le serveur Node.js est bien démarré sur O2Switch
5. Le port est ouvert dans le pare-feu O2Switch

### ❌ Erreur : "Mixed Content" dans la console

**Problème** : Votre site est en HTTPS mais le WebSocket en WS (non sécurisé).

**Solution** : Utilisez `wss://` dans `.env.production` au lieu de `ws://`

### ❌ La variable n'est pas chargée

**Vérifiez :**
1. Le nom commence bien par `VITE_` (requis par Vite)
2. Vous avez redémarré le serveur de dev après avoir modifié `.env`
3. Le fichier `.env` est à la racine de `Application/`

## 📚 Pour aller plus loin

- [Documentation Vite - Variables d'environnement](https://vitejs.dev/guide/env-and-mode.html)
- [Guide de déploiement O2Switch](./Server/DEPLOYMENT_O2SWITCH.md)
- [Documentation WebSocket MDN](https://developer.mozilla.org/fr/docs/Web/API/WebSocket)
