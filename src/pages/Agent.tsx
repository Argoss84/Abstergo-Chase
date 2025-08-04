import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonModal, IonButtons, IonLabel } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMap, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { QrReader } from 'react-qr-reader';
import { toast } from 'react-toastify';
import GameService from '../services/GameService';
import { 
  generateRandomPointInCircle, 
  fetchRoute, 
  calculateDistanceToStartZone, 
  isPlayerInStartZone 
} from '../utils/utils';
import {
  updatePlayerPosition,
  updatePlayerInStartZone,
  updateGameData,
  identifyCurrentPlayer
} from '../utils/PlayerUtils';
import { updateGameWinnerType } from '../utils/AdminUtils';
import { add, apertureOutline, camera, cellular, cellularOutline, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, settings, skullOutline } from 'ionicons/icons';
import './Agent.css';
import { GameProp, GameDetails, ObjectiveCircle } from '../components/Interfaces';
import PopUpMarker from '../components/PopUpMarker';
import { useAuth } from '../contexts/AuthenticationContext';
import { getUserByAuthId } from '../services/UserServices';
import { useWakeLock } from '../utils/useWakeLock';

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



const Agent: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { session, userEmail } = useAuth();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveCircles, setObjectiveCircles] = useState<ObjectiveCircle[]>([]);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [scannedQRCode, setScannedQRCode] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [distanceToStartZone, setDistanceToStartZone] = useState<number | null>(null);
  
  // États pour la routine périodique
  const [routineInterval, setRoutineInterval] = useState<number>(2000); // 5 secondes par défaut
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(true);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [objectiveCirclesInitialized, setObjectiveCirclesInitialized] = useState<boolean>(false);
  
  // États pour le compte à rebours
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Référence pour la carte
  const mapRef = useRef<L.Map | null>(null);
  
  // Logo du joueur (choisi aléatoirement parmi les 6 disponibles)
  const [playerLogo, setPlayerLogo] = useState<string>('joueur_1.png');

  // Wake Lock pour empêcher l'écran de se mettre en veille
  const { releaseWakeLock } = useWakeLock(true);

  // Fonctions pour les boutons FAB
  const handleNetworkScan = () => {
    console.log('Scan réseau activé');
    // Ici vous pouvez ajouter la logique pour scanner le réseau
    toast.info('🔍 Scan réseau en cours...');
  };

  const handleVisionMode = () => {
    console.log('Mode vision activé');
    // Ici vous pouvez ajouter la logique pour changer le mode de vision
    toast.success('👁️ Mode vision activé');
  };

  const handleHealthCheck = () => {
    console.log('Vérification de santé activée');
    // Ici vous pouvez ajouter la logique pour vérifier la santé
    toast.warning('💊 Vérification de santé en cours...');
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
  };

  const handleThreatDetection = async () => {
    console.log('Scanner QR Code activé');
    
    // Vérifier si la caméra est disponible
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      if (videoDevices.length === 0) {
        setCameraError('Aucune caméra détectée sur cet appareil');
        setIsQRModalOpen(true);
        return;
      }
      
      // Vérifier les permissions de caméra
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop()); // Arrêter le stream de test
      
      setCameraError(null);
      setIsQRModalOpen(true);
    } catch (error) {
      console.error('Erreur d\'accès à la caméra:', error);
      setCameraError('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
      setIsQRModalOpen(true);
    }
  };

  const handleQRCodeScanned = (result: string) => {
    setScannedQRCode(result);
    console.log('QR Code scanné:', result);
    // Ici vous pouvez ajouter la logique pour traiter le QR code scanné
    toast.success(`🎯 QR Code détecté: ${result}`);
    setIsQRModalOpen(false);
  };

  const closeQRModal = () => {
    setIsQRModalOpen(false);
    setScannedQRCode(null);
    setCameraError(null);
  };

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
      
      // Mettre à jour le winner_type à "AGENT" car le temps est écoulé
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      if (code) {
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
    
    // 6. Gestion du compte à rebours
    if (gameDetails?.started && gameDetails?.duration && !isCountdownActive) {
      const totalSeconds = gameDetails.duration * 60; // Convertir les minutes en secondes
      setCountdown(totalSeconds);
      setIsCountdownActive(true);
    }
    
    // Console.log unifié avec toutes les informations de la routine
    console.log(`🔄 Routine #${routineExecutionCount} | État: ${gameState} | Position: ${positionInfo} | Distance: ${distanceToStart ? distanceToStart.toFixed(0) + 'm' : 'N/A'} | Zone départ: ${isInStartZone ? 'OUI' : 'NON'}`);
    
  }, [currentPosition, gameDetails, objectiveCircles, routineExecutionCount, currentPlayerId, location.search, isCountdownActive]);





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
        
        if (!code) {
          setError('Code de partie non trouvé');
          return;
        }

        // Récupérer l'utilisateur connecté
        if (session?.user) {
          const user = await getUserByAuthId(session.user.id);
          if (user) {
            setCurrentUser(user);
            console.log(`Utilisateur connecté: ${user.email} (ID: ${user.id})`);
          } else {
            setError('Utilisateur non trouvé');
            return;
          }
        } else {
          setError('Utilisateur non connecté');
          return;
        }

        const gameService = new GameService();
        const game = await gameService.getGameDatasByCode(code);
        
        if (game && game[0]) {
          setGameDetails(game[0]);
          
          // Récupérer l'ID du joueur actuel en utilisant l'utilisateur connecté
          if (game[0].players && currentUser) {
            const currentPlayer = identifyCurrentPlayer(game[0].players, currentUser.id);
            if (currentPlayer) {
              setCurrentPlayerId(currentPlayer.id_player);
              
            }
          }
          
          // Générer les cercles d'objectifs
          if (game[0].props) {
            const circles = game[0].props.map((prop: GameProp) => ({
              id_prop: prop.id_prop,
              center: generateRandomPointInCircle(
                [parseFloat(prop.latitude || '0'), parseFloat(prop.longitude || '0')],
                prop.detection_radius || 0
              ),
              radius: prop.detection_radius || 0
            }));
            setObjectiveCircles(circles);
            setObjectiveCirclesInitialized(true);
            console.log(`${circles.length} cercles d'objectifs initialisés`);
          }
        } else {
          setError('Partie non trouvée');
        }
      } catch (err) {
        console.error('Error fetching game details:', err);
        setError('Erreur lors du chargement de la partie');
      }
    };

    if (session?.user) {
      fetchGameDetails();
    }
  }, [location.search, session]);

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
          console.error("Error getting location:", error);
        }
      );

      // Watch position changes
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentPosition([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.error("Error watching location:", error);
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

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Agent</IonTitle>
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
              {objectiveCircles.map((circle) => (
                <Circle
                  key={circle.id_prop}
                  center={circle.center}
                  radius={circle.radius}
                  pathOptions={{ color: 'purple', fillColor: 'purple', fillOpacity: 0.2 }}
                />
              ))}
              {currentPosition && (
                <PopUpMarker
                  position={currentPosition}
                  type="player"
                  playerLogo={playerLogo}
                  id="player-position"
                />
              )}
              
              {/* Affichage du trajet vers la zone de départ en phase de convergence */}
              {gameDetails.is_converging_phase && 
               currentPosition && 
               gameDetails.start_zone_latitude && 
               gameDetails.start_zone_longitude && 
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
            </MapContainer>
          </div>
        ) : (
          <p>Chargement des détails de la partie...</p>
        )}
                 <IonButton expand="block" onClick={() => history.push('/end-game')}>
           EndGame
         </IonButton>



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
            <IonFabButton color="light" onClick={handleThreatDetection}>
              <IonIcon icon={skullOutline} />
            </IonFabButton>
          </div>
        </div>

        {/* Modal QR Code Scanner */}
        <IonModal isOpen={isQRModalOpen} onDidDismiss={closeQRModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Scanner QR Code</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={closeQRModal}>Fermer</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="qr-modal-content">
              {cameraError ? (
                // Affichage de l'erreur de caméra
                <div className="qr-error-container">
                  <div className="qr-error-content">
                    <div className="qr-error-icon">📷</div>
                    <strong>Erreur Caméra</strong><br/>
                    {cameraError}
                  </div>
                </div>
              ) : (
                // Scanner QR normal
                <div className="qr-scanner-container">
                  <div className="qr-scanner-wrapper">
                    <QrReader
                      constraints={{ facingMode: 'environment' }}
                      onResult={(result: any, error: any) => {
                        if (error) {
                          return;
                        }
                        if (result) {
                          handleQRCodeScanned(result?.text);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
              
              <p>{cameraError ? 'Impossible d\'accéder au scanner QR' : 'Placez le QR code dans la zone de scan'}</p>
              
              <IonButton 
                expand="block" 
                onClick={closeQRModal}
                className="qr-modal-button"
                color="medium"
              >
                {cameraError ? 'Fermer' : 'Annuler'}
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Agent; 