import {
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonPage,
    IonTitle,
    IonToolbar,
    IonText,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonModal,
    IonButtons,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import GameService from '../services/GameService';
import { MapContainer, TileLayer, Circle, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

interface GameDetails {
  code: string;
  objectif_number: number;
  duration: number;
  victory_condition_nb_objectivs: number;
  hack_duration_ms: number;
  objectiv_zone_radius: number;
  rogue_range: number;
  agent_range: number;
  map_radius: number;
  map_center_latitude: string;
  map_center_longitude: string;
  start_zone_latitude?: string;
  start_zone_longitude?: string;
  start_zone_rogue_latitude?: string;
  start_zone_rogue_longitude?: string;
  id_game: number;
  props?: GameProp[];
}

interface GameProp {
  id_prop: number;
  latitude: string;
  longitude: string;
  type: string;
}

const Lobby: React.FC = () => {
  const location = useLocation();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [objectives, setObjectives] = useState<GameProp[]>([]);
  const [streets, setStreets] = useState<L.LatLngTuple[][]>([]);
  const [mapKey, setMapKey] = useState(0);

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
          setObjectives(game[0].props || []);
          
          // Fetch streets
          if (game[0].map_center_latitude && game[0].map_center_longitude) {
            const overpassUrl = `https://overpass-api.de/api/interpreter?data=
              [out:json];
              (
                way(around:${game[0].map_radius},${game[0].map_center_latitude},${game[0].map_center_longitude})["highway"]["foot"!~"no"];
                way(around:${game[0].map_radius},${game[0].map_center_latitude},${game[0].map_center_longitude})["amenity"="square"]["foot"!~"no"];
              );
              (._;>;);
              out;`;

            const response = await fetch(overpassUrl);
            const data = await response.json();
            const ways = data.elements.filter((el: any) => el.type === "way");
            const nodes = data.elements.filter((el: any) => el.type === "node");
            const nodeMap = new Map(
              nodes.map((node: any) => [node.id, [node.lat, node.lon]])
            );
            const streetLines = ways.map((way: any) =>
              way.nodes.map((nodeId: any) => nodeMap.get(nodeId))
            );
            setStreets(streetLines);
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

  return (
    <IonPage id="Lobby-page">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Lobby</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        {error ? (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        ) : gameDetails ? (
          <>
            <div style={{ height: '300px', width: '100%', marginBottom: '1rem' }}>
              <MapContainer
                key={mapKey}
                center={[parseFloat(gameDetails.map_center_latitude), parseFloat(gameDetails.map_center_longitude)]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <Circle
                  center={[parseFloat(gameDetails.map_center_latitude), parseFloat(gameDetails.map_center_longitude)]}
                  radius={gameDetails.map_radius}
                  pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                />
                {objectives.map((objective) => (
                  <Marker
                    key={objective.id_prop}
                    position={[parseFloat(objective.latitude), parseFloat(objective.longitude)]}
                    icon={L.divIcon({
                      className: 'custom-div-icon',
                      html: `<div style="background-color: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
                  />
                ))}
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
                {streets.map((street, index) => (
                  <Polyline
                    key={index}
                    positions={street}
                    pathOptions={{ color: 'gray', weight: 2 }}
                  />
                ))}
              </MapContainer>
            </div>

            <IonButton 
              expand="block" 
              onClick={() => setIsModalOpen(true)}
              className="ion-margin-bottom"
            >
              Détails Partie
            </IonButton>

            <IonModal isOpen={isModalOpen} onDidDismiss={() => setIsModalOpen(false)}>
              <IonHeader>
                <IonToolbar>
                  <IonTitle>Paramètres de la partie</IonTitle>
                  <IonButtons slot="end">
                    <IonButton onClick={() => setIsModalOpen(false)}>Fermer</IonButton>
                  </IonButtons>
                </IonToolbar>
              </IonHeader>
              <IonContent className="ion-padding">
                <IonList>
                  <IonItem>
                    <IonLabel>
                      <h2>Code de la partie</h2>
                      <p style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '2px' }}>
                        {gameDetails.code}
                      </p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Nombre d'objectifs</h2>
                      <p>{gameDetails.objectif_number}</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Durée</h2>
                      <p>{gameDetails.duration} minutes</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Objectifs pour la victoire</h2>
                      <p>{gameDetails.victory_condition_nb_objectivs}</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Durée du hack</h2>
                      <p>{gameDetails.hack_duration_ms / 1000} secondes</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Rayon de la zone d'objectif</h2>
                      <p>{gameDetails.objectiv_zone_radius} mètres</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Portée des Rogues</h2>
                      <p>{gameDetails.rogue_range} mètres</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Portée des Agents</h2>
                      <p>{gameDetails.agent_range} mètres</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Rayon de la zone de jeu</h2>
                      <p>{gameDetails.map_radius} mètres</p>
                    </IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h2>Centre de la zone de jeu</h2>
                      <p>Latitude: {gameDetails.map_center_latitude}</p>
                      <p>Longitude: {gameDetails.map_center_longitude}</p>
                    </IonLabel>
                  </IonItem>
                </IonList>
              </IonContent>
            </IonModal>
          </>
        ) : (
          <IonText>
            <p>Chargement des détails de la partie...</p>
          </IonText>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Lobby;
  