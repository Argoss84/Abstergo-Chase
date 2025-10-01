import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonLabel, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonModal } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMap, Polyline, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { toast } from 'react-toastify';
import GameService from '../services/GameService';
import { 
  generateRandomPointInCircle, 
  calculateDistanceToStartZone, 
  isPlayerInStartZone,
  fetchRoute
} from '../utils/utils';
import { 
  updatePlayerPosition,
  updatePlayerInStartZone,
  updateGameData,
  identifyCurrentPlayer
} from '../utils/PlayerUtils';
import { updateGameWinnerType } from '../utils/AdminUtils';
import { add, apertureOutline, camera, cellular, cellularOutline, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, radioOutline, settings, skullOutline } from 'ionicons/icons';
import './Rogue.css';
import { GameProp, GameDetails, ObjectiveCircle } from '../components/Interfaces';
import PopUpMarker from '../components/PopUpMarker';
import Compass from '../components/Compass';
import QRCode from '../components/QRCode';
import { useAuth } from '../contexts/AuthenticationContext';
import { getUserByAuthId } from '../services/UserServices';
import { useWakeLock } from '../utils/useWakeLock';
import { useVibration } from '../hooks/useVibration';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';

const ResizeMap = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, [map]);
  return null;
};

// Composant pour gérer la référence de la carte
const MapController = ({ onMapReady }: { onMapReady: (map: L.Map) => void }) => {
  const map = useMap();
  
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);
  
  return null;
};

const Rogue: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { session, appParams } = useAuth();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveProps, setObjectiveProps] = useState<GameProp[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  // États pour le compte à rebours
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // États pour la routine périodique
  const [routineInterval, setRoutineInterval] = useState<number>(2000); // Valeur par défaut
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(true);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<number | null>(null);
  const [objectivePropsInitialized, setObjectivePropsInitialized] = useState<boolean>(false);
  
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
  const { releaseWakeLock } = useWakeLock(true);

  // Hook pour la vibration
  const { vibrate, patterns } = useVibration();
  
  // État pour la modal du QR code
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  
  // Texte pour le QR code (email + code de partie)
  const [qrCodeText, setQrCodeText] = useState<string>('');

  // Fonction helper pour gérer les erreurs avec l'email de l'utilisateur
  const handleErrorWithUser = async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      userEmail: currentUser?.email || undefined
    });
    setError(errorResult.message);
    return errorResult;
  };

  // Effet pour configurer l'intervalle de routine basé sur le paramètre game_refresh_ms
  useEffect(() => {
    if (appParams) {
      const gameRefreshParam = appParams.find(param => param.param_name === 'game_refresh_ms');
      if (gameRefreshParam && gameRefreshParam.param_value) {
        const refreshMs = parseInt(gameRefreshParam.param_value);
        if (!isNaN(refreshMs) && refreshMs > 0) {
          setRoutineInterval(refreshMs);
          console.log(`🔄 Intervalle de routine configuré: ${refreshMs}ms`);
        }
      }
    }
  }, [appParams]);

  // Fonctions pour les boutons FAB
  const handleNetworkScan = () => {
    console.log('Scan réseau activé');
    toast.info('🔍 Scan réseau en cours...');
    vibrate(patterns.short);
  };

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
          // Fermer le toast et réinitialiser l'état à la fin de l'animation
          setTimeout(async () => {
            if (captureToastRef.current) {
              toast.dismiss(captureToastRef.current);
            }
            
            try {
              // Mettre à jour l'objectif capturé
              const gameService = new GameService();
              await gameService.updateProp(objectiveInRange.id_prop.toString(), {
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
            } catch (error) {
              console.error('❌ Erreur lors de la capture de l\'objectif:', error);
              toast.error('❌ Erreur lors de la capture de l\'objectif');
            }
            
            setIsCaptureInProgress(false);
            captureToastRef.current = null;
          }, hackDuration);
        }
      }
    } else {
      toast.warning('❌ Aucun objectif à portée');
    }
    vibrate(patterns.short);
  };

  useEffect(() => {
    const fetchGameDetails = async () => {
      try {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        
        if (!code) {
          await handleErrorWithUser('Code de partie non trouvé', null, ERROR_CONTEXTS.VALIDATION);
          return;
        }

        // Récupérer l'utilisateur connecté
        if (session?.user) {
          const user = await getUserByAuthId(session.user.id);
          if (user) {
            setCurrentUser(user);
            console.log(`Utilisateur connecté: ${user.email} (ID: ${user.id})`);
            
            // Générer le texte pour le QR code (email + code de partie)
            const qrText = `${user.email};${code}`;
            setQrCodeText(qrText);
            console.log(`QR Code généré: ${qrText}`);
            
            // Récupérer les données de la partie après avoir obtenu l'utilisateur
            const gameService = new GameService();
            const game = await gameService.getGameDatasByCode(code);
            
            if (game && game[0]) {
              setGameDetails(game[0]);
              
              // Récupérer l'ID du joueur actuel en utilisant l'utilisateur connecté
              if (game[0].players) {
                const currentPlayer = identifyCurrentPlayer(game[0].players, user.id);
                if (currentPlayer) {
                  setCurrentPlayerId(currentPlayer.id_player);
                }
              }
              
              // Récupérer les props d'objectifs
              if (game[0].props) {
                setObjectiveProps(game[0].props);
                setObjectivePropsInitialized(true);
                console.log(`${game[0].props.length} objectifs initialisés`);
              }
            } else {
              await handleErrorWithUser('Partie non trouvée', null, ERROR_CONTEXTS.DATABASE);
            }
          } else {
            await handleErrorWithUser('Utilisateur non trouvé', null, ERROR_CONTEXTS.AUTHENTICATION);
            return;
          }
        } else {
          await handleErrorWithUser('Utilisateur non connecté', null, ERROR_CONTEXTS.AUTHENTICATION);
          return;
        }
      } catch (err) {
        await handleErrorWithUser('Erreur lors du chargement de la partie', err, ERROR_CONTEXTS.DATABASE);
      }
    };

    if (session?.user) {
      fetchGameDetails();
    }
  }, [location.search, session]);

  // Handler pour la fin de partie
  const handleGameEnd = async () => {
    console.log('⏰ TEMPS ÉCOULÉ - Fin de la partie !');
    
    // Arrêter le compte à rebours
    setIsCountdownActive(false);
    setCountdown(0);
        
    let isCurrentPlayerAdmin = false;
    
    if (currentPlayerId) {
      // Méthode 1: Chercher par currentPlayerId
      const playerById = gameDetails?.players?.find(
        player => player.id_player === currentPlayerId
      );
      isCurrentPlayerAdmin = playerById?.is_admin || false;
    } else if (currentUser) {
      // Méthode 2: Chercher par user_id si currentPlayerId n'est pas disponible
      const playerByUserId = gameDetails?.players?.find(
        player => player.user_id === currentUser.id
      );
      isCurrentPlayerAdmin = playerByUserId?.is_admin || false;
    }
    if (isCurrentPlayerAdmin) {
      console.log('👑 ADMIN - Fin de partie détectée');
      
      // Mettre à jour le winner_type à "ROGUE" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
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
          handleError("Erreur lors de la récupération de la position", error, {
            context: ERROR_CONTEXTS.NETWORK,
            userEmail: currentUser?.email || undefined,
            shouldShowError: false
          });
        }
      );

      // Watch position changes
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          handleError("Erreur lors de la surveillance de la position", error, {
            context: ERROR_CONTEXTS.NETWORK,
            userEmail: currentUser?.email || undefined,
            shouldShowError: false
          });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  // Effet pour gérer le compte à rebours
  useEffect(() => {
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
  }, [isCountdownActive, countdown]);

  // Effet pour initialiser le compte à rebours quand la partie démarre
  useEffect(() => {
    if (gameDetails?.started && gameDetails?.duration && !isCountdownActive) {
      console.log('🚀 Partie démarrée - Initialisation du compte à rebours');
      const totalSeconds = gameDetails.duration * 60; // Convertir les minutes en secondes
      setCountdown(totalSeconds);
      setIsCountdownActive(true);
    }
  }, [gameDetails?.started, gameDetails?.duration, isCountdownActive]);

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
    
    // 2. Mettre à jour les données de la partie
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code) {
      const updatedGame = await updateGameData(code);
      if (updatedGame) {
        setGameDetails(updatedGame);
      }
    }
    
    // 3. Vérifier l'état de la partie
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
    
     }, [currentPosition, gameDetails, objectiveProps, routineExecutionCount, currentPlayerId, location.search]);



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

  // Effet pour récupérer le trajet routier en phase de convergence
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

  // Effet pour réinitialiser la distance quand on n'est plus en phase de convergence
  useEffect(() => {
    if (!gameDetails?.is_converging_phase) {
      setDistanceToStartZone(null);
    }
  }, [gameDetails?.is_converging_phase]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Rogue</IonTitle>
          {countdown !== null && isCountdownActive ? (
            <IonLabel slot="primary" className="duration-display countdown-active">
              ⏰ {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
            </IonLabel>
          ) : gameDetails?.duration ? (
            <IonLabel slot="primary" className="duration-display">
              ⏱️ {Math.floor(gameDetails.duration)}:{(Math.round((gameDetails.duration % 1) * 60)).toString().padStart(2, '0')}
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
              {objectiveProps
                .filter(prop => prop.visible === true)
                .map((prop) => (
                  <PopUpMarker
                    key={prop.id_prop}
                    position={[parseFloat(prop.latitude || '0'), parseFloat(prop.longitude || '0')]}
                    type="objective"
                    data={prop}
                    id={prop.id_prop}
                  />
                ))}
               
               {/* Affichage du trajet vers la zone de départ en phase de convergence */}
               {gameDetails.is_converging_phase && 
                currentPosition && 
                gameDetails.start_zone_rogue_latitude && 
                gameDetails.start_zone_rogue_longitude && 
                routePath.length > 0 && (
                 <Polyline
                   positions={routePath}
                   pathOptions={{
                     color: '#00ff41',
                     weight: 4,
                     opacity: 0.9,
                     dashArray: '10, 5',
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
                  />
                )}
            </MapContainer>
          </div>
        ) : (
          <p>Chargement des détails de la partie...</p>
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
              ...objectiveProps
                .filter(prop => prop.visible === true)
                .map((prop, index) => ({
                  latitude: parseFloat(prop.latitude || '0'),
                  longitude: parseFloat(prop.longitude || '0'),
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
          
          <div className={`fab-list fab-list-top ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton color="light" onClick={handleNetworkScan}>
              <IonIcon icon={cellularOutline} />
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
                    {currentUser?.email}
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