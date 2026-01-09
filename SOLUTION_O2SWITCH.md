# 🔧 Solution pour O2Switch + Application Node.js

## Problème Identifié

Sur O2Switch, votre application Node.js tourne derrière un **Apache en reverse proxy** qui ne transmet pas correctement les messages WebSocket bidirectionnels.

## ✅ Solution Complète

### Étape 1 : Vérifier les Modules Apache (via cPanel)

1. **Connectez-vous à cPanel O2Switch**
2. **Allez dans "Apache Modules" ou "Select PHP Version"**
3. **Vérifiez que ces modules sont activés** :
   - ✅ `mod_proxy`
   - ✅ `mod_proxy_http`
   - ✅ `mod_proxy_wstunnel` ⚠️ **LE PLUS IMPORTANT**
   - ✅ `mod_rewrite`

> **Important** : Si `mod_proxy_wstunnel` n'est pas disponible, contactez le support O2Switch pour l'activer.

---

### Étape 2 : Configurer le .htaccess

**Option A : Via .htaccess (si les modules sont disponibles)**

Uploadez le fichier `.htaccess` que j'ai créé (`server/.htaccess`) dans le **dossier public** de votre application Node.js.

Contenu du fichier :
```apache
RewriteEngine On

# WebSocket
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule /(.*)           ws://localhost:5174/$1 [P,L]

# HTTP normal
RewriteCond %{HTTP:Upgrade} !=websocket [NC]
RewriteRule /(.*)           http://localhost:5174/$1 [P,L]

<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyTimeout 86400
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</IfModule>
```

---

### Étape 3 : Configuration de l'Application Node.js O2Switch

Dans le panneau O2Switch "Setup Node.js App" :

1. **Application Mode** : Production
2. **Application URL** : `https://abstergochase.fr`
3. **Application Root** : `/home/votre_user/abstergochase.fr/server` (ou le chemin de votre serveur)
4. **Application Startup File** : `server.js`
5. **Variables d'environnement** :
   ```
   SIGNALING_PORT=5174
   NODE_ENV=production
   ```

---

### Étape 4 : Redémarrer l'Application

Dans le panneau O2Switch "Setup Node.js App" :
- Cliquez sur "Restart" ou "Stop/Start"

---

### Étape 5 : Tester

1. **Ouvrez la console de votre navigateur** sur `https://abstergochase.fr`

2. **Testez la connexion** :
```javascript
const ws = new WebSocket('wss://abstergochase.fr');

ws.onopen = () => {
    console.log('✅ WebSocket connecté');
    ws.send(JSON.stringify({
        type: 'lobby:create',
        payload: { playerName: 'Test' }
    }));
};

ws.onmessage = (e) => {
    console.log('📥 Message reçu du serveur:', e.data);
    const msg = JSON.parse(e.data);
    if (msg.type === 'lobby:created') {
        console.log('🎉 SUCCÈS! Lobby créé:', msg.payload.code);
    }
};

ws.onerror = (e) => console.error('❌ Erreur WebSocket:', e);
ws.onclose = () => console.log('🔌 WebSocket fermé');
```

3. **Vérifiez les logs** dans votre interface de monitoring : `https://abstergochase.fr`

---

## 🚨 Si ça ne Marche Toujours Pas

### Solution Alternative : Sous-domaine Dédié

Si O2Switch ne supporte pas `mod_proxy_wstunnel` ou si la configuration ne fonctionne pas :

1. **Créez un sous-domaine** : `ws.abstergochase.fr`
2. **Configurez-le comme une application Node.js séparée**
3. **Modifiez votre client** pour se connecter à `wss://ws.abstergochase.fr`

#### Configuration Client (`Application/.env.production`) :
```env
VITE_SIGNALING_URL=wss://ws.abstergochase.fr
```

#### Avantages :
- ✅ Apache n'interfère pas avec les WebSocket
- ✅ Configuration plus simple
- ✅ Plus de contrôle

---

## 📞 Contact Support O2Switch

Si `mod_proxy_wstunnel` n'est pas disponible, contactez le support :

**Email** : support@o2switch.fr

**Message type** :
```
Bonjour,

J'utilise une application Node.js avec WebSocket sur mon hébergement O2Switch.
Pour que les WebSocket fonctionnent correctement via le reverse proxy Apache,
j'ai besoin que le module "mod_proxy_wstunnel" soit activé.

Pouvez-vous vérifier s'il est disponible et l'activer si nécessaire ?

Merci d'avance.
```

---

## 🔍 Diagnostic

### Vérifier si mod_proxy_wstunnel est actif

Créez un fichier `test-modules.php` :
```php
<?php
phpinfo();
?>
```

Uploadez-le et ouvrez-le dans votre navigateur.
Cherchez "Loaded Modules" et vérifiez si `mod_proxy_wstunnel` apparaît.

---

## 📊 Checklist

- [ ] Modules Apache vérifiés (surtout `mod_proxy_wstunnel`)
- [ ] Fichier `.htaccess` uploadé dans le bon dossier
- [ ] Application Node.js configurée dans cPanel
- [ ] Port 5174 configuré dans les variables d'environnement
- [ ] Application redémarrée
- [ ] Test JavaScript effectué
- [ ] Logs serveur vérifiés dans l'interface de monitoring

---

## 🎯 Résultat Attendu

Après configuration, dans les logs serveur vous devriez voir :

```
[XX/XX/XXXX XX:XX:XX] [CONNEXION] Nouveau client connecté: xxx
[XX/XX/XXXX XX:XX:XX] [MESSAGE BRUT REÇU] ClientId: xxx, Taille: 52 octets
[XX/XX/XXXX XX:XX:XX] [MESSAGE REÇU] Type: lobby:create, Payload: {playerName: 'Test'}
[XX/XX/XXXX XX:XX:XX] [LOBBY CRÉÉ] Code: XXXXXXXX, Host: xxx
[XX/XX/XXXX XX:XX:XX] [MESSAGE ENVOYÉ] À: xxx, Type: lobby:created
```

Et côté client :
```
[GameSession] WebSocket connecté avec succès
[GameSession] Envoi message: {type: 'lobby:create'...}
[GameSession] Message reçu du serveur: {"type":"lobby:created"...}
[GameSession] Lobby créé avec succès: XXXXXXXX
```

---

## 💡 Alternative Ultime : VPS Externe pour WebSocket

Si O2Switch ne supporte vraiment pas les WebSocket correctement, vous pouvez :

1. **Garder votre site web sur O2Switch**
2. **Héberger UNIQUEMENT le serveur WebSocket sur un VPS** (5-10€/mois) :
   - DigitalOcean Droplet (6$/mois)
   - OVH VPS (4€/mois)
   - Scaleway (4€/mois)

3. **Configuration** :
   ```env
   # Application/.env.production
   VITE_SIGNALING_URL=wss://ws-externe.votre-domaine.com
   ```

Avantages :
- ✅ Contrôle total sur le serveur WebSocket
- ✅ Pas de limitations d'hébergement mutualisé
- ✅ Meilleure performance
- ✅ Plus de flexibilité

---

Commencez par tester la **Solution avec .htaccess**, c'est la plus simple si les modules sont disponibles ! 🚀
