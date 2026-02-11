# Configuration du serveur

## Configuration locale (développement)

Pour configurer le serveur en local, utilisez le script de configuration :

**Windows (PowerShell) :**
```powershell
.\setup-env.ps1
```

**Linux/macOS :**
```bash
chmod +x setup-env.sh
./setup-env.sh
```

Cela créera un fichier `.env` que vous pourrez éditer pour configurer vos variables d'environnement.

## Variables d'environnement

Le serveur Node.js supporte les variables d'environnement suivantes :

### SIGNALING_PORT
- **Description** : Port sur lequel le serveur écoute
- **Par défaut** : 5174
- **Exemple** : `SIGNALING_PORT=5174`

### SOCKET_IO_PATH
- **Description** : Chemin personnalisé pour Socket.io
- **Par défaut** : /socket.io
- **Exemple** : `SOCKET_IO_PATH=/socket.io`

### mdp
- **Description** : Mot de passe requis pour accéder au serveur
- **Par défaut** : Aucun (accès libre si non défini)
- **Exemple** : `mdp=mon_mot_de_passe_securise`

**Important** : Si la variable `mdp` est définie, tous les clients devront fournir ce mot de passe pour se connecter au serveur. Si elle n'est pas définie, le serveur fonctionnera sans authentification.

## Déploiement sur O2Switch

Pour configurer la variable d'environnement `mdp` sur O2Switch :

1. Connectez-vous à votre panneau de contrôle O2Switch
2. Accédez à la section de configuration de votre application Node.js
3. Ajoutez la variable d'environnement `mdp` avec la valeur souhaitée
4. Redémarrez votre application pour appliquer les changements

## Sécurité

- Utilisez un mot de passe fort et complexe
- Ne partagez jamais le mot de passe dans le code source
- Le mot de passe est stocké temporairement dans sessionStorage côté client (effacé à la fermeture du navigateur)
- La vérification du mot de passe se fait via une requête HTTP POST à `/api/auth`
- Les connexions Socket.io vérifient également le mot de passe via le handshake auth

## API

### POST /api/auth
Vérifie le mot de passe fourni par le client.

**Request Body:**
```json
{
  "password": "mot_de_passe"
}
```

**Response:**
```json
{
  "valid": true
}
```

## Fonctionnement

1. L'utilisateur accède à la page d'accueil de l'application
2. Si un mot de passe est configuré sur le serveur, un formulaire de connexion s'affiche
3. L'utilisateur entre le mot de passe qui est vérifié via l'endpoint `/api/auth`
4. Si le mot de passe est valide, il est stocké dans sessionStorage
5. Toutes les connexions Socket.io ultérieures incluent ce mot de passe dans le handshake
6. Le serveur vérifie le mot de passe à chaque connexion Socket.io

Si le mot de passe est incorrect, la connexion Socket.io sera refusée avec l'erreur "Mot de passe invalide".
