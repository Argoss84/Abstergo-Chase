# Déploiement Docker

Ce dossier décrit la stack **MariaDB**, **ServerBDD** (API), **signaling** (Socket.IO) et le **frontend** (build statique + nginx).

## Prérequis

- Docker avec Compose v2
- Racine du dépôt comme contexte de build (les `Dockerfile` copient `Server/`, `ServerBDD/`, `Application/`)

## Démarrage rapide

1. Copier l’exemple de variables d’environnement :

   ```bash
   cp env.example .env
   ```

   Éditer `.env` : choisir des mots de passe forts pour `MYSQL_ROOT_PASSWORD` et `MYSQL_PASSWORD`.

2. Depuis le dossier `Docker/` :

   ```bash
   docker compose up --build
   ```

3. Accès par défaut :

   - Application : `http://localhost:8080` (variable `WEB_PUBLISH_PORT`)
   - Signalisation : `http://localhost:5174` (`SIGNALING_PUBLISH_PORT`)
   - API ServerBDD : `http://localhost:5175` (`SERVERBDD_PUBLISH_PORT`)

Les valeurs `VITE_API_URL` et `VITE_SIGNALING_URL` du fichier `.env` sont passées au **build** de l’image `web`. Après un changement de domaine ou de port exposé, reconstruire :

```bash
docker compose build --no-cache web && docker compose up -d
```

## Fichiers

| Fichier | Rôle |
|---------|------|
| `docker-compose.yml` | Orchestration des quatre services |
| `docker-compose.application.yml` | **Application seule** (Vite + nginx), sans BDD ni signaling |
| `Dockerfile.signaling` | Image Node pour `Server/server.js` |
| `Dockerfile.serverbdd` | Image Node pour `ServerBDD/server.js` |
| `Dockerfile.web` | Build Vite + nginx pour l’`Application` |
| `nginx.conf` | SPA React : `try_files` + cache assets |
| `env.example` | Modèle pour `.env` local |
| `env.application.example` | Modèle pour le compose Application seule |

**Application seule** (signaling / API déjà lancés ailleurs) :

```bash
docker compose -f docker-compose.application.yml up --build
```

Puis `http://localhost:8080` (ou `APPLICATION_PUBLISH_PORT`).

Le script SQL `ServerBDD/scripts/create_game_replay_tables.sql` est monté dans MariaDB au premier démarrage du volume `db_data`.

## Fichier `.dockerignore` (racine du dépôt)

Un `.dockerignore` à la racine du dépôt (`Abstergo-Chase-1/.dockerignore`) réduit le contexte envoyé au démon (exclut `node_modules`, `.git`, etc.). Le chemin est implicite lorsque `context: ..` pointe sur cette racine.

## TURN / WebRTC

`Dockerfile.web` accepte en build les variables `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` (voir `docker-compose.yml` et `docker-compose.application.yml`).
