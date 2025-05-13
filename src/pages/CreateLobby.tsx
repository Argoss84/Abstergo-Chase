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
} from '@ionic/react';
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import GameService from '../services/GameService';

interface GameFormData {
  objectif_number: number;
  duration: number;
  victory_condition_nb_objectivs: number;
  hack_duration_ms: number;
  objectiv_zone_radius: number;
  rogue_range: number;
  agent_range: number;
}

const CreateLobby: React.FC = () => {
  const history = useHistory();
  const [formData, setFormData] = useState<GameFormData>({
    objectif_number: 3,
    duration: 15,
    victory_condition_nb_objectivs: 2,
    hack_duration_ms: 10000,
    objectiv_zone_radius: 300,
    rogue_range: 50,
    agent_range: 50,
  });

  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (field: keyof GameFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
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
      };

      const createdGame = await gameService.createGame(gameData);
      
      if (createdGame && createdGame[0]) {
        // Navigate to the lobby with the game code
        history.push(`/lobby?code=${code}`);
      }
    } catch (error) {
      console.error('Error creating game:', error);
    } finally {
      setIsLoading(false);
    }
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
              Paramètres de la partie
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
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
            </IonList>

            <IonButton 
              expand="block" 
              onClick={handleSubmit} 
              className="ion-margin-top"
              disabled={isLoading}
            >
              {isLoading ? 'Création en cours...' : 'Créer la partie'}
            </IonButton>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default CreateLobby;
  