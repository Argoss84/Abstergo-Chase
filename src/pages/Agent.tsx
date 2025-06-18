import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonCard, IonCardHeader, IonCardTitle, IonFab, IonFabButton, IonFabList, IonIcon } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import GameService from '../services/GameService';
import { generateRandomPointInCircle } from '../utils/utils';
import { add, apertureOutline, camera, cellular, cellularOutline, colorFillOutline, colorFilterOutline, fitnessOutline, locateOutline, locationOutline, navigate, settings, skullOutline } from 'ionicons/icons';
import './Agent.css';

interface GameProp {
  id_prop: number;
  latitude: string;
  longitude: string;
  type: string;
  detection_radius: number;
}

interface GameDetails {
  code: string;
  map_radius: number;
  map_center_latitude: string;
  map_center_longitude: string;
  start_zone_latitude?: string;
  start_zone_longitude?: string;
  start_zone_rogue_latitude?: string;
  start_zone_rogue_longitude?: string;
  props?: GameProp[];
}

interface ObjectiveCircle {
  id_prop: number;
  center: [number, number];
  radius: number;
}

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
                [parseFloat(prop.latitude), parseFloat(prop.longitude)],
                prop.detection_radius
              ),
              radius: prop.detection_radius
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
          <div style={{ height: 'calc(100vh - 56px)', width: '100%', position: 'relative' }}>
            <MapContainer
              key={`map-${gameDetails.code}`}
              center={[parseFloat(gameDetails.map_center_latitude), parseFloat(gameDetails.map_center_longitude)]}
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
                center={[parseFloat(gameDetails.map_center_latitude), parseFloat(gameDetails.map_center_longitude)]}
                radius={gameDetails.map_radius}
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
            
            <IonFabButton color="light" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}>
              <IonIcon icon={cellularOutline} />
            </IonFabButton>
          </div>

          <div className={`fab-list fab-list-start ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton color="light" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}>
              <IonIcon icon={colorFilterOutline} />
            </IonFabButton>
            <IonFabButton color="light" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}>
              <IonIcon icon={fitnessOutline} />
            </IonFabButton>
          </div>

          <div className={`fab-list fab-list-end ${!isFabOpen ? 'fab-list-hidden' : ''}`}>
            <IonFabButton color="light" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}>
              <IonIcon icon={locateOutline} />
            </IonFabButton>
            <IonFabButton color="light" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}>
              <IonIcon icon={skullOutline} />
            </IonFabButton>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Agent; 