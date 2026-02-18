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
    IonIcon,
} from '@ionic/react';
import { chevronBackOutline } from 'ionicons/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useGameSession } from '../contexts/GameSessionContext';

import { MapContainer, TileLayer, Marker, useMapEvents, useMap, Circle, CircleMarker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { generateRandomPoints, generateStartZone, generateStartZoneRogue, getOuterStreetContour } from '../utils/utils';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
import {
  DEFAULT_OBJECTIVE_NUMBER,
  DEFAULT_GAME_DURATION,
  DEFAULT_VICTORY_CONDITION_OBJECTIVES,
  DEFAULT_HACK_DURATION_CREATE_MS,
  DEFAULT_OBJECTIVE_ZONE_RADIUS,
  DEFAULT_ROGUE_RANGE,
  DEFAULT_AGENT_RANGE,
  DEFAULT_MAP_RADIUS,
  DEFAULT_MAX_AGENTS,
  DEFAULT_MAX_ROGUE,
  START_ZONE_RADIUS,
  DEFAULT_MAP_ZOOM_CREATE_LOBBY,
  CREATE_LOBBY_GEOLOCATION_TIMEOUT,
  CREATE_LOBBY_GEOLOCATION_MAX_AGE,
  CREATE_LOBBY_GEOLOCATION_RETRY_TIMEOUT,
  CREATE_LOBBY_GEOLOCATION_RETRY_MAX_AGE,
  MAX_PLAYER_NAME_LENGTH
} from '../ressources/DefaultValues';

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
  const { createLobby, playerName, setPlayerName, lobbyCode, disconnectSocket, clearSession } = useGameSession();
  const hasDisconnectedSocketRef = useRef(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const modalOpenRef = useRef(false);
  const fromPopstateRef = useRef(false);
  const [selectedPosition, setSelectedPosition] = useState<[number, number] | null>(null);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [isLoadingGPS, setIsLoadingGPS] = useState(true);
  const [streets, setStreets] = useState<L.LatLngTuple[][]>([]);
  const [mapKey, setMapKey] = useState(0);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [startZones, setStartZones] = useState<StartZones>({ agent: null, rogue: null });
  const [displayName, setDisplayName] = useState(playerName);
  const [formData, setFormData] = useState<GameFormData>({
    objectif_number: DEFAULT_OBJECTIVE_NUMBER,
    duration: DEFAULT_GAME_DURATION,
    victory_condition_nb_objectivs: DEFAULT_VICTORY_CONDITION_OBJECTIVES,
    hack_duration_ms: DEFAULT_HACK_DURATION_CREATE_MS,
    objectiv_zone_radius: DEFAULT_OBJECTIVE_ZONE_RADIUS,
    rogue_range: DEFAULT_ROGUE_RANGE,
    agent_range: DEFAULT_AGENT_RANGE,
    map_center_latitude: '',
    map_center_longitude: '',
    map_radius: DEFAULT_MAP_RADIUS,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingStreets, setIsLoadingStreets] = useState(false);
  const [streetsLoadError, setStreetsLoadError] = useState<string | null>(null);
  const [outerContour, setOuterContour] = useState<[number, number][]>([]);

  // Nettoyer les données de session à l'ouverture de la page
  useEffect(() => {
    clearSession();
    if (!lobbyCode && !hasDisconnectedSocketRef.current) {
      hasDisconnectedSocketRef.current = true;
      disconnectSocket();
    }
  }, [clearSession, disconnectSocket, lobbyCode]);

  // Fermer la modale au lieu de naviguer lors du bouton retour (navigateur ou matériel)
  useEffect(() => {
    const onPopState = () => {
      fromPopstateRef.current = true;
      setIsModalOpen(false);
      modalOpenRef.current = false;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      e.detail.register(101, (processNextHandler: () => void) => {
        if (modalOpenRef.current) {
          modalOpenRef.current = false;
          setIsModalOpen(false);
        } else {
          processNextHandler();
        }
      });
    };
    document.addEventListener('ionBackButton', handler as EventListener);
    return () => document.removeEventListener('ionBackButton', handler as EventListener);
  }, []);

  // Initialize displayName with playerName from context
  useEffect(() => {
    setDisplayName(playerName);
  }, [playerName]);

  // Fonction helper pour gérer les erreurs
  const handleErrorWithContext = async (errorMessage: string, error?: any, context?: string) => {
    await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      shouldShowError: false // Ne pas afficher l'erreur à l'utilisateur dans ce composant
    });
  };

  const handleOpenDetailsModal = () => {
    window.history.pushState({ modal: 'details' }, '', window.location.href);
    modalOpenRef.current = true;
    setIsModalOpen(true);
  };

  const handleDismissModal = useCallback(() => {
    if (!fromPopstateRef.current) window.history.back();
    fromPopstateRef.current = false;
    modalOpenRef.current = false;
    setIsModalOpen(false);
  }, []);

  const handleInputChange = (field: keyof GameFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNameChange = (e: CustomEvent) => {
    const value = e.detail.value || '';
    setDisplayName(value);
  };

  const fetchStreets = async (lat: number, lng: number) => {
    setIsLoadingStreets(true);
    setStreetsLoadError(null);
    setStreets([]);

    try {
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=
                            [out:json];
                            (
                              way(around:${formData.map_radius},${lat},${lng})["highway"]["foot"!~"no"];
                              way(around:${formData.map_radius},${lat},${lng})["amenity"="square"]["foot"!~"no"];
                            );
                            (._;>;);
                            out;`;

      const response = await fetch(overpassUrl);
      
      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("La réponse de l'API n'est pas au format JSON");
      }

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
      setStreetsLoadError(null);
    } catch (error: any) {
      const errorMessage = error.message || 'Erreur de connexion à l\'API Overpass';
      setStreetsLoadError(errorMessage);
      await handleErrorWithContext('Erreur lors de la récupération des rues', error, ERROR_CONTEXTS.STREET_FETCH);
    } finally {
      setIsLoadingStreets(false);
    }
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
    if (!displayName.trim()) {
      await handleErrorWithContext('Veuillez entrer un nom de joueur', null, ERROR_CONTEXTS.VALIDATION);
      return;
    }

    try {
      setIsLoading(true);
      
      // Mettre à jour le nom du joueur avant de créer le lobby
      if (displayName.trim() !== playerName) {
        setPlayerName(displayName.trim());
      }

      const gameId = Date.now();

      const gameDetails = {
        ...formData,
        id_game: gameId,
        code: '',
        created_at: new Date().toISOString(),
        map_center_latitude: selectedPosition ? selectedPosition[0].toString() : '',
        map_center_longitude: selectedPosition ? selectedPosition[1].toString() : '',
        start_zone_latitude: startZones.agent ? startZones.agent[0].toString() : null,
        start_zone_longitude: startZones.agent ? startZones.agent[1].toString() : null,
        start_zone_rogue_latitude: startZones.rogue ? startZones.rogue[0].toString() : null,
        start_zone_rogue_longitude: startZones.rogue ? startZones.rogue[1].toString() : null,
        max_agents: DEFAULT_MAX_AGENTS,
        max_rogue: DEFAULT_MAX_ROGUE,
        remaining_time: formData.duration,
        winner_type: null,
        is_converging_phase: false,
        started: false,
        countdown_started: false,
        city: null,
        started_date: null,
        props: [],
        players: [],
        map_streets: outerContour.length >= 3 ? [outerContour] : null
      };
      const propsData = objectives.map((obj, index) => ({
        id_prop: gameId + index,
        id_game: gameId,
        latitude: obj.position[0].toString(),
        longitude: obj.position[1].toString(),
        type: 'OBJECTIV',
        created_at: new Date().toISOString(),
        name: null,
        description: null,
        color: null,
        visible: true,
        detection_radius: formData.objectiv_zone_radius,
        visibility_last_change_date: null,
        state: null
      }));

      const lobbyCode = await createLobby(gameDetails, propsData);
      history.push(`/lobby?code=${lobbyCode}`);
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
        setStartZones({ agent: null, rogue: null }); // Clear start zones
      },
    });
    return null;
  };

  useEffect(() => {
    const setPosition = (position: GeolocationPosition) => {
      const newPosition: [number, number] = [position.coords.latitude, position.coords.longitude];
      setUserPosition(newPosition);
      setIsLoadingGPS(false);
      setMapKey(prev => prev + 1);
      setFormData(prev => ({
        ...prev,
        map_center_latitude: newPosition[0].toString(),
        map_center_longitude: newPosition[1].toString()
      }));
    };

    const handleError = (error: GeolocationPositionError) => {
      setIsLoadingGPS(false);
      // Ne pas utiliser de position par défaut, laisser userPosition à null
      console.warn('Erreur de géolocalisation:', error);
    };
    
    if (!navigator.geolocation) {
      setIsLoadingGPS(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPosition(position);
      },
      (error) => {
        // If timeout or position unavailable, try one more time with different settings
        if (error.code === 3 || error.code === 2) {
          navigator.geolocation.getCurrentPosition(
            setPosition,
            handleError,
            {
              enableHighAccuracy: false,
              timeout: CREATE_LOBBY_GEOLOCATION_RETRY_TIMEOUT,
              maximumAge: CREATE_LOBBY_GEOLOCATION_RETRY_MAX_AGE
            }
          );
        } else {
          // Permission denied or other error
          handleError(error);
        }
      },
      {
        enableHighAccuracy: false,
        timeout: CREATE_LOBBY_GEOLOCATION_TIMEOUT,
        maximumAge: CREATE_LOBBY_GEOLOCATION_MAX_AGE
      }
    );
  }, []);

  useEffect(() => {
    if (selectedPosition) {
      fetchStreets(selectedPosition[0], selectedPosition[1]);
    }
  }, [selectedPosition]);

  useEffect(() => {
    if (!selectedPosition) {
      setOuterContour([]);
      return;
    }
    if (isLoadingStreets || streetsLoadError) {
      setOuterContour([]);
      return;
    }
    if (streets.length === 0) {
      setOuterContour([]);
      return;
    }
    const contour = getOuterStreetContour(selectedPosition, formData.map_radius, streets);
    setOuterContour(contour.length >= 3 ? contour : []);
  }, [selectedPosition, streets, formData.map_radius, isLoadingStreets, streetsLoadError]);

  return (
    <IonPage id="CreateLobby-page">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {isModalOpen ? (
              <IonButton fill="clear" onClick={() => setIsModalOpen(false)}>
                <IonIcon icon={chevronBackOutline} />
              </IonButton>
            ) : (
              <IonBackButton defaultHref="/home" />
            )}
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
            <IonItem>
              <IonLabel position="stacked">Votre nom</IonLabel>
              <IonInput
                value={displayName}
                onIonInput={handleNameChange}
                placeholder="Entrez votre nom"
                maxlength={MAX_PLAYER_NAME_LENGTH}
              />
            </IonItem>

            <div style={{ height: '300px', width: '100%', marginTop: '1rem', marginBottom: '1rem' }}>
              {isLoadingGPS ? (
                <div style={{ 
                  height: '100%', 
                  width: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexDirection: 'column',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '8px'
                }}>
                  <IonText color="medium">
                    <p style={{ fontSize: '1rem', margin: '0.5rem 0' }}>Chargement de la position GPS...</p>
                  </IonText>
                  <IonText color="medium">
                    <p style={{ fontSize: '0.85rem', margin: '0.5rem 0', opacity: 0.7 }}>Veuillez autoriser l'accès à votre position</p>
                  </IonText>
                </div>
              ) : userPosition ? (
                <MapContainer
                  key={mapKey}
                  center={userPosition}
                  zoom={DEFAULT_MAP_ZOOM_CREATE_LOBBY}
                  style={{ height: '100%', width: '100%' }}
                >
                  <ResizeMap />
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <MapEvents />
                  {/* Marqueur de position GPS de l'utilisateur */}
                  {userPosition && (
                    <>
                      <CircleMarker
                        center={userPosition}
                        radius={6}
                        pathOptions={{
                          color: '#fff',
                          weight: 2,
                          fillColor: '#4285F4',
                          fillOpacity: 1,
                        }}
                      />
                      <CircleMarker
                        center={userPosition}
                        radius={18}
                        pathOptions={{
                          color: 'transparent',
                          fillColor: '#4285F4',
                          fillOpacity: 0.15,
                        }}
                      />
                    </>
                  )}
                  {selectedPosition && (
                    <>
                      <Marker position={selectedPosition} />
                      {outerContour.length >= 3 ? (
                        <Polygon
                          positions={outerContour}
                          pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.12, weight: 2.5 }}
                        />
                      ) : (
                        <Circle
                          center={selectedPosition}
                          radius={formData.map_radius}
                          pathOptions={{
                            color: 'blue',
                            fillColor: 'blue',
                            fillOpacity: 0.08,
                            ...(isLoadingStreets ? { dashArray: '6 8' } : null)
                          }}
                        />
                      )}
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
                  {formData.objectiv_zone_radius > 0 &&
                    objectives.map((objective) => (
                      <Circle
                        key={`objective-zone-${objective.id}`}
                        center={objective.position}
                        radius={formData.objectiv_zone_radius}
                        pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 0.08, weight: 1 }}
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
                        radius={START_ZONE_RADIUS}
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
                        radius={START_ZONE_RADIUS}
                        pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.1 }}
                      />
                    </>
                  )}
                  {streets.map((street, index) => {
                    const validPositions = street.filter((p): p is [number, number] => p != null && Array.isArray(p) && p.length >= 2);
                    if (validPositions.length < 2) return null;
                    return (
                      <Polyline
                        key={index}
                        positions={validPositions}
                        pathOptions={{ color: 'gray', weight: 2, opacity: 0.7 }}
                      />
                    );
                  })}
                </MapContainer>
              ) : (
                <div style={{ 
                  height: '100%', 
                  width: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexDirection: 'column',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '8px'
                }}>
                  <IonText color="danger">
                    <p style={{ fontSize: '1rem', margin: '0.5rem 0' }}>Position GPS non disponible</p>
                  </IonText>
                  <IonText color="medium">
                    <p style={{ fontSize: '0.85rem', margin: '0.5rem 0', opacity: 0.7 }}>Veuillez activer la géolocalisation pour continuer</p>
                  </IonText>
                </div>
              )}
            </div>

            <IonButton 
              expand="block" 
              onClick={handleOpenDetailsModal}
              className="ion-margin-bottom"
            >
              Détails Partie
            </IonButton>

            {isLoadingStreets && (
              <IonText color="medium" className="ion-text-center ion-margin-bottom">
                <p style={{ fontSize: '0.9rem' }}>Chargement des rues en cours...</p>
              </IonText>
            )}

            {streetsLoadError && (
              <>
                <IonText color="danger" className="ion-text-center ion-margin-bottom">
                  <p style={{ fontSize: '0.9rem' }}>{streetsLoadError}</p>
                </IonText>
                <IonButton 
                  expand="block" 
                  color="warning"
                  className="ion-margin-bottom"
                  onClick={() => selectedPosition && fetchStreets(selectedPosition[0], selectedPosition[1])}
                >
                  Réessayer de charger les rues
                </IonButton>
              </>
            )}

            <IonButton 
              expand="block" 
              className="ion-margin-bottom"
              onClick={handleGenerateObjectives}
              disabled={!selectedPosition || isLoadingStreets || !!streetsLoadError || !userPosition}
            >
              {isLoadingStreets ? 'Chargement des rues...' : 'Générer les objectifs'}
            </IonButton>

            <IonButton 
              expand="block" 
              onClick={handleSubmit} 
              disabled={isLoading || !selectedPosition || objectives.length === 0 || !displayName.trim() || !userPosition}
            >
              {isLoading ? 'Création en cours...' : 'Créer la partie'}
            </IonButton>
          </IonCardContent>
        </IonCard>

        <IonModal isOpen={isModalOpen} onDidDismiss={handleDismissModal}>
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonButton fill="clear" onClick={() => setIsModalOpen(false)}>
                  <IonIcon icon={chevronBackOutline} />
                </IonButton>
              </IonButtons>
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
                <IonLabel position="stacked">Rayon de la zone indicative des objectifs (agents)</IonLabel>
                <IonInput
                  type="number"
                  value={formData.objectiv_zone_radius}
                  onIonChange={e => handleInputChange('objectiv_zone_radius', parseInt(e.detail.value || '0'))}
                  min="0"
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
  
