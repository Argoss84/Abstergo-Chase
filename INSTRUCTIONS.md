# Instructions de Restructuration

## ✅ Restructuration Terminée

Votre projet a été restructuré avec succès en deux parties indépendantes :
- **Server/** - Serveur WebRTC Node.js
- **Application/** - Application client Ionic React

## ⚠️ Action Requise

Il reste un dossier `node_modules/` à la racine du projet qui doit être supprimé manuellement (il était verrouillé par un processus).

### Pour supprimer le dossier node_modules à la racine :

**Option 1 - Via PowerShell (Administrateur recommandé):**
```powershell
Remove-Item -Path "node_modules" -Recurse -Force
```

**Option 2 - Via l'Explorateur Windows:**
1. Fermez tous les éditeurs/IDEs ouverts
2. Supprimez manuellement le dossier `node_modules` à la racine
3. Si nécessaire, redémarrez votre ordinateur et réessayez

**Option 3 - Via WSL/Git Bash (si disponible):**
```bash
rm -rf node_modules
```

## 🚀 Prochaines Étapes

### 1. Installer les dépendances du Serveur
```bash
cd Server
npm install
```

### 2. Installer les dépendances de l'Application
```bash
cd Application
npm install
```

### 3. Démarrer le projet

**Terminal 1 - Serveur:**
```bash
cd Server
npm start
```

**Terminal 2 - Application:**
```bash
cd Application
npm run dev
```

## 📝 Notes Importantes

- Le serveur démarre sur le port **5174** (configurable via `SIGNALING_PORT`)
- L'application démarre sur le port **5173**
- Chaque partie a maintenant son propre `package.json` et `node_modules`
- Les deux parties peuvent être développées et déployées indépendamment

## 🗑️ Une fois terminé

Vous pouvez supprimer ce fichier `INSTRUCTIONS.md` une fois la suppression du `node_modules` racine effectuée.
