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
  
  // États pour la routine périodique (Host uniquement)
  const [routineInterval, setRoutineInterval] = useState<number>(2000); // Valeur par défaut
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(false);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  
  // États pour l'itinéraire en phase de convergence
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);
  
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
    if (role === 'AGENT') return false;
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

  // Activer la routine uniquement pour le Host
  useEffect(() => {
    if (isHost) {
      setRoutineInterval(2000);
      setIsRoutineActive(true);
    } else {
      setIsRoutineActive(false);
    }
  }, [isHost]);

  // Effet pour vérifier les conditions de victoire (Host uniquement)
  useEffect(() => {
    if (!isHost || !gameDetails?.started || gameDetails?.winner_type) return;

    const allObjectives = gameDetails.props || [];
    const capturedObjectives = allObjectives.filter(p => p.state === 'CAPTURED');

    // Victoire Rogue si tous les objectifs sont capturés
    if (allObjectives.length > 0 && capturedObjectives.length >= allObjectives.length) {
      console.log('🏆 Tous les objectifs capturés - Victoire des Rogues !');
      updateGameDetails({ 
        winner_type: 'ROGUE',
        remaining_time: 0 
      }).then(() => {
        setTimeout(() => {
          history.push('/end-game');
        }, 1000);
      });
    }
  }, [isHost, gameDetails?.started, gameDetails?.winner_type, gameDetails?.props, updateGameDetails, history]);

  const fogRings = useFogRings(gameDetails, 20);

  // Fonctions pour les boutons FAB

  const handleVisionMode = () => {
    console.log('Mode vision activé');
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
    if (currentPosition && mapRef.current) {
      mapRef.current.setView(currentPosition, 15);
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
      const hackDuration = gameDetails?.hack_duration_ms || 5000; // 5 secondes par défaut
      
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
        const objectiveInRange = objectiveProps
          .filter(prop => prop.visible === true)
          .find(prop => {
            const distance = calculateDistanceToStartZone(
              currentPosition,
              prop.latitude || '0',
              prop.longitude || '0'
            );
            const detectionRadius = prop.detection_radius || 30;
            return distance <= detectionRadius;
          });
        
        if (objectiveInRange) {
          try {
            // Marquer l'objectif comme en cours de capture pour la synchro
            if (!isHost) {
              console.log(`📤 [WebRTC] Émission capture objectif: ${objectiveInRange.id_prop} (CAPTURING)`);
            }
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
            console.error('❌ Erreur lors du marquage de la capture:', error);
          }

          // Fermer le toast et réinitialiser l'état à la fin de l'animation
          setTimeout(async () => {
            if (captureToastRef.current) {
              toast.dismiss(captureToastRef.current);
            }
            
            try {
              // Mettre à jour l'objectif capturé
              if (!isHost) {
                console.log(`📤 [WebRTC] Émission capture objectif: ${objectiveInRange.id_prop} (CAPTURED)`);
              }
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
              console.error('❌ Erreur lors de la capture de l\'objectif:', error);
              toast.error('❌ Erreur lors de la capture de l\'objectif');
            }
            
            setIsCaptureInProgress(false);
            captureToastRef.current = null;
          }, hackDuration);
        } else {
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
      await updateGameDetails({
        started: true,
        is_converging_phase: false
      });
      toast.success(`🚀 Partie démarrée avec ${playerCount} joueur(s) !`);
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
      if (!isHost) {
        console.log(`📥 [WebRTC] Réception état du jeu:`, {
          players: sessionGameDetails.players?.length || 0,
          props: sessionGameDetails.props?.length || 0,
          remaining_time: sessionGameDetails.remaining_time,
          is_converging_phase: sessionGameDetails.is_converging_phase,
          winner_type: sessionGameDetails.winner_type
        });
      }
      setGameDetails(sessionGameDetails);
      if (sessionGameDetails.props) {
        setObjectiveProps(sessionGameDetails.props);
        if (!isHost) {
          console.log(`${sessionGameDetails.props.length} objectifs synchronisés via WebRTC`);
        }
      }
    }
  }, [sessionGameDetails, isHost]);



  // Handler pour la fin de partie
  const handleGameEnd = async () => {
    console.log('⏰ TEMPS ÉCOULÉ - Fin de la partie !');
    
    // Arrêter le compte à rebours
    setIsCountdownActive(false);
    setCountdown(0);
        
    if (isHost) {
      console.log('👑 ADMIN - Fin de partie détectée');
      
      // Mettre à jour remaining_time=0 puis winner_type à "ROGUE" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
        try {
          await updateGameDetails({ remaining_time: 0 });
        } catch (_) {}
        const success = await updateGameWinnerType(code, 'ROGUE');
        if (success) {
          console.log('🏆 Winner_type mis à jour: ROGUE (temps écoulé)');
        } else {
          console.error('❌ Échec de la mise à jour du winner_type');
        }
      }
      
    } else {
      console.log('👤 JOUEUR - Fin de partie détectée');
    }
    
    // Rediriger vers la page de fin de partie (pour tous les joueurs)
    history.push('/end-game');
  };

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

  // Mise à jour de la position (géolocalisation locale uniquement)
  // La synchronisation se fait via WebRTC pour tous les joueurs
  useEffect(() => {
    if (currentPosition && currentPlayerId) {
      if (!isHost) {
        console.log(`📤 [WebRTC] Émission position: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
      }
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

  // Effet pour initialiser le compte à rebours quand la partie démarre (privilégier remaining_time)
  useEffect(() => {
    if (!isHost) {
      return;
    }
    if (gameDetails?.started && !isCountdownActive) {
      console.log('🚀 Partie démarrée - Initialisation du compte à rebours');
      const totalSeconds = (gameDetails.remaining_time ?? gameDetails.duration) || 0;
      if (totalSeconds > 0) {
        setCountdown(totalSeconds);
        setIsCountdownActive(true);
      }
    }
  }, [gameDetails?.started, gameDetails?.duration, gameDetails?.remaining_time, isCountdownActive, isHost]);

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

  // Fonction de routine périodique
  const executeRoutine = useCallback(async () => {
    
    // Incrémenter le compteur d'exécutions
    setRoutineExecutionCount(prev => prev + 1);
    
    // Exemple de tâches que la routine peut effectuer :
    // 1. Vérifier la position actuelle
    if (currentPosition) {
      
      // Mettre à jour la position du joueur en base de données
      if (currentPlayerId) {
        updatePlayerPosition(currentPlayerId, currentPosition[0], currentPosition[1]);
      }
    }
    
    // 2. Vérifier l'état de la partie
    let gameState = 'Phase normale';
    let distanceToStart = null;
    let isInStartZone = false;
    let objectiveInRange = false;
    
    if (gameDetails) {
      gameState = gameDetails.is_converging_phase ? 'Phase de convergence' : 'Phase normale';
    }
    
    // 4. Vérifier la distance vers la zone de départ correspondante
    if (currentPosition && gameDetails?.start_zone_rogue_latitude && gameDetails?.start_zone_rogue_longitude) {
      distanceToStart = calculateDistanceToStartZone(
        currentPosition, 
        gameDetails.start_zone_rogue_latitude, 
        gameDetails.start_zone_rogue_longitude
      );
      
      // Mettre à jour la distance pour l'affichage dans le header
      setDistanceToStartZone(distanceToStart);
      
      // Vérifier si le joueur est dans la zone de départ Rogue (rayon de 50m)
      isInStartZone = isPlayerInStartZone(
        currentPosition, 
        gameDetails.start_zone_rogue_latitude, 
        gameDetails.start_zone_rogue_longitude
      );
      
      // Mettre à jour IsInStartZone en base de données si le joueur est identifié
      if (currentPlayerId) {
        updatePlayerInStartZone(currentPlayerId, isInStartZone);
      }
    }
    
    // 5. Mettre à jour le trajet si nécessaire (en phase de convergence)
    if (gameDetails?.is_converging_phase && 
        currentPosition && 
        gameDetails.start_zone_rogue_latitude && 
        gameDetails.start_zone_rogue_longitude) {
      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_rogue_latitude),
        parseFloat(gameDetails.start_zone_rogue_longitude)
      ];
      const route = await fetchRoute(currentPosition, startZone);
      setRoutePath(route);
    }
    
    // 6. Vérifier si un objectif est à portée (utilise detection_radius de GameProp)
    if (currentPosition && objectiveProps.length > 0) {
      objectiveInRange = objectiveProps
        .filter(prop => prop.visible === true)
        .some(prop => {
          const distance = calculateDistanceToStartZone(
            currentPosition,
            prop.latitude || '0',
            prop.longitude || '0'
          );
          // Utiliser detection_radius de l'objet GameProp, avec une valeur par défaut de 30m
          const detectionRadius = prop.detection_radius || 30;
          return distance <= detectionRadius;
        });
      
      setIsObjectiveInRange(objectiveInRange);
    }
    
    // Console.log unifié avec toutes les informations de la routine
    console.log(`🔄 Routine #${routineExecutionCount} | État: ${gameState} | Distance: ${distanceToStart ? distanceToStart.toFixed(0) + 'm' : 'N/A'} | Zone départ: ${isInStartZone ? 'OUI' : 'NON'} | Objectif: ${objectiveInRange ? 'À PORTÉE' : 'HORS PORTÉE'}`);
    
     }, [currentPosition, gameDetails, objectiveProps, routineExecutionCount, currentPlayerId]);



  // Effet pour gérer la routine périodique (Host uniquement)
  useEffect(() => {
    // La routine ne s'exécute que pour le Host
    if (!isHost) {
      return;
    }

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
  }, [isRoutineActive, routineInterval, executeRoutine, isHost]);

  // Effet pour récupérer le trajet routier en phase de convergence (calcul local pour tous)
  useEffect(() => {
    const updateRoute = async () => {
      if (gameDetails?.is_converging_phase && 
          currentPosition && 
          gameDetails.start_zone_rogue_latitude && 
          gameDetails.start_zone_rogue_longitude) {
        
        const startZone: [number, number] = [
          parseFloat(gameDetails.start_zone_rogue_latitude),
          parseFloat(gameDetails.start_zone_rogue_longitude)
        ];
        
        const route = await fetchRoute(currentPosition, startZone);
        setRoutePath(route);
      } else {
        setRoutePath([]);
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
      if (!isHost) {
        console.log(`📤 [WebRTC] Émission isInStartZone: ${isInStartZone}`);
      }
      updatePlayerInStartZone(currentPlayerId, isInStartZone);
    }
  }, [currentPosition, gameDetails?.start_zone_rogue_latitude, gameDetails?.start_zone_rogue_longitude, currentPlayerId, isHost]);

  // Vérifier en temps réel si un objectif est à portée (mise à jour locale)
  useEffect(() => {
    if (currentPosition && objectiveProps.length > 0) {
      const objectiveInRange = objectiveProps
        .filter(prop => prop.visible === true)
        .some(prop => {
          const distance = calculateDistanceToStartZone(
            currentPosition,
            prop.latitude || '0',
            prop.longitude || '0'
          );
          const detectionRadius = prop.detection_radius || 30;
          return distance <= detectionRadius;
        });
      
      setIsObjectiveInRange(objectiveInRange);
    } else {
      setIsObjectiveInRange(false);
    }
  }, [currentPosition, objectiveProps]);

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

export default Rogue;
