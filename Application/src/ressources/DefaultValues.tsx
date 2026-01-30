/**
 * Valeurs par défaut pour les paramètres de jeu
 * Centralise toutes les constantes utilisées dans l'application
 */

// ===== PARAMÈTRES DE SESSION =====
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 heures

// ===== PARAMÈTRES DE JEU =====

// Durées (en millisecondes)
export const DEFAULT_HACK_DURATION_MS = 5000; // 5 secondes pour capturer un objectif
export const DEFAULT_ROUTINE_INTERVAL_MS = 2000; // 2 secondes entre chaque routine périodique

// Distances et rayons (en mètres)
export const DEFAULT_DETECTION_RADIUS = 30; // Rayon de détection par défaut pour les objectifs
export const START_ZONE_RADIUS = 50; // Rayon des zones de départ (Agent et Rogue)
export const DEFAULT_MAP_ZOOM = 15; // Niveau de zoom par défaut de la carte
export const DEFAULT_MAP_ZOOM_CREATE_LOBBY = 13; // Niveau de zoom pour la création de lobby

// Fog de guerre (nombre d'anneaux de brouillard)
export const FOG_RINGS_ROGUE = 20; // Nombre d'anneaux de brouillard pour les Rogues
export const FOG_RINGS_AGENT = 20; // Nombre d'anneaux de brouillard pour les Agents

// ===== PARAMÈTRES DE GÉOLOCALISATION =====
export const GEOLOCATION_TIMEOUT = 15000; // 15 secondes
export const GEOLOCATION_MAX_AGE = 10000; // 10 secondes (position en cache)
export const GEOLOCATION_WATCH_MAX_AGE = 1000; // 1 seconde pour le suivi continu
export const ROUTE_UPDATE_MIN_INTERVAL_MS = 4000; // 4 secondes entre deux recalculs
export const ROUTE_UPDATE_MIN_DISTANCE_METERS = 5; // 5m de déplacement minimum

// ===== PARAMÈTRES DE CRÉATION DE PARTIE =====

// Paramètres de jeu par défaut
export const DEFAULT_OBJECTIVE_NUMBER = 3; // Nombre d'objectifs par défaut
export const DEFAULT_GAME_DURATION = 900; // Durée de partie par défaut (15 minutes en secondes)
export const DEFAULT_VICTORY_CONDITION_OBJECTIVES = 2; // Nombre d'objectifs nécessaires pour gagner
export const DEFAULT_HACK_DURATION_CREATE_MS = 10000; // Durée de hack par défaut à la création (10 secondes)
export const DEFAULT_OBJECTIVE_ZONE_RADIUS = 150; // Rayon de la zone d'objectif (en mètres)
export const DEFAULT_ROGUE_RANGE = 10; // Portée des Rogues (en mètres)
export const DEFAULT_AGENT_RANGE = 10; // Portée des Agents (en mètres)
export const DEFAULT_MAP_RADIUS = 500; // Rayon de la zone de jeu (en mètres)
export const DEFAULT_MAX_AGENTS = 3; // Nombre maximum d'Agents
export const DEFAULT_MAX_ROGUE = 2; // Nombre maximum de Rogues

// Paramètres de géolocalisation pour la création de lobby
export const CREATE_LOBBY_GEOLOCATION_TIMEOUT = 10000; // 10 secondes
export const CREATE_LOBBY_GEOLOCATION_MAX_AGE = 60000; // 1 minute
export const CREATE_LOBBY_GEOLOCATION_RETRY_TIMEOUT = 5000; // 5 secondes
export const CREATE_LOBBY_GEOLOCATION_RETRY_MAX_AGE = 300000; // 5 minutes
export const CREATE_LOBBY_GEOLOCATION_FALLBACK_TIMEOUT = 3000; // 3 secondes avant fallback

// Limites de champs
export const MAX_PLAYER_NAME_LENGTH = 20; // Longueur maximale du nom de joueur

// ===== PARAMÈTRES D'INTERFACE =====

// Modal de démarrage de partie
export const GAME_START_MODAL_AUTO_CLOSE_MS = 3000; // 3 secondes

// Boussole
export const COMPASS_SIZE_SMALL = 75; // Taille de la boussole en pixels
export const COMPASS_DEFAULT_LATITUDE = 48.8566; // Paris par défaut
export const COMPASS_DEFAULT_LONGITUDE = 2.3522;

// QR Code
export const QR_CODE_SIZE = 300; // Taille du QR code en pixels

// ===== PARAMÈTRES DE RECONNEXION =====
export const SOCKET_RECONNECTION_ATTEMPTS = 10;
export const SOCKET_RECONNECTION_DELAY = 1000;
export const SOCKET_RECONNECTION_DELAY_MAX = 5000;
export const SOCKET_TIMEOUT = 20000;

// ===== PARAMÈTRES DE SYNCHRONISATION =====
export const OBJECTIVE_CIRCLES_SYNC_COOLDOWN_MS = 5000; // 5 secondes entre chaque demande de resync
export const STATUS_UPDATE_THROTTLE_MS = 1000; // 1 seconde entre chaque mise à jour de statut

// ===== SERVEURS ICE (WebRTC) =====
export const DEFAULT_STUN_SERVER = 'stun:stun.l.google.com:19302';

// ===== URLS PAR DÉFAUT =====
export const getDefaultWebSocketUrl = () => {
  return window.location.hostname === 'localhost'
    ? 'http://localhost:5174'
    : 'https://ws.abstergochase.fr';
};

export const SOCKET_PATH = '/socket.io';

// ===== FONCTIONS UTILITAIRES =====

/**
 * Génère un nom de joueur par défaut
 */
export const generateDefaultPlayerName = () => {
  return `Joueur-${Math.floor(Math.random() * 9999)}`;
};

