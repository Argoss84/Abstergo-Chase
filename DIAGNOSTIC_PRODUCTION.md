# 🔍 Guide de Diagnostic - Problème de Création de Lobby en Production

## Problème Identifié
La connexion WebSocket fonctionne (le client apparaît dans le monitoring), mais le lobby ne se crée pas.

## Modifications Apportées

### 1. Serveur (`server/server.js`)
✅ **Logging renforcé** :
- Log du message brut reçu (taille + contenu)
- Log des erreurs de parsing JSON
- Log des types de messages non reconnus
- Message d'erreur envoyé au client si le type n'est pas reconnu

### 2. Client (`Application/src/services/GameSessionService.ts`)
✅ **Logging détaillé** :
- Log de toutes les étapes de connexion
- Log avant chaque envoi de message
- Log de chaque message reçu
- Log des états du WebSocket

✅ **Gestion des erreurs** :
- Timeout de 15 secondes pour `lobby:create` (avant : infini)
- Messages d'erreur explicites si le socket n'est pas ouvert
- Try-catch autour de la création de lobby

## 📊 Comment Diagnostiquer

### Étape 1 : Vérifier la Console du Navigateur

Ouvrez la console JavaScript du navigateur (F12) et tentez de créer un lobby. Vous devriez voir :

```
[GameSession] Début de la création du lobby
[GameSession] Connexion au serveur WebSocket: wss://abstergochase.fr
[GameSession] WebSocket connecté avec succès
[GameSession] Socket prêt, envoi de la requête lobby:create
[GameSession] Envoi message: {type: "lobby:create", payload: {playerName: "..."}}
[GameSession] En attente du message: lobby:created
[GameSession] Message reçu du serveur: {...}
[GameSession] Résolution de l'action en attente: lobby:created
[GameSession] Lobby créé avec succès: XXXXXXXX
```

### Étape 2 : Vérifier les Logs Serveur

Sur votre serveur O2Switch, consultez les logs Node.js :

```bash
# Si vous utilisez PM2
pm2 logs signaling-server

# Ou si vous utilisez node directement
# Consultez le fichier de log configuré
```

Vous devriez voir :

```
[XX/XX/XXXX XX:XX:XX] [CONNEXION] Nouveau client connecté: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[XX/XX/XXXX XX:XX:XX] [MESSAGE BRUT REÇU] ClientId: xxx, Taille: XX octets, Contenu: {"type":"lobby:create",...}
[XX/XX/XXXX XX:XX:XX] [MESSAGE REÇU] ClientId: xxx, Type: lobby:create, Payload: { playerName: '...' }
[XX/XX/XXXX XX:XX:XX] [LOBBY CRÉÉ] Code: XXXXXXXX, Host: xxx, Nom: ...
[XX/XX/XXXX XX:XX:XX] [MESSAGE ENVOYÉ] À: xxx, Type: lobby:created
```

## 🐛 Scénarios de Problème Possibles

### Scénario A : Le message n'est jamais envoyé
**Symptômes dans la console** :
```
[GameSession] Impossible d'envoyer lobby:create: socket pas ouvert (état: X)
```

**Cause** : Le WebSocket n'est pas vraiment connecté malgré l'affichage

**Solution** :
- Vérifiez votre configuration SSL/TLS
- Assurez-vous que le port est bien ouvert sur votre serveur
- Vérifiez que `VITE_SIGNALING_URL` pointe vers la bonne URL

### Scénario B : Le message est envoyé mais jamais reçu par le serveur
**Symptômes** :
- Console client : Message envoyé ✅
- Logs serveur : Aucun message reçu ❌

**Cause** : Problème réseau ou proxy qui bloque les messages

**Solution** :
- Vérifiez les règles firewall
- Vérifiez si un reverse proxy (comme nginx) intercepte les connexions WebSocket
- Testez avec un outil externe comme : https://www.websocket.org/echo.html

### Scénario C : Le message est reçu mais pas traité
**Symptômes** :
- Console client : Message envoyé ✅
- Logs serveur : `[AVERTISSEMENT] Type de message non reconnu: lobby:create`

**Cause** : Format du message incorrect

**Solution** :
- Vérifiez que le message est bien au format `{type: "lobby:create", payload: {...}}`
- Consultez les logs "MESSAGE BRUT REÇU" pour voir le contenu exact

### Scénario D : Le serveur répond mais le client ne reçoit pas
**Symptômes** :
- Logs serveur : `[MESSAGE ENVOYÉ] À: xxx, Type: lobby:created` ✅
- Console client : Timeout après 15 secondes ❌

**Cause** : Connexion unidirectionnelle (peut envoyer mais pas recevoir)

**Solution** :
- Problème de proxy/firewall bloquant les messages du serveur vers le client
- Vérifiez la configuration de votre reverse proxy si vous en utilisez un

## 🔧 Configuration à Vérifier

### 1. Variables d'Environnement Client

Vérifiez dans `Application/.env.production` :
```env
VITE_SIGNALING_URL=wss://abstergochase.fr
```

**Important** : Pas de port si vous utilisez un proxy, sinon ajoutez `:5174`

### 2. Configuration Reverse Proxy (si applicable)

Si vous utilisez nginx ou Apache devant votre serveur Node.js :

#### Nginx
```nginx
location /ws {
    proxy_pass http://localhost:5174;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

#### Apache
```apache
<VirtualHost *:443>
    ProxyPreserveHost On
    ProxyPass /ws ws://localhost:5174/
    ProxyPassReverse /ws ws://localhost:5174/
</VirtualHost>
```

### 3. Pare-feu O2Switch

Vérifiez que le port 5174 est ouvert :
```bash
sudo ufw status
# Si le port n'est pas ouvert :
sudo ufw allow 5174/tcp
```

## 🧪 Test Manuel

Pour tester la connexion WebSocket directement :

```javascript
// Dans la console du navigateur sur votre site en production
const ws = new WebSocket('wss://abstergochase.fr');

ws.onopen = () => {
    console.log('✅ Connexion établie');
    
    // Envoyer un message de test
    ws.send(JSON.stringify({
        type: 'lobby:create',
        payload: { playerName: 'Test' }
    }));
    console.log('📤 Message lobby:create envoyé');
};

ws.onmessage = (event) => {
    console.log('📥 Message reçu:', event.data);
};

ws.onerror = (error) => {
    console.error('❌ Erreur:', error);
};

ws.onclose = () => {
    console.log('🔌 Connexion fermée');
};
```

Si vous recevez un message `lobby:created`, alors le problème vient du code de l'application, sinon c'est un problème d'infrastructure.

## 📞 Informations à Collecter

Si le problème persiste, collectez ces informations :

1. **Console navigateur** : Copier tous les logs `[GameSession]`
2. **Logs serveur** : Les 50 dernières lignes lors de la tentative
3. **Configuration** :
   - URL dans `VITE_SIGNALING_URL`
   - Utilisation ou non d'un reverse proxy
   - Certificat SSL utilisé (Let's Encrypt, autre ?)
4. **Test manuel** : Résultat du test JavaScript ci-dessus

## 🎯 Prochaines Étapes

1. ✅ Redéployer l'application avec le nouveau code
2. ✅ Ouvrir la console du navigateur
3. ✅ Tenter de créer un lobby
4. ✅ Comparer les logs client/serveur
5. ✅ Identifier le scénario correspondant
6. ✅ Appliquer la solution appropriée

---

**Note** : Avec les nouveaux logs, vous aurez une visibilité complète sur où le processus échoue exactement.
