# Abstergo Chase - Serveur WebRTC

Ce serveur gère la signalisation WebRTC pour l'application Abstergo Chase.

## Installation

```bash
npm install
```

## Démarrage

### Mode production
```bash
npm start
```

### Mode développement (avec auto-reload)
```bash
npm run dev
```

## Configuration

Le serveur utilise les variables d'environnement suivantes:

- `SIGNALING_PORT` : Port d'écoute du serveur (défaut: 5174)

## Fonctionnalités

- Création et gestion de lobbies de jeu
- Signalisation WebRTC pour connexions peer-to-peer
- Gestion automatique des déconnexions
- Logs horodatés détaillés

## Architecture

Le serveur utilise WebSocket (via la bibliothèque `ws`) pour communiquer avec les clients et faciliter l'établissement de connexions WebRTC peer-to-peer.
