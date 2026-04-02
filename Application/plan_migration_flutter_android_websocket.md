# Plan de migration du front vers Flutter Android
## Priorité : architecture temps réel basée sur WebSocket

## 1. Objectif du document

Ce document décrit un plan de migration précis du front actuel vers **Flutter** avec comme cible prioritaire **Android**, en privilégiant une architecture **temps réel fondée sur WebSocket**.

Le plan part des constats suivants :

- le backend actuel est en **TypeScript**
- l'application utilise déjà une logique temps réel avancée
- la reconnexion, le rejoin et la resynchronisation sont des sujets critiques
- l'objectif principal est de produire une application **Android stable**, avant toute extension vers d'autres plateformes
- la priorité réseau doit être donnée à **WebSocket**, avec une logique d'échange claire et durable

---

## 2. Principes directeurs

### 2.1 Priorité au WebSocket

Le protocole temps réel doit être conçu autour de **WebSocket** comme canal principal pour :

- la connexion temps réel persistante
- les notifications de session
- les événements de lobby
- les transitions de partie
- la synchronisation d'état
- la reprise après reconnexion
- les signaux de présence et d'activité

### 2.2 Séparation claire des responsabilités réseau

Le front Flutter doit utiliser :

- **HTTP REST** pour :
  - l'initialisation
  - les appels métier non temps réel
  - les chargements ponctuels
  - la récupération d'état de secours
- **WebSocket** pour :
  - les événements temps réel
  - les changements d'état de session
  - les updates de lobby
  - les actions de jeu nécessitant faible latence
  - les mécanismes de resynchronisation

### 2.3 Migration sans réécriture inutile du backend

Le protocole métier existant doit être conservé autant que possible afin de :

- limiter les régressions
- réduire le coût de migration
- permettre une coexistence temporaire entre front actuel et front Flutter
- concentrer l'effort sur la fiabilité mobile et Android

### 2.4 Android d'abord

La cible initiale est exclusivement **Android**.  
Le plan ne cherche pas à couvrir immédiatement :

- iOS
- Flutter Web
- desktop

---

## 3. Cible d'architecture Flutter

## 3.1 Architecture applicative recommandée

Le front Flutter doit être structuré en couches :

```text
/lib
  /app
  /core
    /network
    /storage
    /lifecycle
    /errors
    /logging
    /config
  /features
    /auth
    /bootstrap
    /lobby
    /game
    /session
    /presence
    /settings
  /shared
    /models
    /widgets
    /theme
```

## 3.2 Séparation des couches

### Couche transport
Responsable de :

- HTTP client
- WebSocket client
- sérialisation / désérialisation
- gestion des erreurs réseau
- stratégie de reconnexion

### Couche domaine
Responsable de :

- session utilisateur
- état de lobby
- état de partie
- présence utilisateur
- règles de transition fonctionnelle

### Couche présentation
Responsable de :

- pages
- widgets
- providers / view models
- navigation

### Couche persistance locale
Responsable de :

- session locale
- cache minimal de reprise
- token
- identifiants de rejoin
- statut de dernière connexion utile

---

## 4. Contraintes de migration

## 4.1 Contraintes fonctionnelles

La migration doit préserver :

- le parcours de création de session
- le parcours de rejoin lobby
- le parcours de rejoin game
- la reprise après coupure réseau
- la reprise après mise en arrière-plan
- la cohérence des rôles et états joueurs
- la logique de resync serveur

## 4.2 Contraintes techniques

Le front Flutter Android doit remplacer proprement les mécanismes du navigateur, notamment :

- `localStorage`
- événements de visibilité de page
- cycle de vie navigateur
- reconnexion implicite du navigateur
- comportements WebRTC spécifiques au web si présents

## 4.3 Contraintes Android

L'application Android doit gérer explicitement :

- passage en arrière-plan
- suspension
- reprise
- perte réseau
- changement Wi-Fi / 4G / 5G
- fermeture système
- session locale incomplète ou obsolète

---

## 5. Phases de migration

# Phase 0 — Audit et cadrage

## Objectif
Établir une vue claire des fonctionnalités à migrer, du protocole réel utilisé et des dépendances web à remplacer.

## Travaux à réaliser

### Inventaire des parcours utilisateur
Identifier précisément :

- écran de démarrage
- authentification ou saisie d'identité
- création de lobby
- jointure de lobby
- démarrage de partie
- jeu en cours
- rejoin après coupure
- resync après reconnexion
- cas host / non-host
- gestion erreur / indisponibilité serveur

### Inventaire réseau
Lister :

- endpoints HTTP existants
- événements WebSocket émis par le client
- événements WebSocket reçus depuis le serveur
- payloads attendus
- réponses ACK éventuelles
- mécanismes de récupération de session

### Inventaire stockage local
Lister les données persistées actuellement :

- token
- pseudo ou identité utilisateur
- playerId
- lobbyCode
- gameCode
- rôle courant
- état minimal pour rejoin

### Inventaire dépendances navigateur
Identifier tous les usages de :

- visibilité de page
- stockage navigateur
- API WebRTC web
- navigation navigateur
- comportement lié aux onglets

## Livrables
- cartographie des parcours
- cartographie du protocole
- cartographie du stockage local
- liste des dépendances web à remplacer
- définition du périmètre Android v1

---

# Phase 1 — Stabilisation du contrat backend

## Objectif
Geler un contrat de communication stable afin d'éviter qu'un backend mouvant ralentisse la migration Flutter.

## Travaux à réaliser

### Formaliser les endpoints HTTP
Documenter :

- URL
- méthode
- payload entrant
- payload sortant
- codes d'erreur
- authentification requise
- règles de fallback

### Formaliser les événements WebSocket
Documenter pour chaque événement :

- nom de l'événement
- direction
- structure du payload
- préconditions
- effets attendus
- règles de validation
- gestion d'erreur
- comportement en cas de reconnexion

### Formaliser le cycle de session
Définir :

- création session
- restauration session
- rejoin lobby
- rejoin game
- session expirée
- session invalide
- demande de resync
- reprise après host reconnecté

## Recommandations
Les messages WebSocket doivent être normalisés autour d'une structure stable :

```json
{
  "type": "game:join",
  "version": 1,
  "payload": {},
  "timestamp": "2026-04-02T00:00:00Z"
}
```

## Livrables
- contrat HTTP
- contrat WebSocket
- schéma de session
- table des transitions d'état

---

# Phase 2 — Conception de l'architecture Flutter

## Objectif
Définir une architecture Flutter maintenable, adaptée au temps réel et au cycle de vie Android.

## Choix recommandés

### State management
- Riverpod

### Navigation
- go_router

### HTTP
- dio

### Stockage local
- flutter_secure_storage pour données sensibles
- shared_preferences pour persistance simple
- éventuellement Isar si un cache local plus structuré devient nécessaire

### Journalisation
- logger structuré

## Architecture recommandée des services

### ApiClient
Responsable des appels HTTP.

### WebSocketClient
Responsable de :

- connexion
- reconnexion
- écoute événements
- émission
- gestion ACK
- heartbeat éventuel
- état de connexion

### SessionService
Responsable de :

- restauration de session
- conservation des identifiants utiles
- rejoin
- resync
- gestion du statut actif / away

### LobbyService
Responsable de :

- create/join lobby
- mise à jour joueurs
- synchronisation état lobby

### GameService
Responsable de :

- join game
- actions de jeu
- réception d'événements
- cohérence de l'état local

## Livrables
- architecture Flutter validée
- structure de projet
- liste des dépendances
- conventions de code

---

# Phase 3 — Mise en place du socle Flutter Android

## Objectif
Créer un projet Flutter Android exécutable avec toutes les briques techniques minimales.

## Travaux à réaliser

### Initialisation du projet
- création projet Flutter
- configuration Android
- configuration flavors/environnements si nécessaire
- configuration du build debug/release

### Mise en place des briques de base
- routing
- thème
- injection de dépendances légère
- gestion d'erreurs globale
- écran de chargement initial
- configuration HTTP
- configuration WebSocket
- configuration stockage local
- journalisation

### Intégration du cycle de vie Android
Mettre en place une couche lifecycle pour traduire :

- resumed
- inactive
- paused
- detached

en événements applicatifs exploitables par la couche session.

## Livrables
- application Flutter Android bootable
- socle réseau
- socle persistance
- socle lifecycle
- socle navigation

---

# Phase 4 — Priorisation du canal WebSocket

## Objectif
Faire du WebSocket le cœur du comportement temps réel avant toute migration d'écran complexe.

## Travaux à réaliser

### Concevoir un client WebSocket robuste
Le client WebSocket doit prendre en charge :

- connexion initiale
- reconnexion exponentielle
- reprise automatique
- rejet de doublons
- timeout d'émission
- suivi de l'état de connexion
- resubscription logique après reconnexion
- déclenchement de resync si nécessaire

### Formaliser l'état de connexion
Définir des états explicites :

- disconnected
- connecting
- connected
- reconnecting
- degraded
- resyncRequired

### Encadrer les messages critiques
Les événements WebSocket critiques doivent couvrir :

- bootstrap session temps réel
- rejoin lobby
- rejoin game
- player presence update
- state patch
- full resync request
- host handoff ou indisponibilité host si applicable

### Politique de fallback
Si le WebSocket ne suffit plus à garantir la cohérence :

- l'état de secours doit être récupéré via HTTP
- le WebSocket reprend ensuite son rôle principal

## Livrables
- client WebSocket industrialisé
- machine d'état de connexion
- politique reconnexion/resync
- politique fallback HTTP

---

# Phase 5 — Migration de la session et de la persistance locale

## Objectif
Reproduire d'abord la logique la plus critique : la session, la reprise et la continuité utilisateur.

## Travaux à réaliser

### Session locale
Persister proprement :

- identifiant utilisateur
- token si nécessaire
- playerId
- lobbyCode
- gameCode
- rôle
- dernier état minimal nécessaire à une reprise

### Restauration au démarrage
Au lancement de l'application :

1. lecture de la session locale
2. validation minimale
3. décision de routage
4. tentative de reconnexion WebSocket
5. tentative de rejoin
6. resync si nécessaire

### Gestion du passage arrière-plan / reprise
À la reprise Android :

- vérifier la validité de la session
- vérifier l'état du WebSocket
- déclencher reconnexion si nécessaire
- renvoyer la présence active
- demander une resynchronisation si un doute existe

## Livrables
- SessionRepository
- SessionService
- politique de restauration
- gestion lifecycle -> session

---

# Phase 6 — Migration du bootstrap et du parcours d'entrée

## Objectif
Permettre à l'utilisateur d'ouvrir l'application Android, reprendre ou créer une session, puis rejoindre le flux principal.

## Travaux à réaliser

### Écran de bootstrap
Doit gérer :

- chargement initial
- lecture session locale
- décision de navigation
- état serveur indisponible
- état session invalide

### Parcours d'entrée
Migrer :

- saisie de pseudo ou identité
- création session
- validation
- écrans d'erreur utilisateur

### Gestion des erreurs
Prévoir des cas clairs :

- serveur indisponible
- session expirée
- lobby introuvable
- partie indisponible
- connexion perdue
- reprise impossible

## Livrables
- bootstrap Flutter
- entrée utilisateur
- parcours d'échec

---

# Phase 7 — Migration du lobby

## Objectif
Migrer le premier domaine fonctionnel temps réel complet.

## Travaux à réaliser

### Fonctionnalités à couvrir
- créer un lobby
- rejoindre un lobby
- afficher les joueurs présents
- mettre à jour l'état des joueurs
- recevoir les événements live du lobby
- gérer départ / reconnexion / reprise

### Dépendance WebSocket
Le lobby doit reposer en priorité sur WebSocket pour :

- diffusion des entrées/sorties
- mise à jour des statuts
- transition vers la phase de jeu
- reprise post-coupure

### Cohérence locale
L'état local Flutter doit être immutable et piloté par :

- charge initiale éventuelle
- événements WebSocket entrants
- validation des transitions

## Livrables
- écrans lobby
- providers lobby
- intégration WebSocket lobby
- gestion rejoin lobby

---

# Phase 8 — Migration de la partie en cours

## Objectif
Migrer le cœur du comportement temps réel applicatif.

## Travaux à réaliser

### Fonctionnalités à couvrir
- rejoindre une partie
- reprendre une partie
- afficher état de partie
- traiter actions utilisateur
- recevoir événements du serveur
- effectuer un resync intégral si nécessaire

### Politique WebSocket
Le WebSocket doit devenir le canal principal pour :

- les actions de jeu à faible latence
- les notifications d'avancement
- les changements de statut joueurs
- les mises à jour incrémentales d'état

### Politique de cohérence
Le front Flutter doit toujours pouvoir :

- appliquer un patch incrémental
- demander un état complet
- invalider un état local douteux
- restaurer un état cohérent après reprise

## Livrables
- écrans de jeu Flutter
- GameService
- providers de game state
- stratégie patch + full resync

---

# Phase 9 — Intégration des comportements Android spécifiques

## Objectif
Garantir que l'application reste fiable sur un téléphone Android réel.

## Travaux à réaliser

### Tests lifecycle
Tester :

- app en arrière-plan quelques secondes
- app en arrière-plan plusieurs minutes
- reprise après verrouillage écran
- fermeture système puis relance
- kill process puis redémarrage

### Tests réseau
Tester :

- perte Wi-Fi
- retour Wi-Fi
- passage Wi-Fi -> 4G/5G
- mode avion
- réseau lent
- forte latence
- déconnexions fréquentes

### Tests mémoire et stabilité
Tester :

- faible mémoire disponible
- reprise d'app après éviction système
- charges longues
- usage prolongé

## Livrables
- matrice de tests Android
- liste des défauts critiques
- correctifs de stabilité

---

# Phase 10 — Beta Android

## Objectif
Distribuer une version Android à un cercle réduit pour validation réelle.

## Travaux à réaliser

### Préparation build
- build release
- signature
- icônes
- permissions Android
- configuration réseau production

### Instrumentation
Ajouter :

- crash reporting
- logs de session
- événements de reconnexion
- durée de resync
- erreurs WebSocket
- erreurs HTTP de secours

### Distribution
- APK interne si nécessaire
- puis AAB sur Google Play Internal Testing
- puis closed testing

## Livrables
- build beta Android
- telemetry minimale
- retour utilisateur structuré

---

# Phase 11 — Stabilisation avant production

## Objectif
Corriger les comportements qui apparaissent uniquement dans des conditions réelles.

## Travaux à réaliser

### Stabilisation fonctionnelle
- corriger les régressions de navigation
- corriger les pertes de session
- corriger les incohérences d'état
- corriger les échecs de rejoin / resync

### Stabilisation temps réel
- analyser les reconnections
- réduire les duplications d'événements
- améliorer la résilience WebSocket
- optimiser les reprises d'état

### Stabilisation UX
- améliorer les messages d'erreur
- clarifier les états de chargement
- clarifier les états de reconnexion
- exposer les états d'attente et reprise

## Livrables
- release candidate Android
- liste d'anomalies résolues
- check-list de mise en production

---

# Phase 12 — Mise en production Android

## Objectif
Publier une première version Android exploitable.

## Travaux à réaliser

### Validation finale
- vérification du parcours complet
- validation réseau mobile
- validation reprise session
- validation comportement WebSocket
- validation fallback HTTP

### Mise en production
- publication Play Store
- surveillance des crashs
- surveillance des reconnexions
- surveillance des échecs de resync
- surveillance de la qualité de reprise de session

## Livrables
- version Android publiée
- dashboard de suivi
- backlog post-release

---

## 6. Priorités techniques absolues

## 6.1 Priorité 1 — Fiabilité WebSocket
Le WebSocket doit être traité comme un domaine métier critique et non comme un simple détail d'infrastructure.

À garantir :
- reconnect automatique
- resubscription logique
- gestion des doublons
- machine d'état de connexion
- reprise après pause Android
- instrumentation des erreurs

## 6.2 Priorité 2 — Restauration de session
L'utilisateur doit pouvoir :
- quitter l'écran
- perdre temporairement le réseau
- verrouiller le téléphone
- revenir dans l'application

tout en retrouvant un état cohérent.

## 6.3 Priorité 3 — Resynchronisation explicite
Le front ne doit jamais supposer que l'état local est toujours vrai.

Il doit être capable :
- de détecter le doute
- de demander un resync
- de remplacer son état local proprement

## 6.4 Priorité 4 — Adaptation au lifecycle Android
Le comportement doit être pensé pour le mobile, pas pour un onglet navigateur.

---

## 7. Ordonnancement recommandé par sprint

## Sprint 0
- audit complet
- périmètre Android v1
- cartographie du protocole
- définition du contrat WebSocket

## Sprint 1
- projet Flutter
- architecture de base
- configuration Android
- routing
- stockage local
- HTTP client
- WebSocket client

## Sprint 2
- SessionRepository
- SessionService
- bootstrap app
- lifecycle Android
- reconnexion et resync

## Sprint 3
- parcours d'entrée
- création / reprise session
- gestion d'erreurs
- routage initial

## Sprint 4
- lobby
- événements WebSocket de lobby
- rejoin lobby
- affichage présence

## Sprint 5
- game state
- actions temps réel
- rejoin game
- resync complet

## Sprint 6
- tests Android réseau + lifecycle
- corrections stabilité
- instrumentation

## Sprint 7
- beta Android
- corrections issues terrain
- préparation release

---

## 8. Recommandations de mise en œuvre

## 8.1 Ne pas migrer l'apparence avant le comportement
La logique de session, la connexion WebSocket et la reprise doivent être migrées avant la reproduction fidèle de l'interface.

## 8.2 Isoler le temps réel dans un service dédié
Les widgets Flutter ne doivent jamais porter directement la logique de reconnexion ou de protocole WebSocket.

## 8.3 Utiliser un modèle d'événements versionné
Chaque message important devrait pouvoir évoluer sans casser les clients.

## 8.4 Prévoir des tests de résilience dès le début
La qualité finale dépendra plus des cas dégradés que des cas nominaux.

---

## 9. Résultat attendu

À la fin de ce plan, l'application Flutter Android doit fournir :

- une application Android installable
- une connexion temps réel fiable basée sur WebSocket
- une reprise de session robuste
- un rejoin lobby/game fonctionnel
- une stratégie de resync explicite
- une base propre pour une extension future vers iOS ou d'autres cibles

---

## 10. Décision stratégique recommandée

La migration doit être menée avec la règle suivante :

**prioriser la continuité temps réel par WebSocket, puis la résilience mobile Android, puis la couverture fonctionnelle, et enfin l'alignement visuel complet avec le front historique.**
