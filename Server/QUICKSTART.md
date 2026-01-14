# Guide de démarrage rapide

## 🚀 Configuration initiale

### 1. Créer le fichier de configuration

Le fichier `.env` a déjà été créé avec les valeurs par défaut :
- Port : **5174**
- Mot de passe : **test123**

### 2. Modifier le mot de passe (optionnel)

Éditez le fichier `.env` et changez la valeur de `mdp` :

```env
mdp=VotreMotDePassePersonnalisé
```

### 3. Désactiver l'authentification (optionnel)

Pour tester sans authentification, commentez la ligne `mdp` dans `.env` :

```env
# mdp=test123
```

## 🎮 Démarrer le serveur

```bash
npm start
```

ou en mode développement avec rechargement automatique :

```bash
npm run dev
```

## 🔒 Tester l'authentification

### Avec mot de passe activé (par défaut)

1. Démarrez le serveur
2. Ouvrez l'application web
3. Sur la page d'accueil, entrez le mot de passe : **test123**
4. Cliquez sur "Se connecter"
5. Vous pouvez maintenant créer ou rejoindre une partie

### Sans mot de passe

1. Commentez `mdp=test123` dans le fichier `.env`
2. Redémarrez le serveur
3. L'application ne demandera pas de mot de passe

## 🔧 Dépannage

### Erreur "Mot de passe invalide"
- Vérifiez que le fichier `.env` existe dans le dossier `Server/`
- Vérifiez que la valeur de `mdp` dans `.env` correspond au mot de passe saisi
- Redémarrez le serveur après toute modification du `.env`

### Le serveur ne démarre pas
- Vérifiez que les dépendances sont installées : `npm install`
- Vérifiez que le port 5174 n'est pas déjà utilisé
- Consultez les logs du serveur pour plus de détails

### L'application ne se connecte pas
- Vérifiez que le serveur est bien démarré
- Vérifiez l'URL de connexion dans la console du navigateur
- Videz le cache du navigateur et rechargez la page

## 📝 Notes importantes

- Le fichier `.env` est ignoré par Git (sécurité)
- Le mot de passe est stocké en clair dans `.env` (pour le dev local uniquement)
- Sur O2Switch, utilisez les variables d'environnement du panel de contrôle
- Le mot de passe côté client est stocké dans sessionStorage (effacé à la fermeture)

## 🌐 URLs de test

- Serveur HTTP : http://localhost:5174
- Page de monitoring : http://localhost:5174/
- Application web : Selon votre configuration Vite (généralement http://localhost:5173)
