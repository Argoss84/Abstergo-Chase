import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonLabel, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonModal } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Polyline, Polygon, Pane } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { toast } from 'react-toastify';
import { 
  generateRandomPointInCircle, 
  calculateDistanceToStartZone, 
  isPlayerInStartZone,
  fetchRoute
} from '../utils/utils';
import { updatePlayerPosition, updatePlayerInStartZone } from '../utils/PlayerUtils';
import { updateGameWinnerType } from '../utils/AdminUtils';
import { add, apertureOutline, camera, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, radioOutline, settings, skullOutline } from 'ionicons/icons';
import './Rogue.css';
import { GameProp, GameDetails, Player } from '../components/Interfaces';
import PopUpMarker from '../components/PopUpMarker';
import Compass from '../components/Compass';
import QRCode from '../components/QRCode';
import { useGameSession } from '../contexts/GameSessionContext';
import { useWakeLock } from '../utils/useWakeLock';
import { useVibration } from '../hooks/useVibration';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
import { MapController, ResizeMap, useFogRings } from '../utils/GameMapUtils';
import {
  DEFAULT_HACK_DURATION_MS,
  DEFAULT_DETECTION_RADIUS,
  START_ZONE_RADIUS,
  DEFAULT_MAP_ZOOM,
  FOG_RINGS_ROGUE,
  GEOLOCATION_TIMEOUT,
  GEOLOCATION_MAX_AGE,
  GEOLOCATION_WATCH_MAX_AGE,
  ROUTE_UPDATE_MIN_INTERVAL_MS,
  ROUTE_UPDATE_MIN_DISTANCE_METERS,
  COMPASS_SIZE_SMALL,
  COMPASS_DEFAULT_LATITUDE,
  COMPASS_DEFAULT_LONGITUDE,
  QR_CODE_SIZE,
  DEFAULT_ROGUE_RANGE,
  getRandomPlayerLogo
} from '../ressources/DefaultValues';

const Rogue: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const {
    playerId,
    playerName,
    gameDetails: sessionGameDetails,
    joinGame,
    updateGameDetails,
    updateProp,
    updatePlayer,
    isHost,
    connectionStatus,
    sessionScope
  } = useGameSession();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveProps, setObjectiveProps] = useState<GameProp[]>([]);
  
  // États pour le compte à rebours
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  
  // États pour l'itinéraire en phase de convergence
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);
  const lastRouteUpdateRef = useRef(0);
  const lastRoutePositionRef = useRef<[number, number] | null>(null);
  const lastRouteStartZoneRef = useRef<string | null>(null);
  const routeRequestIdRef = useRef(0);
  
  // Référence pour la carte
  const mapRef = useRef<L.Map | null>(null);
  
  // Logo du joueur (choisi aléatoirement parmi les 6 disponibles)
  const [playerLogo, setPlayerLogo] = useState<string>('joueur_1.png');
  
  // État pour les boutons FAB
  const [isFabOpen, setIsFabOpen] = useState(false);
  
  // État pour détecter si un objectif est à portée
  const [isObjectiveInRange, setIsObjectiveInRange] = useState<boolean>(false);
  
  // État pour suivre si une capture est en cours
  const [isCaptureInProgress, setIsCaptureInProgress] = useState<boolean>(false);
  
  // Référence pour stocker l'ID du toast de capture
  const captureToastRef = useRef<string | number | null>(null);
  
  // Référence pour stocker le timeout de capture
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const getPlayerLogo = useCallback((playerIdValue: string) => {
    const hash = Array.from(playerIdValue).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const logoNumber = (hash % 6) + 1;
    return `joueur_${logoNumber}.png`;
  }, []);

  const isPlayerVisible = useCallback((player: Player) => {
    if (player.status === 'disconnected') return false;
    if (player.status === 'CAPTURED') return false;
    const role = (player.role || '').trim().toUpperCase();
    if (role !== 'ROGUE') return false;
    return true;
  }, []);

  const getPlayerMarkerPosition = useCallback((player: Player): [number, number] | null => {
    if (player.latitude && player.longitude) {
      return [parseFloat(player.latitude), parseFloat(player.longitude)];
    }
    return null;
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

    // Victoire Agent si tous les Rogues sont capturés
    const allRogues = gameDetails.players?.filter(p => p.role?.toUpperCase() === 'ROGUE') || [];
    const capturedRogues = allRogues.filter(p => p.status === 'CAPTURED');

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

  const fogRings = useFogRings(gameDetails, FOG_RINGS_ROGUE);

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

  const handleCaptureObjectiv = async () => {
    // Vérifier si une capture est déjà en cours
    if (isCaptureInProgress) {
      toast.info('⚠️ Capture déjà en cours...');
      return;
    }
    
    if (isObjectiveInRange) {
      const hackDuration = gameDetails?.hack_duration_ms || DEFAULT_HACK_DURATION_MS;
      
      // Marquer qu'une capture est en cours
      setIsCaptureInProgress(true);
      
      const toastId = toast(
        <div className="hacker-toast">
          <div className="hacker-header">
            <span className="hacker-icon">⚡</span>
            <span className="hacker-title">SYSTÈME DE CAPTURE ACTIVÉ</span>
            <span className="hacker-icon">⚡</span>
          </div>
          <div className="hacker-progress">
            <div className="hacker-progress-bar">
              <div className="hacker-progress-fill" style={{ animationDuration: `${hackDuration}ms` }}></div>
            </div>
            <div className="hacker-status">INTRUSION EN COURS...</div>
          </div>
        </div>,
        {
          autoClose: false,
          closeButton: false,
          draggable: false,
          closeOnClick: false,
          pauseOnHover: false,
          position: "top-center",
          className: "hacker-toast-container",
          type: "default"
        }
      );
      
      // Stocker l'ID du toast dans la référence
      captureToastRef.current = toastId;
      
      // Trouver l'objectif à portée pour le capturer
      if (currentPosition && objectiveProps.length > 0) {
        const rogueRange = gameDetails?.rogue_range || DEFAULT_ROGUE_RANGE;
        const objectiveInRange = objectiveProps
          .filter(prop => prop.visible === true)
          .find(prop => {
            const distance = calculateDistanceToStartZone(
              currentPosition,
              prop.latitude || '0',
              prop.longitude || '0'
            );
            return distance <= rogueRange;
          });
        
        if (objectiveInRange) {
          try {
            // Marquer l'objectif comme en cours de capture pour la synchro
            await updateProp(objectiveInRange.id_prop, {
              state: "CAPTURING"
            });
            setObjectiveProps(prevProps =>
              prevProps.map(prop =>
                prop.id_prop === objectiveInRange.id_prop
                  ? { ...prop, state: "CAPTURING" }
                  : prop
              )
            );
          } catch (error) {
            // Erreur silencieuse
          }

          // Fermer le toast et réinitialiser l'état à la fin de l'animation
          captureTimeoutRef.current = setTimeout(async () => {
            if (captureToastRef.current) {
              toast.dismiss(captureToastRef.current);
            }
            
            try {
              // Mettre à jour l'objectif capturé
              await updateProp(objectiveInRange.id_prop, {
                visible: false,
                state: "CAPTURED"
              });
              
              // Mettre à jour l'état local des objectifs
              setObjectiveProps(prevProps => 
                prevProps.map(prop => 
                  prop.id_prop === objectiveInRange.id_prop 
                    ? { ...prop, visible: false, state: "CAPTURED" }
                    : prop
                )
              );
              
              toast.success('🎯 Objectif capturé avec succès !');
              
              // Le useEffect vérifiera automatiquement si tous les objectifs sont capturés
            } catch (error) {
              toast.error('❌ Erreur lors de la capture de l\'objectif');
            }
            
            setIsCaptureInProgress(false);
            captureToastRef.current = null;
            captureTimeoutRef.current = null;
          }, hackDuration);
        } else {
          // Fermer le toast si aucun objectif n'est trouvé après l'avoir créé
          if (captureToastRef.current) {
            toast.dismiss(captureToastRef.current);
          }
          setIsCaptureInProgress(false);
          captureToastRef.current = null;
          toast.warning('❌ Aucun objectif à portée');
        }
      }
    } else {
      toast.warning('❌ Aucun objectif à portée');
    }
    vibrate(patterns.short);
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
          connectionStatus !== 'connected' ||
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
  }, [location.search, playerId, sessionGameDetails, playerName, isHost, connectionStatus, sessionScope]);

  useEffect(() => {
    if (sessionGameDetails) {
      setGameDetails(sessionGameDetails);
      if (sessionGameDetails.props) {
        setObjectiveProps(sessionGameDetails.props);
      }
    }
  }, [sessionGameDetails, isHost]);



  // Handler pour la fin de partie
  const handleGameEnd = async () => {
    // Arrêter le compte à rebours
    setIsCountdownActive(false);
    setCountdown(0);
        
    if (isHost) {
      // Mettre à jour remaining_time=0 puis winner_type à "ROGUE" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
        try {
          await updateGameDetails({ remaining_time: 0 });
        } catch (_) {}
        await updateGameWinnerType(code, 'ROGUE');
      }
    }
    
    // Rediriger vers la page de fin de partie (pour tous les joueurs)
    history.push('/end-game');
  };

  useEffect(() => {
    // Choisir un logo de joueur aléatoirement
    setPlayerLogo(getRandomPlayerLogo());
    
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
          timeout: GEOLOCATION_TIMEOUT,
          maximumAge: GEOLOCATION_MAX_AGE
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
    if (!isHost && gameDetails?.remaining_time !== undefined && gameDetails?.remaining_time !== null) {
      setCountdown(gameDetails.remaining_time);
    }
  }, [gameDetails?.remaining_time, isHost]);

  useEffect(() => {
    if (!isHost && (gameDetails?.remaining_time === 0 || gameDetails?.winner_type)) {
      history.push('/end-game');
    }
  }, [gameDetails?.remaining_time, gameDetails?.winner_type, isHost, history]);

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

      if (!currentPosition || !gameDetails.start_zone_rogue_latitude || !gameDetails.start_zone_rogue_longitude) {
        return;
      }

      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_rogue_latitude),
        parseFloat(gameDetails.start_zone_rogue_longitude)
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
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_rogue_latitude, gameDetails?.start_zone_rogue_longitude]);

  // Calculer la distance à la zone de départ en temps réel (pour l'affichage local uniquement)
  useEffect(() => {
    if (!gameDetails?.is_converging_phase) {
      setDistanceToStartZone(null);
      return;
    }

    if (currentPosition && gameDetails?.start_zone_rogue_latitude && gameDetails?.start_zone_rogue_longitude) {
      const distance = calculateDistanceToStartZone(
        currentPosition, 
        gameDetails.start_zone_rogue_latitude, 
        gameDetails.start_zone_rogue_longitude
      );
      setDistanceToStartZone(distance);
    }
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_rogue_latitude, gameDetails?.start_zone_rogue_longitude]);

  // Vérifier en temps réel si le joueur est dans la zone de départ (mise à jour locale)
  useEffect(() => {
    if (currentPosition && gameDetails?.start_zone_rogue_latitude && gameDetails?.start_zone_rogue_longitude && currentPlayerId) {
      const isInStartZone = isPlayerInStartZone(
        currentPosition, 
        gameDetails.start_zone_rogue_latitude, 
        gameDetails.start_zone_rogue_longitude
      );
      updatePlayerInStartZone(currentPlayerId, isInStartZone);
    }
  }, [currentPosition, gameDetails?.start_zone_rogue_latitude, gameDetails?.start_zone_rogue_longitude, currentPlayerId, isHost]);

  // Vérifier en temps réel si un objectif est à portée (mise à jour locale)
  useEffect(() => {
    if (currentPosition && objectiveProps.length > 0) {
      const rogueRange = gameDetails?.rogue_range || DEFAULT_ROGUE_RANGE;
      const objectiveInRange = objectiveProps
        .filter(prop => prop.visible === true)
        .some(prop => {
          const distance = calculateDistanceToStartZone(
            currentPosition,
            prop.latitude || '0',
            prop.longitude || '0'
          );
          return distance <= rogueRange;
        });
      
      setIsObjectiveInRange(objectiveInRange);
    } else {
      setIsObjectiveInRange(false);
    }
  }, [currentPosition, objectiveProps, gameDetails?.rogue_range]);

  // Cleanup du toast et du timeout de capture lors du démontage ou quand la capture se termine
  useEffect(() => {
    return () => {
      // Nettoyer le timeout s'il existe
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current);
        captureTimeoutRef.current = null;
      }
      
      // Fermer le toast s'il existe
      if (captureToastRef.current) {
        toast.dismiss(captureToastRef.current);
        captureToastRef.current = null;
      }
    };
  }, []);

  // Détecter si un objectif en cours de capture a été capturé via synchronisation
  useEffect(() => {
    if (isCaptureInProgress && captureToastRef.current) {
      // Vérifier si tous les objectifs visibles ont été capturés
      const hasVisibleObjectives = objectiveProps.some(prop => prop.visible === true);
      
      if (!hasVisibleObjectives) {
        // Tous les objectifs ont été capturés (probablement via synchronisation)
        // Fermer le toast et nettoyer l'état
        if (captureTimeoutRef.current) {
          clearTimeout(captureTimeoutRef.current);
          captureTimeoutRef.current = null;
        }
        
        if (captureToastRef.current) {
          toast.dismiss(captureToastRef.current);
          captureToastRef.current = null;
        }
        
        setIsCaptureInProgress(false);
      }
    }
  }, [isCaptureInProgress, objectiveProps]);

  const visibleObjectives = objectiveProps.filter(prop => prop.visible === true);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Rogue</IonTitle>
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
                    radius={50}
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
                    radius={START_ZONE_RADIUS}
                    pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.1 }}
                  />
                </>
              )}
              {visibleObjectives.map((prop, index) => {
                const objectiveName = prop.name?.trim() || `Objectif ${index + 1}`;
                return (
                  <PopUpMarker
                    key={prop.id_prop}
                    position={[parseFloat(prop.latitude || '0'), parseFloat(prop.longitude || '0')]}
                    type="objective"
                    data={{ ...prop, name: objectiveName }}
                    id={prop.id_prop}
                  />
                );
              })}
               
               {/* Affichage du trajet vers la zone de départ en phase de convergence */}
               {gameDetails.is_converging_phase && 
                currentPosition && 
                gameDetails.start_zone_rogue_latitude && 
                gameDetails.start_zone_rogue_longitude && 
                routePath.length > 0 && (
                 <Polyline
                   positions={routePath}
                   pathOptions={{
                     color: 'green',
                     weight: 4,
                     opacity: 0.9,
                     className: 'neon-pulse-route'
                   }}
                 />
               )}
               
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
                      playerLogo={getPlayerLogo(player.id_player)}
                      id={`player-${player.id_player}`}
                      label={player.displayName || player.id_player}
                      role={player.role}
                      status={player.status}
                      isSelf={false}
                    />
                  );
                })}
            </MapContainer>
          </div>
        ) : (
          <p>Chargement des détails de la partie...</p>
        )}

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

        {/* Composant de test de la boussole */}
        {/* Boussole superposée sur la carte */}
        {/* Boussole toujours visible */}
        <div className="compass-overlay">
          <Compass
            size="small"
            width={75} // Largeur personnalisée pour un meilleur positionnement
            currentPosition={
              currentPosition 
                ? {
                    latitude: currentPosition[0],
                    longitude: currentPosition[1]
                  }
                : {
                    latitude: 48.8566, // Paris par défaut
                    longitude: 2.3522
                  }
            }
            targetPoints={[
              // Zone de départ Rogue
              ...(gameDetails?.start_zone_rogue_latitude && gameDetails?.start_zone_rogue_longitude
                ? [{
                    latitude: parseFloat(gameDetails.start_zone_rogue_latitude),
                    longitude: parseFloat(gameDetails.start_zone_rogue_longitude),
                    label: "Zone Rogue",
                    color: "#00ff41"
                  }]
                : []),
              // Objectifs visibles
              ...visibleObjectives.map((prop, index) => ({
                  latitude: parseFloat(prop.latitude || '0'),
                  longitude: parseFloat(prop.longitude || '0'),
                  label: prop.name?.trim() || `Objectif ${index + 1}`,
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
                         <IonFabButton 
              color="light" 
              onClick={handleCaptureObjectiv}
              className={`${isObjectiveInRange ? 'objective-in-range' : ''} ${isCaptureInProgress ? 'capture-in-progress' : ''}`}
              disabled={isCaptureInProgress}
            >
              <IonIcon icon={radioOutline} />
            </IonFabButton>
          </div>
        </div>

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
                  <QRCode value={qrCodeText} size={QR_CODE_SIZE} />
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

export default Rogue;
