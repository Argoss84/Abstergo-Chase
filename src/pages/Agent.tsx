import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon, IonModal, IonButtons } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMap, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { QrReader } from 'react-qr-reader';
import GameService from '../services/GameService';
import { generateRandomPointInCircle } from '../utils/utils';
import { add, apertureOutline, camera, cellular, cellularOutline, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, settings, skullOutline } from 'ionicons/icons';
import './Agent.css';
import { GameProp, GameDetails, ObjectiveCircle } from '../components/Interfaces';

const ResizeMap = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, [map]);
  return null;
};

const Agent: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objectiveCircles, setObjectiveCircles] = useState<ObjectiveCircle[]>([]);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [scannedQRCode, setScannedQRCode] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  
  // États pour la routine périodique
  const [routineInterval, setRoutineInterval] = useState<number>(2000); // 5 secondes par défaut
  const [isRoutineActive, setIsRoutineActive] = useState<boolean>(true);
  const [routineExecutionCount, setRoutineExecutionCount] = useState<number>(0);
  const routineIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fonctions pour les boutons FAB
  const handleNetworkScan = () => {
    console.log('Scan réseau activé');
    // Ici vous pouvez ajouter la logique pour scanner le réseau
    alert('Scan réseau en cours...');
  };

  const handleVisionMode = () => {
    console.log('Mode vision activé');
    // Ici vous pouvez ajouter la logique pour changer le mode de vision
    alert('Mode vision activé');
  };

  const handleHealthCheck = () => {
    console.log('Vérification de santé activée');
    // Ici vous pouvez ajouter la logique pour vérifier la santé
    alert('Vérification de santé en cours...');
  };

  const handleLocationTracker = () => {
    console.log('Traceur de localisation activé');
    // Ici vous pouvez ajouter la logique pour tracer la localisation
    if (currentPosition) {
      alert(`Position actuelle: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
    } else {
      alert('Position non disponible');
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
    alert(`QR Code détecté: ${result}`);
    setIsQRModalOpen(false);
  };

  const closeQRModal = () => {
    setIsQRModalOpen(false);
    setScannedQRCode(null);
    setCameraError(null);
  };

  // Fonction pour récupérer le trajet routier
  const fetchRoute = async (start: [number, number], end: [number, number]) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.routes && data.routes[0]) {
        const coordinates = data.routes[0].geometry.coordinates;
        // Convertir les coordonnées [lng, lat] en [lat, lng] pour Leaflet
        const routePath = coordinates.map((coord: [number, number]) => [coord[1], coord[0]]);
        setRoutePath(routePath);
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du trajet:', error);
      // En cas d'erreur, utiliser une ligne droite
      setRoutePath([start, end]);
    }
  };

  // Fonction de routine périodique
  const executeRoutine = useCallback(() => {
    console.log(`Routine exécutée #${routineExecutionCount + 1} à ${new Date().toLocaleTimeString()}`);
    
    // Incrémenter le compteur d'exécutions
    setRoutineExecutionCount(prev => prev + 1);
    
    // Exemple de tâches que la routine peut effectuer :
    // 1. Vérifier la position actuelle
    if (currentPosition) {
      console.log(`Position actuelle: ${currentPosition[0].toFixed(6)}, ${currentPosition[1].toFixed(6)}`);
    }
    
    // 2. Vérifier l'état de la partie
    if (gameDetails) {
      console.log(`État de la partie: ${gameDetails.is_converging_phase ? 'Phase de convergence' : 'Phase normale'}`);
    }
    
    // 3. Vérifier la distance vers les objectifs
    if (currentPosition && objectiveCircles.length > 0) {
      objectiveCircles.forEach((circle, index) => {
        const distance = Math.sqrt(
          Math.pow(currentPosition[0] - circle.center[0], 2) + 
          Math.pow(currentPosition[1] - circle.center[1], 2)
        ) * 111000; // Conversion approximative en mètres
        console.log(`Distance vers objectif ${index + 1}: ${distance.toFixed(0)}m`);
      });
    }
    
    // 4. Mettre à jour le trajet si nécessaire (en phase de convergence)
    if (gameDetails?.is_converging_phase && 
        currentPosition && 
        gameDetails.start_zone_latitude && 
        gameDetails.start_zone_longitude) {
      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_latitude),
        parseFloat(gameDetails.start_zone_longitude)
      ];
      fetchRoute(currentPosition, startZone);
    }
    
    // Ici vous pouvez ajouter d'autres tâches spécifiques à votre jeu
    // Par exemple : vérifier les communications, synchroniser avec le serveur, etc.
  }, [currentPosition, gameDetails, objectiveCircles, routineExecutionCount]);

  // Gestionnaire pour démarrer/arrêter la routine
  const toggleRoutine = () => {
    setIsRoutineActive(prev => !prev);
  };

  // Gestionnaire pour changer l'intervalle
  const changeRoutineInterval = (newInterval: number) => {
    setRoutineInterval(newInterval);
  };

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
      
      console.log(`Routine démarrée avec un intervalle de ${routineInterval}ms`);
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

        const gameService = new GameService();
        const game = await gameService.getGameWithPropsByCode(code);
        
        if (game && game[0]) {
          setGameDetails(game[0]);
          
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
          }
        } else {
          setError('Partie non trouvée');
        }
      } catch (err) {
        console.error('Error fetching game details:', err);
        setError('Erreur lors du chargement de la partie');
      }
    };

    fetchGameDetails();
  }, [location.search]);

  useEffect(() => {
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
    if (gameDetails?.is_converging_phase && 
        currentPosition && 
        gameDetails.start_zone_latitude && 
        gameDetails.start_zone_longitude) {
      
      const startZone: [number, number] = [
        parseFloat(gameDetails.start_zone_latitude),
        parseFloat(gameDetails.start_zone_longitude)
      ];
      
      fetchRoute(currentPosition, startZone);
    } else {
      setRoutePath([]);
    }
  }, [gameDetails?.is_converging_phase, currentPosition, gameDetails?.start_zone_latitude, gameDetails?.start_zone_longitude]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Agent</IonTitle>
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
              style={{ height: '100%', width: '100%' }}
              whenReady={() => {
                // Force a resize after the map is ready
                setTimeout(() => {
                  const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
                  if (mapElement) {
                    mapElement.style.height = '100%';
                  }
                }, 100);
              }}
            >
              <ResizeMap />
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
                  <Marker
                    position={[parseFloat(gameDetails.start_zone_latitude), parseFloat(gameDetails.start_zone_longitude)]}
                    icon={L.divIcon({
                      className: 'custom-div-icon',
                      html: `<div style="background-color: blue; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
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
                  <Marker
                    position={[parseFloat(gameDetails.start_zone_rogue_latitude), parseFloat(gameDetails.start_zone_rogue_longitude)]}
                    icon={L.divIcon({
                      className: 'custom-div-icon',
                      html: `<div style="background-color: green; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
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
                <Marker
                  position={currentPosition}
                  icon={L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background-color: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10],
                  })}
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

        {/* Contrôles de la routine périodique */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Routine Périodique</IonCardTitle>
          </IonCardHeader>
          <IonContent className="ion-padding">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span>Intervalle: {routineInterval}ms</span>
              <IonButton 
                size="small" 
                onClick={() => changeRoutineInterval(1000)}
                color={routineInterval === 1000 ? 'primary' : 'medium'}
              >
                1s
              </IonButton>
              <IonButton 
                size="small" 
                onClick={() => changeRoutineInterval(5000)}
                color={routineInterval === 5000 ? 'primary' : 'medium'}
              >
                5s
              </IonButton>
              <IonButton 
                size="small" 
                onClick={() => changeRoutineInterval(10000)}
                color={routineInterval === 10000 ? 'primary' : 'medium'}
              >
                10s
              </IonButton>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span>Statut: {isRoutineActive ? '🟢 Actif' : '🔴 Inactif'}</span>
              <IonButton 
                size="small" 
                onClick={toggleRoutine}
                color={isRoutineActive ? 'danger' : 'success'}
              >
                {isRoutineActive ? 'Arrêter' : 'Démarrer'}
              </IonButton>
            </div>
            
            <div style={{ fontSize: '0.9em', color: '#666' }}>
              Exécutions: {routineExecutionCount} | 
              Dernière exécution: {routineExecutionCount > 0 ? new Date().toLocaleTimeString() : 'Aucune'}
            </div>
          </IonContent>
        </IonCard>

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