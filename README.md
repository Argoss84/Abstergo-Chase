# Abstergo Chase

Jeu de géolocalisation multijoueur avec mode Agent et mode Rogue.

## Structure du Projet

Ce projet est divisé en deux parties indépendantes :

### 📱 Application (Client)
Le dossier `Application/` contient l'application mobile/web développée avec :
- **React** + **TypeScript**
- **Ionic Framework** pour l'interface mobile
- **Vite** comme bundler
- **Capacitor** pour les fonctionnalités natives

Pour démarrer l'application, consultez `Application/README.md`

### 🖥️ Server (Backend)
Le dossier `Server/` contient le serveur de signalisation WebRTC :
- **Node.js** avec WebSocket
- Gestion des lobbies de jeu
- Signalisation pour connexions peer-to-peer

Pour démarrer le serveur, consultez `Server/README.md`

## Installation Rapide

### Serveur
```bash
cd Server
npm install
npm start
```

### Application
```bash
cd Application
npm install
npm run dev
```

## Architecture

```
Abstergo-Chase/
├── Server/              # Serveur WebRTC Node.js
│   ├── server.js
│   ├── package.json
│   └── README.md
│
└── Application/         # Application client Ionic React
    ├── src/
    ├── public/
    ├── package.json
    └── README.md
```

## Développement

Chaque partie du projet possède ses propres dépendances et peut être développée indépendamment.

1. **Démarrez d'abord le serveur** (port 5174 par défaut)
2. **Puis lancez l'application** (port 5173 par défaut)

## License

Voir le fichier LICENSE dans le dossier Application.
