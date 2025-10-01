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
    IonBackButton,
    IonButtons,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonList,
    IonText,
    IonToast,
    IonModal,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import GameService from '../services/GameService';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, Circle, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { generateRandomPoints, generateStartZone, generateStartZoneRogue } from '../utils/utils';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';

interface GameFormData {
  objectif_number: number;
  duration: number;
  victory_condition_nb_objectivs: number;
  hack_duration_ms: number;
  objectiv_zone_radius: number;
  rogue_range: number;
  agent_range: number;
  map_center_latitude: string;
  map_center_longitude: string;
  map_radius: number;
}

interface Objective {
  position: [number, number];
  id: number;
}

interface StartZones {
  agent: [number, number] | null;
  rogue: [number, number] | null;
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

const CreateLobby: React.FC = () => {
  const history = useHistory();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<[number, number] | null>(null);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [streets, setStreets] = useState<L.LatLngTuple[][]>([]);
  const [mapKey, setMapKey] = useState(0);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [startZones, setStartZones] = useState<StartZones>({ agent: null, rogue: null });
  const [formData, setFormData] = useState<GameFormData>({
    objectif_number: 3,
    duration: 900,
    victory_condition_nb_objectivs: 2,
    hack_duration_ms: 10000,
    objectiv_zone_radius: 300,
    rogue_range: 50,
    agent_range: 50,
    map_center_latitude: '',
    map_center_longitude: '',
    map_radius: 500,
  });

  const [isLoading, setIsLoading] = useState(false);

  // Fonction helper pour gérer les erreurs
  const handleErrorWithContext = async (errorMessage: string, error?: any, context?: string) => {
    await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      shouldShowError: false // Ne pas afficher l'erreur à l'utilisateur dans ce composant
    });
  };

  const handleInputChange = (field: keyof GameFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const fetchStreets = async (lat: number, lng: number) => {
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=
                          [out:json];
                          (
                            way(around:${formData.map_radius},${lat},${lng})["highway"]["foot"!~"no"];
                            way(around:${formData.map_radius},${lat},${lng})["amenity"="square"]["foot"!~"no"];
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
  };

  const handleGenerateObjectives = async () => {
    if (!selectedPosition) {
      return;
    }

    try {
      const randomPoints = generateRandomPoints(
        selectedPosition,
        formData.map_radius,
        formData.objectif_number,
        streets
      );

      const newObjectives = randomPoints.map((position, index) => ({
        position,
        id: index + 1
      }));

      // Generate start zones
      const agentStartZone = generateStartZone(
        selectedPosition,
        formData.map_radius,
        randomPoints,
        streets
      );

      const rogueStartZone = generateStartZoneRogue(
        selectedPosition,
        formData.map_radius,
        agentStartZone,
        randomPoints,
        streets
      );

      setObjectives(newObjectives);
      setStartZones({
        agent: agentStartZone,
        rogue: rogueStartZone
      });
    } catch (error) {
      await handleErrorWithContext('Erreur lors de la génération des objectifs', error, ERROR_CONTEXTS.VALIDATION);
      // You might want to show a toast or some user feedback here
    }
  };

  const handleSubmit = async () => {
    try {
      setIsLoading(true);
      const gameService = new GameService();
      
      // Generate a random 8-letter code
      const code = Array.from({ length: 8 }, () => 
        String.fromCharCode(65 + Math.floor(Math.random() * 26))
      ).join('');

      const gameData = {
        ...formData,
        code,
        created_at: new Date().toISOString(),
        map_center_latitude: selectedPosition ? selectedPosition[0].toString() : '',
        map_center_longitude: selectedPosition ? selectedPosition[1].toString() : '',
        start_zone_latitude: startZones.agent ? startZones.agent[0].toString() : null,
        start_zone_longitude: startZones.agent ? startZones.agent[1].toString() : null,
        start_zone_rogue_latitude: startZones.rogue ? startZones.rogue[0].toString() : null,
        start_zone_rogue_longitude: startZones.rogue ? startZones.rogue[1].toString() : null
      };

      const createdGame = await gameService.createGame(gameData);
      
      if (createdGame && createdGame[0]) {
        // Create props for each objective
        const propsData = objectives.map(obj => ({
          id_game: createdGame[0].id_game,
          latitude: obj.position[0].toString(),
          longitude: obj.position[1].toString(),
          type: 'OBJECTIV',
          created_at: new Date().toISOString()
        }));

        await gameService.createProps(propsData);

        // Navigate to the lobby with the game code
        history.push(`/lobby?code=${code}`);
      }
    } catch (error) {
      await handleErrorWithContext('Erreur lors de la création de la partie', error, ERROR_CONTEXTS.DATABASE);
    } finally {
      setIsLoading(false);
    }
  };

  // Component to handle map clicks
  const MapEvents = () => {
    useMapEvents({
      click: (e) => {
        setSelectedPosition([e.latlng.lat, e.latlng.lng]);
        setObjectives([]); // Clear objectives when center changes
      },
    });
    return null;
  };

  useEffect(() => {
    console.log('Attempting to get user location...');
    // Get user's current position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('Got user position:', position.coords.latitude, position.coords.longitude);
          const newPosition: [number, number] = [position.coords.latitude, position.coords.longitude];
          setUserPosition(newPosition);
          setMapKey(prev => prev + 1); // Force map re-render
          // Also update the form data with the initial position
          setFormData(prev => ({
            ...prev,
            map_center_latitude: newPosition[0].toString(),
            map_center_longitude: newPosition[1].toString()
          }));
        },
        (error) => {
          handleError('Erreur lors de la récupération de la position', error, {
            context: ERROR_CONTEXTS.NETWORK,
            shouldShowError: false
          });
          // Fallback to Paris coordinates if geolocation fails
          const fallbackPosition: [number, number] = [48.8566, 2.3522];
          setUserPosition(fallbackPosition);
          setMapKey(prev => prev + 1);
          setFormData(prev => ({
            ...prev,
            map_center_latitude: fallbackPosition[0].toString(),
            map_center_longitude: fallbackPosition[1].toString()
          }));
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        }
      );
    } else {
      console.log('Geolocation not supported');
      // Fallback to Paris coordinates if geolocation is not supported
      const fallbackPosition: [number, number] = [48.8566, 2.3522];
      setUserPosition(fallbackPosition);
      setMapKey(prev => prev + 1);
      setFormData(prev => ({
        ...prev,
        map_center_latitude: fallbackPosition[0].toString(),
        map_center_longitude: fallbackPosition[1].toString()
      }));
    }
  }, []);

  useEffect(() => {
    if (selectedPosition) {
      fetchStreets(selectedPosition[0], selectedPosition[1]);
    }
  }, [selectedPosition]);

  return (
    <IonPage id="CreateLobby-page">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" />
          </IonButtons>
          <IonTitle>Créer une partie</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              Créer une nouvelle partie
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div style={{ height: '300px', width: '100%', marginBottom: '1rem' }}>
              {userPosition && (
                <MapContainer
                  key={mapKey}
                  center={userPosition}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                >
                  <ResizeMap />
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <MapEvents />
                  {selectedPosition && (
                    <>
                      <Marker position={selectedPosition} />
                      <Circle
                        center={selectedPosition}
                        radius={formData.map_radius}
                        pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                      />
                    </>
                  )}
                  {objectives.map((objective) => (
                    <Marker
                      key={objective.id}
                      position={objective.position}
                      icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style="background-color: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10],
                      })}
                    />
                  ))}
                  {startZones.agent && (
                    <>
                      <Marker
                        position={startZones.agent}
                        icon={L.divIcon({
                          className: 'custom-div-icon',
                          html: `<div style="background-color: blue; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                          iconSize: [20, 20],
                          iconAnchor: [10, 10],
                        })}
                      />
                      <Circle
                        center={startZones.agent}
                        radius={50}
                        pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                      />
                    </>
                  )}
                  {startZones.rogue && (
                    <>
                      <Marker
                        position={startZones.rogue}
                        icon={L.divIcon({
                          className: 'custom-div-icon',
                          html: `<div style="background-color: green; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                          iconSize: [20, 20],
                          iconAnchor: [10, 10],
                        })}
                      />
                      <Circle
                        center={startZones.rogue}
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
              )}
            </div>

            <IonButton 
              expand="block" 
              onClick={() => setIsModalOpen(true)}
              className="ion-margin-bottom"
            >
              Détails Partie
            </IonButton>

            <IonButton 
              expand="block" 
              className="ion-margin-bottom"
              onClick={handleGenerateObjectives}
              disabled={!selectedPosition}
            >
              Générer les objectifs
            </IonButton>

            <IonButton 
              expand="block" 
              onClick={handleSubmit} 
              disabled={isLoading || !selectedPosition || objectives.length === 0}
            >
              {isLoading ? 'Création en cours...' : 'Créer la partie'}
            </IonButton>
          </IonCardContent>
        </IonCard>

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
                <IonLabel position="stacked">Nombre d'objectifs</IonLabel>
                <IonInput
                  type="number"
                  value={formData.objectif_number}
                  onIonChange={e => handleInputChange('objectif_number', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Durée (en secondes)</IonLabel>
                <IonInput
                  type="number"
                  value={formData.duration}
                  onIonChange={e => handleInputChange('duration', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Nombre d'objectifs pour la victoire</IonLabel>
                <IonInput
                  type="number"
                  value={formData.victory_condition_nb_objectivs}
                  onIonChange={e => handleInputChange('victory_condition_nb_objectivs', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Durée du hack (en ms)</IonLabel>
                <IonInput
                  type="number"
                  value={formData.hack_duration_ms}
                  onIonChange={e => handleInputChange('hack_duration_ms', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Rayon de la zone d'objectif</IonLabel>
                <IonInput
                  type="number"
                  value={formData.objectiv_zone_radius}
                  onIonChange={e => handleInputChange('objectiv_zone_radius', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Portée des Rogues</IonLabel>
                <IonInput
                  type="number"
                  value={formData.rogue_range}
                  onIonChange={e => handleInputChange('rogue_range', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Portée des Agents</IonLabel>
                <IonInput
                  type="number"
                  value={formData.agent_range}
                  onIonChange={e => handleInputChange('agent_range', parseInt(e.detail.value || '0'))}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Rayon de la zone de jeu (en mètres)</IonLabel>
                <IonInput
                  type="number"
                  value={formData.map_radius}
                  onIonChange={e => handleInputChange('map_radius', parseInt(e.detail.value || '0'))}
                />
              </IonItem>
            </IonList>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default CreateLobby;
  