import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonButtons, IonLabel, IonModal } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Polyline, Polygon, Pane } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import { toast } from 'react-toastify';
import { 
  generateRandomPointInAnnulus, 
  fetchRoute, 
  calculateDistanceToStartZone, 
  isPlayerInStartZone 
} from '../utils/utils';
import { updatePlayerPosition, updatePlayerInStartZone } from '../utils/PlayerUtils';
import { updateGameWinnerType } from '../utils/AdminUtils';
import { add, apertureOutline, camera, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, settings, skullOutline } from 'ionicons/icons';
import './Agent.css';
import { GameProp, GameDetails, ObjectiveCircle, Player } from '../components/Interfaces';
import PopUpMarker from '../components/PopUpMarker';
import Compass from '../components/Compass';
import Camera from '../components/Camera';
import QRCode from '../components/QRCode';
import { useGameSession } from '../contexts/GameSessionContext';
import { useWakeLock } from '../utils/useWakeLock';
import { useVibration } from '../hooks/useVibration';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
import { MapController, ResizeMap, useFogRings } from '../utils/GameMapUtils';
import {
  START_ZONE_RADIUS,
  DEFAULT_MAP_ZOOM,
  FOG_RINGS_AGENT,
  GEOLOCATION_TIMEOUT,
  GEOLOCATION_MAX_AGE,
  GEOLOCATION_WATCH_MAX_AGE,
  ROUTE_UPDATE_MIN_INTERVAL_MS,
  ROUTE_UPDATE_MIN_DISTANCE_METERS,
  COMPASS_SIZE_SMALL,
  COMPASS_DEFAULT_LATITUDE,
  COMPASS_DEFAULT_LONGITUDE,
  QR_CODE_SIZE,
  OBJECTIVE_CIRCLES_SYNC_COOLDOWN_MS,
  DEFAULT_AGENT_RANGE,
} from '../ressources/DefaultValues';

import SplashScreenAgentImg from '../ressources/splashScreen/SplashScreenAgent.png';

const AGENT_MARKER = 'AgentMarker.png';

const SPLASH_MIN_DISPLAY_MS = 3000;

const Agent: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const {
    playerId,
    playerName,
    gameDetails: sessionGameDetails,
    joinGame,
    updateGameDetails,
    updatePlayer,
    isHost,
    connectionStatus,
    sessionScope,
    requestLatestState,
    players: sessionPlayers
  } = useGameSession();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveCircles, setObjectiveCircles] = useState<ObjectiveCircle[]>([]);
  const [isFabOpen, setIsFabOpen] = useState(false);

  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);
  const lastRouteUpdateRef = useRef(0);
  const lastRoutePositionRef = useRef<[number, number] | null>(null);
  const lastRouteStartZoneRef = useRef<string | null>(null);
  const routeRequestIdRef = useRef(0);
  
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [objectiveCirclesInitialized, setObjectiveCirclesInitialized] = useState<boolean>(false);
  const objectiveCirclesSyncRef = useRef<number | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get('code');
    } catch {
      return null;
    }
  });
  
  // États pour le compte à rebours
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // État pour la modal de la caméra
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  
  // Référence pour la carte
  const mapRef = useRef<L.Map | null>(null);
  
  // Logo du joueur (marker Agent)
  const playerLogo = AGENT_MARKER;

  // Wake Lock pour empêcher l'écran de se mettre en veille
  useWakeLock(true);

  // Hook pour la vibration
  const { vibrate, patterns } = useVibration();
  
  // État pour la modal du QR code
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  
  // Texte pour le QR code (email + code de partie)
  const [qrCodeText, setQrCodeText] = useState<string>('');
  
  // État pour la modal de démarrage de partie
  const [isGameStartModalOpen, setIsGameStartModalOpen] = useState(false);
  const gameStartModalShownRef = useRef(false);

  // Splash screen pendant le chargement (Lobby → Agent)
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const splashMountedAtRef = useRef(Date.now());

  const isPlayerVisible = useCallback((player: Player) => {
    if (player.status === 'disconnected') return false;
    if (player.status === 'CAPTURED') return false;
    const role = (player.role || '').trim().toUpperCase();
    if (role !== 'AGENT') return false;
    return true;
  }, []);

  const getPlayerMarkerPosition = useCallback((player: Player): [number, number] | null => {
    if (player.latitude && player.longitude) {
      return [parseFloat(player.latitude), parseFloat(player.longitude)];
    }
    return null;
  }, []);

  const isObjectiveCircleVisible = useCallback((circle: ObjectiveCircle) => {
    const props = gameDetails?.props;
    if (!props || props.length === 0) return true;
    const prop = props.find(item => item.id_prop === circle.id_prop);
    if (!prop) return true;
    if (prop.visible === false) return false;
    const state = (prop.state || '').toString().trim().toUpperCase();
    if (state === 'CAPTURED') return false;
    return true;
  }, [gameDetails?.props]);

  const getObjectiveCirclePathOptions = useCallback((circle: ObjectiveCircle) => {
    const defaultOptions = {
      color: 'purple',
      fillColor: 'purple',
      fillOpacity: 0.2
    };
    const props = gameDetails?.props;
    if (!props || props.length === 0) return defaultOptions;
    const prop = props.find(item => item.id_prop === circle.id_prop);
    if (!prop) return defaultOptions;
    const state = (prop.state || '').toString().trim().toUpperCase();
    if (state === 'CAPTURING') {
      return {
        color: '#ff8c00',
        fillColor: '#ff8c00',
        fillOpacity: 0.35,
        className: 'objective-capturing'
      };
    }
    return defaultOptions;
  }, [gameDetails?.props]);

  const buildObjectiveCirclesKey = (code: string) => `objectiveCircles:${code}`;
  const objectiveCirclesBootstrapRef = useRef(false);
  const getStoredObjectiveCircles = (code: string): ObjectiveCircle[] | null => {
    try {
      const stored = localStorage.getItem(buildObjectiveCirclesKey(code));
      if (!stored) return null;
      const parsed = JSON.parse(stored) as ObjectiveCircle[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const applyObjectiveCircles = useCallback((circles: ObjectiveCircle[], code?: string | null) => {
    setObjectiveCircles(circles);
    setObjectiveCirclesInitialized(true);
    if (code) {
      localStorage.setItem(buildObjectiveCirclesKey(code), JSON.stringify(circles));
    }
  }, []);

  const buildFallbackObjectiveCircles = useCallback((props: GameProp[]): ObjectiveCircle[] => {
    return props
      .map((prop) => {
        const latitude = parseFloat(prop.latitude || '');
        const longitude = parseFloat(prop.longitude || '');
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
          return null;
        }
        return {
          id_prop: prop.id_prop,
          center: [latitude, longitude] as [number, number],
          radius: prop.detection_radius || 0
        };
      })
      .filter((circle): circle is ObjectiveCircle => Boolean(circle));
  }, []);

  // Fonction helper pour gérer les erreurs avec l'email de l'utilisateur
  const handleErrorWithUser = async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      userEmail: playerName || undefined
    });
    setError(errorResult.message);
    return errorResult;
  };

  // Fonctions pour les boutons FAB

  const handleVisionMode = () => {
    toast.success('👁️ Mode vision activé');
    vibrate(patterns.short);
  };

  const handleHealthCheck = () => {
    setIsQRModalOpen(true);
    vibrate(patterns.short);
  };

  const handleLocationTracker = () => {
    if (currentPosition && mapRef.current) {
      mapRef.current.setView(currentPosition, DEFAULT_MAP_ZOOM);
      toast.success('📍 Carte recentrée sur votre position');
    } else if (currentPosition) {
      toast.info(`📍 Position actuelle: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
    } else {
      toast.error('❌ Position non disponible');
    }
    vibrate(patterns.short);
  };

  const handleThreatDetection = async () => {
    if (!gameDetails?.started || !gameDetails?.countdown_started) {
      toast.error('⏳ La partie n\'a pas encore commencé');
      return;
    }
    setIsCameraModalOpen(true);
    vibrate(patterns.short);
  };





  // Handler pour la fin de partie
  const handleGameEnd = async () => {
    // Arrêter le compte à rebours
    setIsCountdownActive(false);
    setCountdown(0);
        
    if (isHost) {
      // Mettre à jour remaining_time=0 et winner_type à "AGENT" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
        try {
          await updateGameDetails({ remaining_time: 0 });
        } catch (_) {}
        await updateGameWinnerType(code, 'AGENT');
      }
    }
    
    // Rediriger vers la page de fin de partie (pour tous les joueurs)
    history.push('/end-game');
  };


  // Démarrer la partie quand tous les joueurs sont en zone de départ (admin uniquement)
  const handleAdminStartFromStartZone = async () => {
    try {
      const code = gameCode || gameDetails?.code;
      if (!code) {
        await handleErrorWithUser('Code de partie introuvable pour démarrer', null, ERROR_CONTEXTS.GAME_START);
        return;
      }

      // Vérification de sécurité : tous les joueurs doivent être dans leur zone de départ
      const allPlayersInStartZone = gameDetails?.players?.every(p => p.isInStartZone === true) ?? false;
      if (!allPlayersInStartZone) {
        toast.error('⚠️ Tous les joueurs doivent être dans leur zone de départ');
        return;
      }

      const playerCount = gameDetails?.players?.length ?? 0;
      if (playerCount === 0) {
        toast.error('⚠️ Aucun joueur dans la partie');
        return;
      }

      vibrate(patterns.long);
      
      // Phase 1: Signaler que la partie va commencer et attendre les ACK de tous les joueurs
      // Réinitialiser hasAcknowledgedStart pour tous les joueurs
      for (const player of gameDetails?.players || []) {
        await updatePlayer(player.id_player, { hasAcknowledgedStart: false });
      }
      
      await updateGameDetails({
        game_starting: true,
        is_converging_phase: false
      });
      setGameDetails(prev => prev ? { ...prev, game_starting: true, is_converging_phase: false } as any : prev);
      
      toast.info(`⏳ En attente de ${playerCount} joueur(s)...`);
    } catch (error) {
      await handleErrorWithUser('Erreur lors du démarrage de la partie', error, ERROR_CONTEXTS.GAME_START);
    }
  };



  useEffect(() => {
    const fetchGameDetails = async () => {
      try {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        setGameCode(code);

        if (!code) {
          await handleErrorWithUser('Code de partie non trouvé', null, ERROR_CONTEXTS.VALIDATION);
          return;
        }

        const needsReconnect =
          sessionScope !== 'game' ||
          (connectionStatus !== 'connected' && connectionStatus !== 'connecting') ||
          !sessionGameDetails ||
          sessionGameDetails.code !== code;

        if (needsReconnect) {
          await joinGame(code);
        }

        setQrCodeText(`${playerId};${code}`);

        if (sessionGameDetails) {
          setCurrentPlayerId(playerId);
        }
      } catch (err) {
        await handleErrorWithUser('Erreur lors du chargement de la partie', err, ERROR_CONTEXTS.DATABASE);
      }
    };

    if (playerId) {
      fetchGameDetails();
    }
  }, [location.search, playerId, playerName, sessionGameDetails, connectionStatus, sessionScope]);

  useEffect(() => {
    if (sessionGameDetails) {
      setGameDetails(sessionGameDetails);
    }
  }, [sessionGameDetails, isHost]);

  // Masquer le splash quand la partie est prête (gameDetails chargé ou erreur) après un délai minimum
  useEffect(() => {
    const readyToHide = gameDetails !== null || error !== null;
    if (!readyToHide) return;

    const elapsed = Date.now() - splashMountedAtRef.current;
    const remaining = Math.max(0, SPLASH_MIN_DISPLAY_MS - elapsed);

    const t = setTimeout(() => setIsSplashVisible(false), remaining);
    return () => clearTimeout(t);
  }, [gameDetails, error]);


  // Récupérer les cercles stockés pour un rafraîchissement de page (host uniquement)
  useEffect(() => {
    if (!isHost || !gameCode || objectiveCirclesInitialized) return;

    const storedCircles = getStoredObjectiveCircles(gameCode);
    if (!storedCircles) return;
    applyObjectiveCircles(storedCircles, gameCode);
    updateGameDetails({ objective_circles: storedCircles });
  }, [isHost, gameCode, objectiveCirclesInitialized, applyObjectiveCircles, updateGameDetails]);

  // Synchroniser les cercles depuis l'host si disponibles
  useEffect(() => {
    if (objectiveCirclesInitialized) return;
    if (gameDetails?.objective_circles && gameDetails.objective_circles.length > 0) {
      applyObjectiveCircles(gameDetails.objective_circles, gameCode);
    }
  }, [gameDetails?.objective_circles, objectiveCirclesInitialized, applyObjectiveCircles, gameCode]);

  // Si on est un joueur non-host, demander un resync si les cercles manquent (phase de convergence ou partie démarrée)
  useEffect(() => {
    if (isHost) return;
    if (objectiveCirclesInitialized) return;
    const shouldSync = gameDetails?.is_converging_phase || (gameDetails?.started && gameDetails?.countdown_started);
    if (!shouldSync) return;
    if (gameDetails?.objective_circles && gameDetails.objective_circles.length > 0) return;

    const now = Date.now();
    const lastRequest = objectiveCirclesSyncRef.current;
    if (lastRequest && now - lastRequest < 5000) return;
    objectiveCirclesSyncRef.current = now;
    requestLatestState();
  }, [
    isHost,
    objectiveCirclesInitialized,
    gameDetails?.is_converging_phase,
    gameDetails?.started,
    gameDetails?.countdown_started,
    gameDetails?.objective_circles,
    requestLatestState
  ]);

  // Créer les cercles d'objectifs une seule fois (host) : dès la phase de convergence, partagés dans les données de jeu
  useEffect(() => {
    const shouldInitialize = gameDetails?.is_converging_phase || (gameDetails?.started && gameDetails?.countdown_started);
    
    if (!isHost || !shouldInitialize || !gameDetails?.props || !gameCode || objectiveCirclesInitialized) {
      return;
    }
    if (objectiveCirclesBootstrapRef.current) {
      return;
    }
    objectiveCirclesBootstrapRef.current = true;

    const storedCircles = getStoredObjectiveCircles(gameCode);
    if (storedCircles) {
      applyObjectiveCircles(storedCircles, gameCode);
      updateGameDetails({ objective_circles: storedCircles });
      return;
    }

    const circles = gameDetails.props.map((prop: GameProp) => {
      const objectiveCenter: [number, number] = [
        parseFloat(prop.latitude || '0'),
        parseFloat(prop.longitude || '0')
      ];
      const radius = prop.detection_radius || 0;
      // Centre du cercle affiché dans un anneau autour de l'objectif : objectif à l'intérieur mais jamais au centre
      const minOffset = Math.max(5, radius * 0.1);
      const displayCenter = radius > minOffset
        ? generateRandomPointInAnnulus(objectiveCenter, minOffset, radius)
        : objectiveCenter;
      return {
        id_prop: prop.id_prop,
        center: displayCenter,
        radius
      };
    });
    applyObjectiveCircles(circles, gameCode);
    updateGameDetails({ objective_circles: circles });
  }, [isHost, gameDetails?.is_converging_phase, gameDetails?.started, gameDetails?.countdown_started, gameDetails?.props, objectiveCirclesInitialized, gameCode, applyObjectiveCircles, updateGameDetails]);

  // Fallback: afficher des cercles basés sur les props si l'état n'est pas encore synchronisé (phase de convergence ou partie démarrée)
  useEffect(() => {
    if (objectiveCirclesInitialized) return;
    const shouldShow = gameDetails?.is_converging_phase || (gameDetails?.started && gameDetails?.countdown_started);
    if (!shouldShow) return;
    if (objectiveCircles.length > 0) return;
    if (!gameDetails?.props || gameDetails.props.length === 0) return;

    const fallbackCircles = buildFallbackObjectiveCircles(gameDetails.props);
    if (fallbackCircles.length === 0) return;
    setObjectiveCircles(fallbackCircles);
  }, [
    objectiveCirclesInitialized,
    objectiveCircles.length,
    gameDetails?.is_converging_phase,
    gameDetails?.started,
    gameDetails?.countdown_started,
    gameDetails?.props,
    buildFallbackObjectiveCircles
  ]);

  // Lancer le compte à rebours uniquement quand le host a appuyé sur le bouton
  useEffect(() => {
    if (!isHost) {
      return;
    }
    if (gameDetails?.started && !isCountdownActive && gameDetails?.countdown_started) {
      const totalSeconds = (gameDetails.remaining_time ?? gameDetails.duration) || 0;
      if (totalSeconds > 0) {
        setCountdown(totalSeconds);
        setIsCountdownActive(true);
      }
    }
  }, [gameDetails?.started, gameDetails?.countdown_started, gameDetails?.duration, gameDetails?.remaining_time, isCountdownActive, isHost]);

  useEffect(() => {
    // Get initial position
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          // Don't log error - position will be updated by watchPosition
        },
        {
          enableHighAccuracy: true,
          timeout: 15000, // Increased timeout to 15 seconds
          maximumAge: 10000 // Accept cached position up to 10 seconds old
        }
      );

      // Watch position changes
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          // Don't log to error handler - watchPosition will keep trying
        },
        {
          enableHighAccuracy: true,
          maximumAge: GEOLOCATION_WATCH_MAX_AGE,
          timeout: GEOLOCATION_TIMEOUT
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  // Mise à jour de la position (géolocalisation locale uniquement)
  // La synchronisation se fait via WebRTC pour tous les joueurs
  useEffect(() => {
    if (currentPosition && currentPlayerId) {
      updatePlayerPosition(currentPlayerId, currentPosition[0], currentPosition[1]);
    }
  }, [currentPosition, currentPlayerId, isHost]);

  // Effet pour récupérer le trajet routier en phase de convergence (calcul local pour tous)
  useEffect(() => {
    const updateRoute = async () => {
      if (!gameDetails?.is_converging_phase) {
        setRoutePath([]);
        lastRouteUpdateRef.current = 0;
        lastRoutePositionRef.current = null;
        lastRouteStartZoneRef.current = null;
        routeRequestIdRef.current += 1;
        return;
      }

      if (!currentPosition || !gameDetails.start_zone_latitude || !gameDetails.start_zone_longitude) {
        return;
      }

      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_latitude),
        parseFloat(gameDetails.start_zone_longitude)
      ];
      const startZoneKey = `${startZone[0]}:${startZone[1]}`;
      if (lastRouteStartZoneRef.current !== startZoneKey) {
        lastRouteStartZoneRef.current = startZoneKey;
        lastRouteUpdateRef.current = 0;
        lastRoutePositionRef.current = null;
      }

      const now = Date.now();
      const lastUpdate = lastRouteUpdateRef.current;
      const timeSince = now - lastUpdate;
      const movedDistance = lastRoutePositionRef.current
        ? L.latLng(currentPosition).distanceTo(L.latLng(lastRoutePositionRef.current))
        : Number.POSITIVE_INFINITY;

      // Mettre à jour si :
      // 1. C'est le premier calcul
      // 2. Le temps minimum est écoulé (pour garantir une mise à jour régulière)
      // 3. OU le joueur a bougé d'une distance significative (pour réagir rapidement aux mouvements)
      const shouldUpdate =
        lastUpdate === 0 ||
        timeSince >= ROUTE_UPDATE_MIN_INTERVAL_MS ||
        movedDistance >= ROUTE_UPDATE_MIN_DISTANCE_METERS;

      if (!shouldUpdate) {
        return;
      }

      const requestId = routeRequestIdRef.current + 1;
      routeRequestIdRef.current = requestId;
      lastRouteUpdateRef.current = now;
      lastRoutePositionRef.current = currentPosition;

      const route = await fetchRoute(currentPosition, startZone);
      if (requestId !== routeRequestIdRef.current) {
        return;
      }
      if (route.length > 1) {
        setRoutePath(route);
      }
    };
    
    updateRoute();
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_latitude, gameDetails?.start_zone_longitude]);

  // Calculer la distance à la zone de départ en temps réel (pour l'affichage local uniquement)
  useEffect(() => {
    if (!gameDetails?.is_converging_phase) {
      setDistanceToStartZone(null);
      return;
    }

    if (currentPosition && gameDetails?.start_zone_latitude && gameDetails?.start_zone_longitude) {
      const distance = calculateDistanceToStartZone(
        currentPosition, 
        gameDetails.start_zone_latitude, 
        gameDetails.start_zone_longitude
      );
      setDistanceToStartZone(distance);
    }
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_latitude, gameDetails?.start_zone_longitude]);

  // Vérifier en temps réel si le joueur est dans la zone de départ (mise à jour locale)
  useEffect(() => {
    if (currentPosition && gameDetails?.start_zone_latitude && gameDetails?.start_zone_longitude && currentPlayerId) {
      const isInStartZone = isPlayerInStartZone(
        currentPosition, 
        gameDetails.start_zone_latitude, 
        gameDetails.start_zone_longitude
      );
      updatePlayerInStartZone(currentPlayerId, isInStartZone);
    }
  }, [currentPosition, gameDetails?.start_zone_latitude, gameDetails?.start_zone_longitude, currentPlayerId, isHost]);

  // Effet pour gérer le compte à rebours
  useEffect(() => {
    if (!isHost) {
      return;
    }
    if (isCountdownActive && countdown !== null && countdown > 0) {
      // Nettoyer l'intervalle précédent s'il existe
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      
      // Créer un nouvel intervalle pour le compte à rebours
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev !== null && prev > 0) {
            const newCountdown = prev - 1;
            if (newCountdown === 0) {
              handleGameEnd();
            }
            
            return newCountdown;
          }
          return prev;
        });
      }, 1000);
    } else if (countdown === 0) {
      // Arrêter le compte à rebours quand il atteint 0
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsCountdownActive(false);
    }
    
    // Cleanup lors du démontage du composant
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isCountdownActive, countdown, isHost]);

  // Synchroniser remaining_time côté serveur pour l'admin à chaque tick
  useEffect(() => {
    const pushRemainingTime = async () => {
      try {
        if (isHost && isCountdownActive && countdown !== null && gameCode) {
          await updateGameDetails({ remaining_time: countdown });
        }
      } catch (_) {}
    };
    pushRemainingTime();
  }, [countdown, isCountdownActive, isHost, gameCode]);

  useEffect(() => {
    if (!isHost && gameDetails?.remaining_time !== undefined && gameDetails?.remaining_time !== null) {
      setCountdown(gameDetails.remaining_time);
    }
  }, [gameDetails?.remaining_time, isHost]);

  useEffect(() => {
    if (!isHost && (gameDetails?.remaining_time === 0 || gameDetails?.winner_type)) {
      history.push('/end-game');
    }
  }, [gameDetails?.remaining_time, gameDetails?.winner_type, isHost, history]);

  // Référence pour éviter les ACK multiples
  const hasAcknowledgedRef = useRef(false);

  // Effet pour détecter game_starting et envoyer l'ACK
  useEffect(() => {
    const sendAcknowledgment = async () => {
      // Quand game_starting passe à true et qu'on n'a pas encore envoyé l'ACK
      if (gameDetails?.game_starting && !hasAcknowledgedRef.current && playerId) {
        hasAcknowledgedRef.current = true;
        setIsGameStartModalOpen(true);
        vibrate(patterns.long);
        
        // Envoyer l'ACK au host
        try {
          await updatePlayer(playerId, { hasAcknowledgedStart: true });
        } catch (error) {
          console.error('Erreur lors de l\'envoi de l\'ACK:', error);
        }
      }
      
      // Réinitialiser le flag quand game_starting repasse à false
      if (!gameDetails?.game_starting) {
        hasAcknowledgedRef.current = false;
      }
    };
    
    sendAcknowledgment();
  }, [gameDetails?.game_starting, playerId, updatePlayer, vibrate, patterns.long]);

  // Fermer la modal quand la partie démarre vraiment (started devient true)
  useEffect(() => {
    if (gameDetails?.started && gameDetails?.countdown_started && isGameStartModalOpen) {
      // La partie a vraiment démarré, fermer la modal
      setIsGameStartModalOpen(false);
    }
  }, [gameDetails?.started, gameDetails?.countdown_started, isGameStartModalOpen]);

  // Host: surveiller les ACKs de tous les joueurs et démarrer la partie quand tout le monde est prêt
  useEffect(() => {
    const checkAllAcknowledged = async () => {
      // Seulement pour le host et quand game_starting est true
      if (!isHost || !gameDetails?.game_starting || gameDetails?.started) {
        return;
      }

      const players = gameDetails?.players || [];
      if (players.length === 0) {
        return;
      }

      // Vérifier si tous les joueurs ont envoyé leur ACK
      const allAcknowledged = players.every(p => p.hasAcknowledgedStart === true);
      
      if (allAcknowledged) {
        // Tous les joueurs ont reçu l'information, démarrer la partie !
        try {
          await updateGameDetails({
            started: true,
            countdown_started: true,
            game_starting: false,
            started_date: new Date().toISOString()
          });
          setGameDetails(prev => prev ? { 
            ...prev, 
            started: true, 
            countdown_started: true, 
            game_starting: false,
            started_date: new Date().toISOString() 
          } as any : prev);
          
          toast.success(`🚀 Partie démarrée avec ${players.length} joueur(s) !`);
        } catch (error) {
          console.error('Erreur lors du démarrage de la partie:', error);
        }
      }
    };

    checkAllAcknowledged();
  }, [isHost, gameDetails?.game_starting, gameDetails?.started, gameDetails?.players, updateGameDetails]);


  // Effet pour vérifier les conditions de victoire (Host uniquement)
  useEffect(() => {
    if (!isHost || !gameDetails?.started || gameDetails?.winner_type) return;

    const allRogues = gameDetails.players?.filter(p => p.role?.toUpperCase() === 'ROGUE') || [];
    const capturedRogues = allRogues.filter(p => p.status === 'CAPTURED');

    // Victoire Agent si tous les Rogues sont capturés
    if (allRogues.length > 0 && capturedRogues.length >= allRogues.length) {
      console.log('🏆 Tous les Rogues capturés - Victoire des Agents !');
      updateGameDetails({ 
        winner_type: 'AGENT',
        remaining_time: 0 
      }).then(() => {
        setTimeout(() => {
          history.push('/end-game');
        }, 1000);
      });
      return;
    }

    // Victoire Rogue si le nombre d'objectifs capturés atteint la condition de victoire
    const allObjectives = gameDetails.props || [];
    const capturedObjectives = allObjectives.filter(p => p.state === 'CAPTURED');
    const victoryCondition = gameDetails.victory_condition_nb_objectivs || allObjectives.length;

    if (allObjectives.length > 0 && capturedObjectives.length >= victoryCondition) {
      console.log(`🏆 ${capturedObjectives.length}/${victoryCondition} objectifs capturés - Victoire des Rogues !`);
      updateGameDetails({ 
        winner_type: 'ROGUE',
        remaining_time: 0 
      }).then(() => {
        setTimeout(() => {
          history.push('/end-game');
        }, 1000);
      });
    }
  }, [isHost, gameDetails?.started, gameDetails?.winner_type, gameDetails?.players, gameDetails?.props, gameDetails?.victory_condition_nb_objectivs, updateGameDetails, history]);

  const fogRings = useFogRings(gameDetails, FOG_RINGS_AGENT);

  return (
    <IonPage>
      {/* Splash en premier : couvre toute la page (header + content), min 5 s avant erreur ou jeu */}
      {isSplashVisible && (
        <div
          className="game-splash-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0a0a0f',
            overflow: 'hidden',
          }}
        >
          <img
            src={SplashScreenAgentImg}
            alt="Agents"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'rgba(56, 128, 255, 0.9)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <span style={{ animation: 'splash-pulse 1.2s ease-in-out infinite' }}>Connexion en cours</span>
          </div>
        </div>
      )}
      <IonHeader>
        <IonToolbar>
          <IonTitle>Agent</IonTitle>
          {((isHost && countdown !== null && isCountdownActive) || (!isHost && gameDetails?.remaining_time !== null && gameDetails?.remaining_time !== undefined)) ? (
            <IonLabel slot="primary" className="duration-display countdown-active">
              ⏰ {Math.floor(((isHost ? countdown : gameDetails?.remaining_time) || 0) / 60)}:{(((isHost ? countdown : gameDetails?.remaining_time) || 0) % 60).toString().padStart(2, '0')}
            </IonLabel>
          ) : gameDetails?.duration ? (
            <IonLabel slot="primary" className="duration-display">
              ⏱️ {Math.floor((gameDetails.duration || 0) / 60)}:{(((gameDetails.duration || 0) % 60)).toString().padStart(2, '0')}
            </IonLabel>
          ) : null}
          {gameDetails?.is_converging_phase && distanceToStartZone !== null && (
            <IonLabel slot="end" className="distance-counter">
              🎯 {distanceToStartZone.toFixed(0)}m
            </IonLabel>
          )}
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {error ? (
          <p>{error}</p>
        ) : gameDetails ? (
          <div className="map-container">
            <MapContainer
              key={`map-${gameDetails.code}`}
              center={[
                parseFloat(gameDetails.map_center_latitude || '0'), 
                parseFloat(gameDetails.map_center_longitude || '0')
              ]}
              zoom={DEFAULT_MAP_ZOOM}
              whenReady={() => {
                // Force a resize after the map is ready
                setTimeout(() => {
                  const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
                  if (mapElement) {
                    mapElement.style.height = '100%';
                  }
                  // Récupérer la référence de la carte via le DOM
                  const mapInstance = (mapElement?.parentElement as any)?._leaflet_map;
                  if (mapInstance) {
                    mapRef.current = mapInstance;
                  }
                }, 100);
              }}
            >
              <ResizeMap />
              <MapController onMapReady={(map) => {
                mapRef.current = map;
              }} />
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <Pane name="fog" style={{ zIndex: 650 }}>
                {fogRings.map((ring, index) => (
                  <Polygon
                    key={`fog-ring-${index}`}
                    positions={[ring.outer, ring.inner]}
                    pathOptions={{
                      stroke: false,
                      fillColor: '#0b0f14',
                      fillOpacity: ring.opacity,
                      fillRule: 'evenodd'
                    }}
                  />
                ))}
              </Pane>
              {gameDetails.start_zone_latitude && gameDetails.start_zone_longitude && (
                <>
                  <PopUpMarker
                    position={[parseFloat(gameDetails.start_zone_latitude), parseFloat(gameDetails.start_zone_longitude)]}
                    type="start-zone"
                    id="start-zone-agent"
                  />
                  <Circle
                    center={[parseFloat(gameDetails.start_zone_latitude), parseFloat(gameDetails.start_zone_longitude)]}
                    radius={START_ZONE_RADIUS}
                    pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                  />
                </>
              )}
              {gameDetails.start_zone_rogue_latitude && gameDetails.start_zone_rogue_longitude && (
                <>
                  <PopUpMarker
                    position={[parseFloat(gameDetails.start_zone_rogue_latitude), parseFloat(gameDetails.start_zone_rogue_longitude)]}
                    type="start-zone-rogue"
                    id="start-zone-rogue"
                  />
                  <Circle
                    center={[parseFloat(gameDetails.start_zone_rogue_latitude), parseFloat(gameDetails.start_zone_rogue_longitude)]}
                    radius={50}
                    pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.1 }}
                  />
                </>
              )}
              {/* Cercles d'objectifs (partagés par le host, affichés dès la phase de convergence) */}
              {objectiveCircles
                .filter(isObjectiveCircleVisible)
                .map((circle) => (
                  <Circle
                    key={circle.id_prop}
                    center={circle.center}
                    radius={circle.radius}
                    pathOptions={getObjectiveCirclePathOptions(circle)}
                  />
                ))}
              {currentPosition && (
                <PopUpMarker
                  position={currentPosition}
                  type="player"
                  playerLogo={playerLogo}
                  id="player-position"
                  label={playerName || 'Vous'}
                  isSelf={true}
                />
              )}
              {(gameDetails?.players || [])
                .filter((player) => player.id_player !== playerId)
                .filter(isPlayerVisible)
                .map((player) => {
                  const position = getPlayerMarkerPosition(player);
                  if (!position) return null;
                  return (
                    <PopUpMarker
                      key={`player-${player.id_player}`}
                      position={position}
                      type="player"
                      playerLogo={AGENT_MARKER}
                      id={`player-${player.id_player}`}
                      label={player.displayName || player.id_player}
                      role={player.role}
                      status={player.status}
                      isSelf={false}
                    />
                  );
                })}
              
              {/* Affichage du trajet vers la zone de départ en phase de convergence */}
              {gameDetails.is_converging_phase && 
               currentPosition && 
               gameDetails.start_zone_latitude && 
               gameDetails.start_zone_longitude && 
               routePath.length > 0 && (
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: 'blue',
                    weight: 4,
                    opacity: 0.9,
                    className: 'neon-pulse-route-agent'
                  }}
                />
              )}
            </MapContainer>
          </div>
        ) : (
          <p>Chargement des détails de la partie...</p>
        )}

        {/* Boussole superposée sur la carte */}
        <div className="compass-overlay">
          <Compass
            size="small"
            width={COMPASS_SIZE_SMALL}
            currentPosition={
              currentPosition 
                ? {
                    latitude: currentPosition[0],
                    longitude: currentPosition[1]
                  }
                : {
                    latitude: COMPASS_DEFAULT_LATITUDE,
                    longitude: COMPASS_DEFAULT_LONGITUDE
                  }
            }
            targetPoints={[
              // Zone de départ Agent
              ...(gameDetails?.start_zone_latitude && gameDetails?.start_zone_longitude
                ? [{
                    latitude: parseFloat(gameDetails.start_zone_latitude),
                    longitude: parseFloat(gameDetails.start_zone_longitude),
                    label: "Zone Agent",
                    color: "#0066ff"
                  }]
                : []),
              // Cercles d'objectifs (centres)
              ...objectiveCircles
                .filter(isObjectiveCircleVisible)
                .filter(circle => circle.radius > 0)
                .map((circle, index) => ({
                  latitude: circle.center[0],
                  longitude: circle.center[1],
                  label: `Objectif ${index + 1}`,
                  color: "#ff6b6b"
                }))
            ]}
            showTargetArrows={true}
          />
          {!currentPosition && (
            <div className="compass-debug-info">
              <small>🧭 Mode Test - Position en cours de chargement</small>
            </div>
          )}
        </div>

         <div className="fab-container">
          <IonFabButton onClick={() => setIsFabOpen(!isFabOpen)}>
            <IonIcon icon={apertureOutline} />
          </IonFabButton>
          

          <div className={`fab-list fab-list-start ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton color="light" onClick={handleVisionMode}>
              <IonIcon icon={colorFilterOutline} />
            </IonFabButton>
            <IonFabButton color="light" onClick={handleHealthCheck}>
              <IonIcon icon={fitnessOutline} />
            </IonFabButton>
          </div>

          <div className={`fab-list fab-list-end ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton color="light" onClick={handleLocationTracker}>
              <IonIcon icon={locateOutline} />
            </IonFabButton>
            <IonFabButton color="light" onClick={handleThreatDetection}>
              <IonIcon icon={skullOutline} />
            </IonFabButton>
          </div>
        </div>

        {/* Bouton flottant centré pour démarrer la partie (admin uniquement) */}
        {isHost && !gameDetails?.started && Array.isArray(gameDetails?.players) && gameDetails!.players!.length > 0 && gameDetails!.players!.every(p => p.isInStartZone === true) && (
          <div style={{ 
            position: 'fixed', 
            left: '50%', 
            top: '50%', 
            transform: 'translate(-50%, -50%)', 
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            padding: '20px',
            background: 'rgba(0, 0, 0, 0.8)',
            borderRadius: '15px',
            border: '2px solid #2dd36f',
            boxShadow: '0 0 30px rgba(45, 211, 111, 0.5)'
          }}>
            <div style={{ color: '#2dd36f', fontSize: '14px', fontWeight: 'bold', textAlign: 'center' }}>
              ✅ Tous les joueurs sont en position
            </div>
            <IonButton 
              color="success" 
              size="large" 
              onClick={handleAdminStartFromStartZone}
              style={{ 
                '--box-shadow': '0 4px 20px rgba(45, 211, 111, 0.6)',
                fontSize: '18px',
                fontWeight: 'bold'
              }}
            >
              🚀 DÉMARRER LA PARTIE
            </IonButton>
            <div style={{ color: '#aaa', fontSize: '12px', textAlign: 'center' }}>
              {gameDetails?.players?.length || 0} joueur(s) prêt(s)
            </div>
          </div>
        )}

        {/* Modal pour la caméra de détection de menaces */}
        <IonModal 
          isOpen={isCameraModalOpen} 
          onDidDismiss={() => setIsCameraModalOpen(false)}
          className="camera-modal"
        >
          <Camera
            onCapture={(imageData) => {
              toast.success('📸 Photo capturée pour analyse de menaces');
            }}
            onQRCodeDetected={(qrCode) => {
              (async () => {
                try {
                  toast.success(`🔍 QR Code détecté: ${qrCode}`);
                  const raw = (qrCode || '').trim();
                  if (!raw) return;

                  let scannedPlayerId: string | null = null;
                  let scannedGameCode: string | null = null;
                  if (raw.includes(';')) {
                    const parts = raw.split(';');
                    scannedPlayerId = (parts[0] || '').trim();
                    scannedGameCode = (parts[1] || '').trim() || null;
                  } else {
                    scannedPlayerId = raw;
                  }

                  if (!scannedPlayerId) {
                    await handleErrorWithUser('QR Code invalide: identifiant manquant', null, ERROR_CONTEXTS.VALIDATION);
                    return;
                  }

                  if (scannedGameCode && gameDetails?.code && scannedGameCode !== gameDetails.code) {
                    toast.error('❌ QR Code d\'une autre partie');
                    return;
                  }

                  if (!gameDetails?.started || !gameDetails?.countdown_started) {
                    toast.error('⏳ La partie n\'a pas encore commencé');
                    return;
                  }

                  const targetPlayer = gameDetails?.players?.find(p => p.id_player === scannedPlayerId);
                  if (!targetPlayer) {
                    await handleErrorWithUser('Joueur du QR code introuvable dans cette partie', null, ERROR_CONTEXTS.DATABASE);
                    return;
                  }

                  if (targetPlayer.role !== 'ROGUE') {
                    toast.info('ℹ️ QR scanné: ce joueur n\'est pas un Rogue');
                    return;
                  }

                  if (targetPlayer.status === 'CAPTURED') {
                    toast.info('🔒 Ce Rogue est déjà capturé');
                    return;
                  }

                  // Vérifier la distance entre l'Agent et le Rogue
                  if (currentPosition && targetPlayer.latitude && targetPlayer.longitude) {
                    const agentRange = gameDetails?.agent_range || DEFAULT_AGENT_RANGE;
                    const distance = calculateDistanceToStartZone(
                      currentPosition,
                      targetPlayer.latitude,
                      targetPlayer.longitude
                    );
                    
                    if (distance > agentRange) {
                      toast.error(`❌ Trop loin ! Distance: ${distance.toFixed(0)}m (Portée: ${agentRange}m)`);
                      return;
                    }
                  } else {
                    toast.error('❌ Impossible de vérifier la distance');
                    return;
                  }

                  await updatePlayer(targetPlayer.id_player.toString(), {
                    status: 'CAPTURED',
                    updated_at: new Date().toISOString()
                  });

                  toast.success('✅ Rogue capturé !');
                  
                  // Le useEffect vérifiera automatiquement si tous les Rogues sont capturés

                  setIsCameraModalOpen(false);
                } catch (err) {
                  await handleErrorWithUser('Erreur lors du traitement du QR code', err, ERROR_CONTEXTS.DATABASE);
                }
              })();
            }}
            onClose={() => setIsCameraModalOpen(false)}
            autoStart={true}
            showControls={true}
            defaultMode="capture"
            className="threat-detection-camera"
          />
        </IonModal>

        {/* Modal de démarrage de partie */}
        <IonModal 
          isOpen={isGameStartModalOpen} 
          onDidDismiss={() => setIsGameStartModalOpen(false)}
          backdropDismiss={false}
        >
          <IonContent className="ion-padding" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)'
          }}>
            <div style={{
              textAlign: 'center',
              padding: '40px',
              borderRadius: '20px',
              background: 'rgba(0, 0, 0, 0.6)',
              border: '3px solid #2dd36f',
              boxShadow: '0 0 50px rgba(45, 211, 111, 0.8)'
            }}>
              {gameDetails?.game_starting && !gameDetails?.started ? (
                <>
                  <h1 style={{ 
                    fontSize: '36px', 
                    marginBottom: '20px',
                    color: '#ffc409',
                    textShadow: '0 0 20px rgba(255, 196, 9, 0.8)',
                    animation: 'pulse 1.5s ease-in-out infinite'
                  }}>
                    ⏳ SYNCHRONISATION...
                  </h1>
                  <p style={{ 
                    fontSize: '20px', 
                    color: '#fff',
                    marginTop: '20px'
                  }}>
                    En attente des autres joueurs
                  </p>
                  <div style={{
                    fontSize: '24px',
                    marginTop: '20px',
                    color: '#2dd36f',
                    fontWeight: 'bold'
                  }}>
                    {(gameDetails?.players || []).filter(p => p.hasAcknowledgedStart === true).length} / {(gameDetails?.players || []).length} prêts
                  </div>
                  <div style={{
                    fontSize: '48px',
                    marginTop: '20px',
                    animation: 'spin 2s linear infinite'
                  }}>
                    🔄
                  </div>
                </>
              ) : (
                <>
                  <h1 style={{ 
                    fontSize: '48px', 
                    marginBottom: '20px',
                    color: '#2dd36f',
                    textShadow: '0 0 20px rgba(45, 211, 111, 0.8)',
                    animation: 'pulse 1.5s ease-in-out infinite'
                  }}>
                    🚀 LA PARTIE COMMENCE !
                  </h1>
                  <p style={{ 
                    fontSize: '24px', 
                    color: '#fff',
                    marginTop: '20px'
                  }}>
                    Le compte à rebours a démarré
                  </p>
                  <div style={{
                    fontSize: '72px',
                    marginTop: '30px',
                    color: '#ffc409',
                    textShadow: '0 0 30px rgba(255, 196, 9, 0.8)'
                  }}>
                    ⏰
                  </div>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>

        {/* Modal pour afficher le QR code */}
        <IonModal isOpen={isQRModalOpen} onDidDismiss={() => setIsQRModalOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>QR Code Joueur</IonTitle>
              <IonButton slot="end" onClick={() => setIsQRModalOpen(false)}>
                Fermer
              </IonButton>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="qr-modal-content">
              {qrCodeText ? (
                <>
                  <h2 className="qr-modal-title">Votre QR Code</h2>
                  <QRCode value={qrCodeText} size={300} />
                  <p className="qr-modal-email">
                    {playerName}
                  </p>
                  <p className="qr-modal-code">
                    Code: {gameDetails?.code}
                  </p>
                </>
              ) : (
                <p>Chargement du QR code...</p>
              )}
            </div>
          </IonContent>
        </IonModal>

      </IonContent>
    </IonPage>
  );
};

export default Agent; 
