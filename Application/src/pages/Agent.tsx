import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonButtons, IonLabel, IonModal } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Polyline, Polygon, Pane } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import { toast } from 'react-toastify';
import { 
  generateRandomPointInCircle, 
  fetchRoute, 
  calculateDistanceToStartZone, 
  isPlayerInStartZone 
} from '../utils/utils';
import { updatePlayerPosition, updatePlayerInStartZone } from '../utils/PlayerUtils';
import { updateGameWinnerType } from '../utils/AdminUtils';
import { add, apertureOutline, camera, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, micOutline, navigate, settings, skullOutline, volumeHighOutline } from 'ionicons/icons';
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

const Agent: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const {
    playerId,
    playerName,
    gameDetails: sessionGameDetails,
    joinLobby,
    updateGameDetails,
    updatePlayer,
    isHost,
    requestLatestState,
    startVoiceTransmission,
    stopVoiceTransmission,
    startToneTransmission,
    stopToneTransmission
  } = useGameSession();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveCircles, setObjectiveCircles] = useState<ObjectiveCircle[]>([]);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isToneActive, setIsToneActive] = useState(false);
  const [isRemoteAudioPlaying, setIsRemoteAudioPlaying] = useState(false);
  const voiceActiveRef = useRef(false);
  const toneActiveRef = useRef(false);
  const activeAudioPeersRef = useRef<Set<string>>(new Set());

  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);
  
  // États pour la routine périodique
  const [routineInterval, setRoutineInterval] = useState<number>(2000); // Valeur par défaut
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(true);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
  
  // Logo du joueur (choisi aléatoirement parmi les 6 disponibles)
  const [playerLogo, setPlayerLogo] = useState<string>('joueur_1.png');

  // Wake Lock pour empêcher l'écran de se mettre en veille
  useWakeLock(true);

  // Hook pour la vibration
  const { vibrate, patterns } = useVibration();
  
  // État pour la modal du QR code
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  
  // Texte pour le QR code (email + code de partie)
  const [qrCodeText, setQrCodeText] = useState<string>('');

  const getPlayerLogo = useCallback((playerIdValue: string) => {
    const hash = Array.from(playerIdValue).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const logoNumber = (hash % 6) + 1;
    return `joueur_${logoNumber}.png`;
  }, []);

  const isPlayerVisible = useCallback((player: Player) => {
    if (player.status === 'disconnected') return false;
    if (player.status === 'CAPTURED') return false;
    const role = (player.role || '').trim().toUpperCase();
    if (role === 'ROGUE') return false;
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
  const handleVoicePressStart = async () => {
    if (voiceActiveRef.current) return;
    voiceActiveRef.current = true;
    setIsVoiceActive(true);
    try {
      await startVoiceTransmission();
      vibrate(patterns.short);
    } catch (error) {
      voiceActiveRef.current = false;
      setIsVoiceActive(false);
      const message = error instanceof Error ? error.message : 'Accès micro refusé';
      toast.error(`🎙️ ${message}`);
    }
  };

  const handleVoicePressEnd = () => {
    if (!voiceActiveRef.current) return;
    voiceActiveRef.current = false;
    setIsVoiceActive(false);
    stopVoiceTransmission();
  };

  const handleTonePressStart = async () => {
    if (toneActiveRef.current) return;
    toneActiveRef.current = true;
    setIsToneActive(true);
    try {
      await startToneTransmission();
      vibrate(patterns.short);
    } catch (error) {
      toneActiveRef.current = false;
      setIsToneActive(false);
      const message = error instanceof Error ? error.message : 'Son indisponible';
      toast.error(`🔊 ${message}`);
    }
  };

  const handleTonePressEnd = () => {
    if (!toneActiveRef.current) return;
    toneActiveRef.current = false;
    setIsToneActive(false);
    stopToneTransmission();
  };

  const handleVisionMode = () => {
    console.log('Mode vision activé');
    // Ici vous pouvez ajouter la logique pour changer le mode de vision
    toast.success('👁️ Mode vision activé');
    vibrate(patterns.short);
  };

  const handleHealthCheck = () => {
    console.log('Ouverture de la modal QR code');
    setIsQRModalOpen(true);
    vibrate(patterns.short);
  };

  const handleLocationTracker = () => {
    console.log('Traceur de localisation activé');
    // Recentrer la carte sur la position du joueur
    if (currentPosition && mapRef.current) {
      mapRef.current.setView(currentPosition, 15);
      console.log(`Carte recentrée sur: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
      toast.success('📍 Carte recentrée sur votre position');
    } else if (currentPosition) {
      toast.info(`📍 Position actuelle: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
    } else {
      toast.error('❌ Position non disponible');
    }
    vibrate(patterns.short);
  };

  const handleThreatDetection = async () => {
    console.log('Détection de menaces activée - Ouverture de la caméra');
    
    // Ouvrir la modal avec la caméra
    setIsCameraModalOpen(true);
    vibrate(patterns.short);
  };





  // Handler pour la fin de partie
  const handleGameEnd = async () => {
    console.log('⏰ TEMPS ÉCOULÉ - Fin de la partie !');
    
    // Arrêter le compte à rebours
    setIsCountdownActive(false);
    setCountdown(0);
        
    if (isHost) {
      console.log('👑 ADMIN - Fin de partie détectée');
      
      // Mettre à jour remaining_time=0 et winner_type à "AGENT" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
        try {
          await updateGameDetails({ remaining_time: 0 });
        } catch (_) {}
        const success = await updateGameWinnerType(code, 'AGENT');
        if (success) {
          console.log('🏆 Winner_type mis à jour: AGENT (temps écoulé)');
        } else {
          console.error('❌ Échec de la mise à jour du winner_type');
        }
      }
      
    } else {
      console.log('👤 JOUEUR - Fin de partie détectée');
    }
    
    // Rediriger vers la page de fin de partie (pour tous les joueurs)
    //history.push('/end-game');
  };


  // Démarrer la partie quand tous les joueurs sont en zone de départ (admin uniquement)
  const handleAdminStartFromStartZone = async () => {
    try {
      const code = gameCode || gameDetails?.code;
      if (!code) {
        await handleErrorWithUser('Code de partie introuvable pour démarrer', null, ERROR_CONTEXTS.GAME_START);
        return;
      }
      await updateGameDetails({
        started: true,
        is_converging_phase: false
      });
      setGameDetails(prev => prev ? { ...prev, started: true, is_converging_phase: false } as any : prev);
      toast.success('🚀 Partie démarrée');
    } catch (error) {
      await handleErrorWithUser('Erreur lors du démarrage de la partie', error, ERROR_CONTEXTS.GAME_START);
    }
  };



  // Fonction de routine périodique
  const executeRoutine = useCallback(async () => {
    // Incrémenter le compteur d'exécutions
    setRoutineExecutionCount(prev => prev + 1);
    
    // Variables pour collecter les informations de la routine
    let gameState = 'Phase normale';
    let distanceToStart = null;
    let isInStartZone = false;
    let positionInfo = 'N/A';
    
    // 1. Vérifier la position actuelle
    if (currentPosition) {
      positionInfo = `${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`;
      
      // Mettre à jour la position du joueur en base de données
      if (currentPlayerId) {
        updatePlayerPosition(currentPlayerId, currentPosition[0], currentPosition[1]);
      }
    }
    
    // 2. Vérifier l'état de la partie
    if (gameDetails) {
      gameState = gameDetails.is_converging_phase ? 'Phase de convergence' : 'Phase normale';
    }
    
    // 4. Vérifier la distance vers la zone de départ correspondante
    if (currentPosition && gameDetails?.start_zone_latitude && gameDetails?.start_zone_longitude) {
      distanceToStart = calculateDistanceToStartZone(
        currentPosition, 
        gameDetails.start_zone_latitude, 
        gameDetails.start_zone_longitude
      );
      
      // Mettre à jour la distance pour l'affichage dans le header
      setDistanceToStartZone(distanceToStart);
      
      // Vérifier si le joueur est dans la zone de départ (rayon de 50m)
      isInStartZone = isPlayerInStartZone(
        currentPosition, 
        gameDetails.start_zone_latitude, 
        gameDetails.start_zone_longitude
      );
      
      // Mettre à jour IsInStartZone en base de données si le joueur est identifié
      if (currentPlayerId) {
        updatePlayerInStartZone(currentPlayerId, isInStartZone);
      }
    }
    
    // 5. Mettre à jour le trajet si nécessaire (en phase de convergence)
    if (gameDetails?.is_converging_phase && 
        currentPosition && 
        gameDetails.start_zone_latitude && 
        gameDetails.start_zone_longitude) {
      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_latitude),
        parseFloat(gameDetails.start_zone_longitude)
      ];
      const route = await fetchRoute(currentPosition, startZone);
      setRoutePath(route);
    }
    
    // Console.log unifié avec toutes les informations de la routine
    console.log(`🔄 Routine #${routineExecutionCount} | État: ${gameState} | Position: ${positionInfo} | Distance: ${distanceToStart ? distanceToStart.toFixed(0) + 'm' : 'N/A'} | Zone départ: ${isInStartZone ? 'OUI' : 'NON'}`);
    
  }, [currentPosition, gameDetails, objectiveCircles, routineExecutionCount, currentPlayerId]);





  // Effet pour gérer la routine périodique
  useEffect(() => {
    if (isRoutineActive && routineInterval > 0) {
      // Nettoyer l'intervalle précédent s'il existe
      if (routineIntervalRef.current) {
        clearInterval(routineIntervalRef.current);
      }
      
      // Créer un nouvel intervalle
      routineIntervalRef.current = setInterval(() => {
        executeRoutine();
      }, routineInterval);
      
      
    } else {
      // Arrêter la routine
      if (routineIntervalRef.current) {
        clearInterval(routineIntervalRef.current);
        routineIntervalRef.current = null;
        console.log('Routine arrêtée');
      }
    }
    
    // Cleanup lors du démontage du composant
    return () => {
      if (routineIntervalRef.current) {
        clearInterval(routineIntervalRef.current);
        routineIntervalRef.current = null;
      }
    };
  }, [isRoutineActive, routineInterval, executeRoutine]);

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

        if (!sessionGameDetails || sessionGameDetails.code !== code) {
          await joinLobby(code);
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
  }, [location.search, playerId, playerName, sessionGameDetails]);

  useEffect(() => {
    if (sessionGameDetails) {
      setGameDetails(sessionGameDetails);
    }
  }, [sessionGameDetails]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAudioPlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId: string; playing: boolean }>).detail;
      if (!detail?.peerId) return;
      if (detail.playing) {
        activeAudioPeersRef.current.add(detail.peerId);
      } else {
        activeAudioPeersRef.current.delete(detail.peerId);
      }
      setIsRemoteAudioPlaying(activeAudioPeersRef.current.size > 0);
    };
    window.addEventListener('audio:playback', handleAudioPlayback as EventListener);
    return () => {
      window.removeEventListener('audio:playback', handleAudioPlayback as EventListener);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopVoiceTransmission();
      stopToneTransmission();
    };
  }, [stopToneTransmission, stopVoiceTransmission]);

  // Récupérer les cercles stockés pour un rafraîchissement de page (host uniquement)
  useEffect(() => {
    if (!isHost || !gameCode || objectiveCirclesInitialized) return;

    const storedCircles = getStoredObjectiveCircles(gameCode);
    if (!storedCircles) return;
    applyObjectiveCircles(storedCircles, gameCode);
    updateGameDetails({ objective_circles: storedCircles });
    console.log(`${storedCircles.length} cercles d'objectifs restaurés depuis la session de jeu`);
  }, [isHost, gameCode, objectiveCirclesInitialized, applyObjectiveCircles, updateGameDetails]);

  // Synchroniser les cercles depuis l'host si disponibles
  useEffect(() => {
    if (objectiveCirclesInitialized) return;
    if (gameDetails?.objective_circles && gameDetails.objective_circles.length > 0) {
      applyObjectiveCircles(gameDetails.objective_circles, gameCode);
    }
  }, [gameDetails?.objective_circles, objectiveCirclesInitialized, applyObjectiveCircles, gameCode]);

  // Si on est un joueur non-host, demander un resync si les cercles manquent
  useEffect(() => {
    if (isHost) return;
    if (objectiveCirclesInitialized) return;
    if (!gameDetails?.started) return;
    if (gameDetails?.objective_circles && gameDetails.objective_circles.length > 0) return;

    const now = Date.now();
    const lastRequest = objectiveCirclesSyncRef.current;
    if (lastRequest && now - lastRequest < 5000) return;
    objectiveCirclesSyncRef.current = now;
    requestLatestState();
  }, [
    isHost,
    objectiveCirclesInitialized,
    gameDetails?.started,
    gameDetails?.objective_circles,
    requestLatestState
  ]);

  // Calculer les cercles d'objectifs une seule fois au démarrage de la partie (host)
  useEffect(() => {
    if (!isHost || !gameDetails?.started || !gameDetails.props || !gameCode || objectiveCirclesInitialized) {
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
      console.log(`${storedCircles.length} cercles d'objectifs restaurés depuis la session de jeu`);
      return;
    }

    const circles = gameDetails.props.map((prop: GameProp) => ({
      id_prop: prop.id_prop,
      center: generateRandomPointInCircle(
        [parseFloat(prop.latitude || '0'), parseFloat(prop.longitude || '0')],
        prop.detection_radius || 0
      ),
      radius: prop.detection_radius || 0
    }));
    applyObjectiveCircles(circles, gameCode);
    updateGameDetails({ objective_circles: circles });
    console.log(`${circles.length} cercles d'objectifs initialisés`);
  }, [isHost, gameDetails?.started, gameDetails?.props, objectiveCirclesInitialized, gameCode, applyObjectiveCircles, updateGameDetails]);

  // Fallback: afficher des cercles basés sur les props si l'état n'est pas encore synchronisé
  useEffect(() => {
    if (objectiveCirclesInitialized) return;
    if (!gameDetails?.started) return;
    if (objectiveCircles.length > 0) return;
    if (!gameDetails?.props || gameDetails.props.length === 0) return;

    const fallbackCircles = buildFallbackObjectiveCircles(gameDetails.props);
    if (fallbackCircles.length === 0) return;
    setObjectiveCircles(fallbackCircles);
  }, [
    objectiveCirclesInitialized,
    objectiveCircles.length,
    gameDetails?.started,
    gameDetails?.props,
    buildFallbackObjectiveCircles
  ]);

  // Déterminer si l'utilisateur courant est admin
  useEffect(() => {
    if (!isHost) {
      return;
    }
    if (gameDetails?.started && !isCountdownActive) {
      const totalSeconds = (gameDetails.remaining_time ?? gameDetails.duration) || 0;
      if (totalSeconds > 0) {
        setCountdown(totalSeconds);
        setIsCountdownActive(true);
      }
    }
  }, [gameDetails?.started, gameDetails?.duration, gameDetails?.remaining_time, isCountdownActive, isHost]);

  useEffect(() => {
    // Choisir un logo de joueur aléatoirement
    const logoNumber = Math.floor(Math.random() * 6) + 1;
    setPlayerLogo(`joueur_${logoNumber}.png`);
    
    // Get initial position
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.log("Geolocation error on initial position:", error.code, error.message);
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
          console.log("Geolocation watch error:", error.code, error.message);
          // Don't log to error handler - watchPosition will keep trying
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000, // Accept position up to 1 second old for smoother tracking
          timeout: 15000 // Increased timeout to 15 seconds
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  useEffect(() => {
    if (currentPosition && currentPlayerId) {
      updatePlayerPosition(currentPlayerId, currentPosition[0], currentPosition[1]);
    }
  }, [currentPosition, currentPlayerId]);

  // Effet pour récupérer le trajet routier en phase de convergence
  useEffect(() => {
    const updateRoute = async () => {
      if (gameDetails?.is_converging_phase && 
          currentPosition && 
          gameDetails.start_zone_latitude && 
          gameDetails.start_zone_longitude) {
        
        const startZone: [number, number] = [
          parseFloat(gameDetails.start_zone_latitude),
          parseFloat(gameDetails.start_zone_longitude)
        ];
        
        const route = await fetchRoute(currentPosition, startZone);
        setRoutePath(route);
      } else {
        setRoutePath([]);
      }
    };
    
    updateRoute();
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_latitude, gameDetails?.start_zone_longitude]);

  // Effet pour réinitialiser la distance quand on n'est plus en phase de convergence
  useEffect(() => {
    if (!gameDetails?.is_converging_phase) {
      setDistanceToStartZone(null);
    }
  }, [gameDetails?.is_converging_phase]);

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
      
      console.log(`⏰ Compte à rebours démarré: ${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')}`);
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

  useEffect(() => {
    setRoutineInterval(2000);
  }, []);

  const fogRings = useFogRings(gameDetails, 50);

  return (
    <IonPage>
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
              zoom={15}
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
              <Circle
                center={[
                  parseFloat(gameDetails.map_center_latitude || '0'), 
                  parseFloat(gameDetails.map_center_longitude || '0')
                ]}
                radius={gameDetails.map_radius || 750}
                pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
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
                    radius={50}
                    pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.1 }}
                  />
                </>
              )}
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
                      playerLogo={getPlayerLogo(player.id_player)}
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
              // Zone de départ Agent
              ...(gameDetails?.start_zone_latitude && gameDetails?.start_zone_longitude
                ? [{
                    latitude: parseFloat(gameDetails.start_zone_latitude),
                    longitude: parseFloat(gameDetails.start_zone_longitude),
                    label: "Zone Agent",
                    color: "#0066ff"
                  }]
                : []),
              // Cercles d'objectifs (centres des cercles)
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

        {isRemoteAudioPlaying && (
          <div
            style={{
              position: 'fixed',
              top: '72px',
              right: '16px',
              zIndex: 1000,
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label="Audio en lecture"
          >
            <IonIcon icon={volumeHighOutline} color="light" />
          </div>
        )}

                 <IonButton expand="block" onClick={() => history.push('/end-game')}>
           EndGame
         </IonButton>



         <div className="fab-container">
          <IonFabButton onClick={() => setIsFabOpen(!isFabOpen)}>
            <IonIcon icon={apertureOutline} />
          </IonFabButton>
          
          <div className={`fab-list fab-list-top ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton
              color={isVoiceActive ? 'danger' : 'light'}
              onPointerDown={handleVoicePressStart}
              onPointerUp={handleVoicePressEnd}
              onPointerLeave={handleVoicePressEnd}
              onPointerCancel={handleVoicePressEnd}
              aria-label="Parler au micro"
            >
              <IonIcon icon={micOutline} />
            </IonFabButton>
            <IonFabButton
              color={isToneActive ? 'warning' : 'light'}
              onPointerDown={handleTonePressStart}
              onPointerUp={handleTonePressEnd}
              onPointerLeave={handleTonePressEnd}
              onPointerCancel={handleTonePressEnd}
              aria-label="Diffuser un son"
            >
              <IonIcon icon={volumeHighOutline} />
            </IonFabButton>
          </div>

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
          <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 1000 }}>
            <IonButton color="success" size="large" onClick={handleAdminStartFromStartZone}>
              🚀 Démarrer maintenant
            </IonButton>
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
              console.log('Photo capturée pour détection de menaces:', imageData);
              toast.success('📸 Photo capturée pour analyse de menaces');
              // Ici vous pouvez ajouter la logique pour analyser la photo
            }}
            onQRCodeDetected={(qrCode) => {
              (async () => {
                try {
                  console.log('QR Code détecté:', qrCode);
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

                  await updatePlayer(targetPlayer.id_player.toString(), {
                    status: 'CAPTURED',
                    updated_at: new Date().toISOString()
                  });

                  toast.success('✅ Rogue capturé !');

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
