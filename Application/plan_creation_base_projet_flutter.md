# Plan de creation de la base du projet Flutter (Android-first)

## 1. Objectif

Mettre en place un socle Flutter propre, maintenable et pret pour migrer les fonctionnalites metier, avec une priorite absolue sur :

- la fiabilite du temps reel via WebSocket
- la resilience Android (lifecycle, reprise, reconnexion)
- la separation claire des couches (presentation, domaine, transport, persistance)

Ce document se concentre uniquement sur la creation de la base technique du projet, avant la migration complete des ecrans metier.

---

## 2. Principes directeurs

### 2.1 Android en cible initiale

Le socle est pense d'abord pour Android. Les choix techniques doivent privilegier :

- reprise d'etat apres pause/reprise
- robustesse reseau mobile
- stabilite en conditions degradees

### 2.2 WebSocket comme canal temps reel principal

- **HTTP REST** pour bootstrap, fallback et appels ponctuels
- **WebSocket** pour les evenements live, transitions d'etat et resynchronisation

### 2.3 Architecture orientee services

Le code doit isoler les responsabilites pour eviter la logique reseau dans les widgets.

### 2.4 Migration progressive sans casser le backend

La base Flutter doit pouvoir consommer les contrats backend existants sans refonte lourde du protocole.

---

## 3. Structure cible du projet

```text
/lib
  /app
  /core
    /config
    /errors
    /lifecycle
    /logging
    /network
    /storage
  /features
    /bootstrap
    /session
    /lobby
    /game
    /presence
    /settings
  /shared
    /models
    /widgets
    /theme
```

### Responsabilites minimales

- `core/network`: client HTTP, client WebSocket, gestion des erreurs, reconnexion
- `core/storage`: persistance locale sensible et non sensible
- `core/lifecycle`: traduction du cycle de vie Android en evenements applicatifs
- `features/session`: restauration de session, rejoin, resync
- `app`: initialisation globale, routing, gestion d'erreur globale

---

## 4. Stack recommandee

- State management : `riverpod`
- Navigation : `go_router`
- HTTP : `dio`
- Stockage securise : `flutter_secure_storage`
- Stockage simple : `shared_preferences`
- Logs : logger structure (niveau debug/info/warn/error)

Optionnel si cache complexe :

- `isar` (a introduire seulement si besoin reel de cache structure)

---

## 5. Phases de creation du socle

## Phase 0 - Cadrage technique rapide

### Objectif

Verrouiller les choix techniques et les conventions avant de coder.

### Actions

- definir conventions de nommage et d'organisation des dossiers
- figer les dependances initiales
- lister les contrats reseau critiques (HTTP + WebSocket)
- definir la strategie de gestion des erreurs et des logs

### Livrables

- ADR technique courte (choix de stack)
- conventions de projet
- backlog technique du socle

---

## Phase 1 - Initialisation du projet Flutter Android

### Objectif

Avoir une application Flutter Android qui compile et se lance localement.

### Actions

- creer le projet Flutter
- configurer Android (debug/release, package id, versions)
- preparer environnements (dev/staging/prod) si necessaire
- mettre en place une arborescence propre `lib/`

### Livrables

- projet bootable Android
- base de configuration Android
- structure de dossiers validee

---

## Phase 2 - Mise en place des briques transverses

### Objectif

Installer les fondations techniques reutilisables par toutes les features.

### Actions

- configurer `go_router` et l'ecran de bootstrap
- definir le theme global
- mettre en place l'injection de dependances via providers
- ajouter un gestionnaire global d'erreurs
- poser la couche de logging structuree

### Livrables

- routing fonctionnel
- theme global actif
- gestion d'erreurs centralisee
- logging exploitable en debug

---

## Phase 3 - Socle reseau (HTTP + WebSocket)

### Objectif

Rendre le transport fiable, testable et observable.

### Actions

- implementer `ApiClient` (timeouts, erreurs, parsing)
- implementer `WebSocketClient` avec :
  - etat de connexion explicite (`disconnected`, `connecting`, `connected`, `reconnecting`, `degraded`, `resyncRequired`)
  - reconnexion exponentielle
  - deduplication minimale des messages
  - timeout d'emission et gestion ACK
- definir le fallback HTTP en cas d'incoherence d'etat

### Livrables

- `ApiClient` operationnel
- `WebSocketClient` robuste
- machine d'etat de connexion documentee
- politique fallback HTTP formalisee

---

## Phase 4 - Session, persistance et lifecycle Android

### Objectif

Garantir la reprise utilisateur apres interruption.

### Actions

- implementer `SessionRepository` (secure + local prefs)
- implementer `SessionService` (restore, rejoin, resync)
- connecter lifecycle Android (`resumed`, `inactive`, `paused`, `detached`) a la session
- definir le flux de demarrage :
  1. lecture session locale
  2. validation minimale
  3. routage initial
  4. reconnexion WebSocket
  5. rejoin/resync si necessaire

### Livrables

- restauration de session au lancement
- reprise apres pause/reprise Android
- strategie de rejoin/resync active

---

## 6. Definition of Done du socle

Le socle Flutter est considere pret si :

- l'app Android se lance sans ecran bloque
- routing, theme et gestion d'erreur globale fonctionnent
- HTTP est stable et journalise
- WebSocket se reconnecte automatiquement apres coupure
- la session est restauree apres relance de l'application
- une reprise apres background long est validee
- les erreurs critiques sont observables via logs

---

## 7. Plan de verification minimal

### Tests techniques indispensables

- lancement a froid
- perte reseau puis retour reseau
- passage Wi-Fi vers 4G/5G
- mode avion on/off
- app en arriere-plan puis reprise
- kill process puis redemarrage

### Resultat attendu

Le socle reste coherent, reconnecte le WebSocket, restaure la session et declenche un resync si l'etat local devient incertain.

---

## 8. Ordonnancement conseille (4 sprints)

- **Sprint 1** : phases 0 et 1
- **Sprint 2** : phase 2
- **Sprint 3** : phase 3
- **Sprint 4** : phase 4 + verification minimale

---

## 9. Resultat final attendu

Une base Flutter Android industrialisable, prete a accueillir la migration des parcours metier (bootstrap utilisateur, lobby, jeu), avec un coeur temps reel fiable et une resilience mobile solide.
