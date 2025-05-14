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
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

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
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [formData, setFormData] = useState<GameFormData>({
    objectif_number: 3,
    duration: 15,
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

  const handleInputChange = (field: keyof GameFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const generateRandomPosition = (center: [number, number], radius: number): [number, number] => {
    // Convert radius from meters to degrees (approximate)
    const radiusInDegrees = radius / 111000;
    
    // Generate random angle
    const angle = Math.random() * 2 * Math.PI;
    
    // Generate random distance within radius
    const distance = Math.sqrt(Math.random()) * radiusInDegrees;
    
    // Calculate new position
    const lat = center[0] + distance * Math.cos(angle);
    const lng = center[1] + distance * Math.sin(angle);
    
    return [lat, lng];
  };

  const handleGenerateObjectives = () => {
    if (!selectedPosition) {
      return;
    }

    const newObjectives: Objective[] = [];
    for (let i = 0; i < formData.objectif_number; i++) {
      newObjectives.push({
        position: generateRandomPosition(selectedPosition, formData.map_radius),
        id: i + 1
      });
    }
    setObjectives(newObjectives);
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
        map_center_longitude: selectedPosition ? selectedPosition[1].toString() : ''
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
      console.error('Error creating game:', error);
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
              <MapContainer
                center={[48.8566, 2.3522]} // Paris coordinates
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
              </MapContainer>
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
                <IonLabel position="stacked">Durée (en minutes)</IonLabel>
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
  