# 🔧 Solution au Problème de Production

## 📊 Diagnostic

D'après vos logs :

**Serveur** :
```
[09/01/2026 15:19:29] [CONNEXION] Nouveau client connecté: 7ea900fa-ab0d-4f55-804b-35940a1de27d
```
✅ Le client se connecte

**Client** :
```
[GameSession] WebSocket connecté avec succès
[GameSession] Envoi message: {type: 'lobby:create', payload: {…}}
[GameSession] Timeout en attente de: lobby:created (15000ms)
```
✅ Le client envoie le message
❌ Le serveur ne le reçoit JAMAIS

## 🎯 Le Problème Identifié

**Communication unidirectionnelle** : La connexion WebSocket s'établit, mais les messages du client vers le serveur sont bloqués.

### Cause Principale : Reverse Proxy Mal Configuré

Vous utilisez probablement **nginx**, **Apache**, ou **Cloudflare** devant votre serveur Node.js, et il ne transmet pas correctement les messages WebSocket bidirectionnels.

## ✅ Solutions (par ordre de probabilité)

### Solution A : Connexion Directe au Port 5174

**La plus simple pour tester :**

1. **Ouvrez le port 5174 sur votre serveur** :
```bash
# Via firewall
sudo ufw allow 5174/tcp

# Via iptables
sudo iptables -A INPUT -p tcp --dport 5174 -j ACCEPT
```

2. **Modifiez l'URL côté client** :

Créez/modifiez `Application/.env.production` :
```env
VITE_SIGNALING_URL=wss://abstergochase.fr:5174
```

3. **Rebuild et redéployez** :
```bash
cd Application
npm run build
# Déployez le dossier dist/
```

**Note** : Vous devrez peut-être configurer SSL/TLS sur le serveur Node.js directement.

---

### Solution B : Configurer Correctement Nginx

**Si vous voulez que nginx gère le SSL :**

1. **Éditez votre configuration nginx** (`/etc/nginx/sites-available/abstergochase.fr`) :

```nginx
# Map pour gérer l'upgrade WebSocket (avant le bloc server)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name abstergochase.fr;

    # Configuration SSL
    ssl_certificate /etc/letsencrypt/live/abstergochase.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/abstergochase.fr/privkey.pem;

    # WebSocket vers Node.js
    location / {
        proxy_pass http://127.0.0.1:5174;
        
        # Headers essentiels pour WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts pour WebSocket
        proxy_connect_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_read_timeout 86400s;
        
        # Désactiver le buffering pour WebSocket
        proxy_buffering off;
    }
}

# Redirection HTTP -> HTTPS
server {
    listen 80;
    server_name abstergochase.fr;
    return 301 https://$server_name$request_uri;
}
```

2. **Testez et rechargez nginx** :
```bash
sudo nginx -t
sudo systemctl reload nginx
```

3. **URL côté client** : `wss://abstergochase.fr` (sans port)

---

### Solution C : Configurer Apache (avec mod_proxy_wstunnel)

**Si vous utilisez Apache :**

1. **Activez les modules nécessaires** :
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel
sudo systemctl restart apache2
```

2. **Éditez votre VirtualHost** (`/etc/apache2/sites-available/abstergochase.fr-ssl.conf`) :

```apache
<VirtualHost *:443>
    ServerName abstergochase.fr
    
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/abstergochase.fr/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/abstergochase.fr/privkey.pem
    
    # Configuration WebSocket
    ProxyPreserveHost On
    ProxyRequests Off
    
    # WebSocket Tunnel
    ProxyPass / ws://127.0.0.1:5174/
    ProxyPassReverse / ws://127.0.0.1:5174/
    
    # Timeouts
    ProxyTimeout 86400
</VirtualHost>
```

3. **Rechargez Apache** :
```bash
sudo systemctl reload apache2
```

---

### Solution D : Vérifier Cloudflare (si utilisé)

**Si vous utilisez Cloudflare** :

Cloudflare peut bloquer les WebSocket selon votre plan :

1. **Vérifiez les paramètres Cloudflare** :
   - Dashboard → Network
   - Activez "WebSockets" si disponible

2. **Utilisez le mode "Full" pour SSL** :
   - Dashboard → SSL/TLS
   - Mode : "Full" ou "Full (strict)"

3. **Vérifiez les règles de pare-feu** qui pourraient bloquer les messages

---

## 🧪 Tests de Diagnostic

### Test 1 : Connexion Directe au Port

```javascript
// Dans la console du navigateur
const ws = new WebSocket('wss://abstergochase.fr:5174');
ws.onopen = () => {
    console.log('✅ Connecté');
    ws.send(JSON.stringify({type: 'lobby:create', payload: {playerName: 'Test'}}));
};
ws.onmessage = (e) => console.log('📥 Reçu:', e.data);
ws.onerror = (e) => console.error('❌ Erreur:', e);
```

**Si ça marche** : Utilisez la Solution A
**Si ça ne marche pas** : Le port 5174 n'est pas accessible

### Test 2 : Connexion via Proxy

```javascript
const ws = new WebSocket('wss://abstergochase.fr');
ws.onopen = () => {
    console.log('✅ Connecté');
    ws.send(JSON.stringify({type: 'lobby:create', payload: {playerName: 'Test'}}));
};
ws.onmessage = (e) => console.log('📥 Reçu:', e.data);
ws.onerror = (e) => console.error('❌ Erreur:', e);
```

**Si ça marche** : Votre proxy est bien configuré, le problème est ailleurs
**Si seule la connexion marche mais pas les messages** : Configurez le proxy (Solutions B/C)

### Test 3 : wscat (outil en ligne de commande)

```bash
# Sur votre serveur
npm install -g wscat

# Test direct
wscat -c ws://localhost:5174
> {"type":"lobby:create","payload":{"playerName":"Test"}}

# Test via proxy
wscat -c wss://abstergochase.fr
> {"type":"lobby:create","payload":{"playerName":"Test"}}
```

---

## 📋 Checklist

- [ ] Vérifier quel reverse proxy est utilisé (nginx/Apache/Cloudflare)
- [ ] Vérifier si le port 5174 est ouvert sur le serveur
- [ ] Tester la connexion directe au port 5174
- [ ] Vérifier les logs nginx/Apache (`/var/log/nginx/error.log`)
- [ ] Vérifier que les modules WebSocket sont activés
- [ ] Configurer correctement les headers `Upgrade` et `Connection`
- [ ] Augmenter les timeouts du proxy
- [ ] Désactiver le buffering du proxy
- [ ] Tester avec wscat ou la console du navigateur

---

## 🎯 Recommandation

**Pour O2Switch** (hébergement mutualisé typique) :

1. **Vérifiez d'abord s'ils supportent les WebSocket**
   - Contactez le support O2Switch
   - Certains hébergements mutualisés bloquent les WebSocket

2. **Si supporté, utilisez la Solution B (nginx)** :
   - O2Switch utilise généralement nginx en reverse proxy
   - Demandez-leur de configurer le proxy pour WebSocket
   - Ou demandez l'accès pour le configurer vous-même

3. **Sinon, utilisez un VPS dédié** :
   - Les WebSocket nécessitent souvent un VPS
   - Plus de contrôle sur la configuration
   - Exemples : DigitalOcean, OVH VPS, AWS EC2

---

## 📞 Prochaines Étapes

1. **Identifiez votre configuration actuelle** :
   - Quel serveur web ? (nginx/Apache/autre)
   - Avez-vous accès à la configuration ?
   - Utilisez-vous Cloudflare ?

2. **Testez la connexion directe** :
   - Ouvrez le port 5174
   - Modifiez l'URL pour inclure le port
   - Testez si ça fonctionne

3. **Partagez les résultats** :
   - Logs nginx/Apache si disponibles
   - Résultat du test de connexion directe
   - Type d'hébergement utilisé

Une fois ces informations collectées, je pourrai vous donner la solution exacte pour votre configuration !
