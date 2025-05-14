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
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import GameService from '../services/GameService';

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
}

const Lobby: React.FC = () => {
  const location = useLocation();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const game = await gameService.getGameByCode(code);
        
        if (game && game[0]) {
          setGameDetails(game[0]);
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
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              Détails de la partie
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {error ? (
              <IonText color="danger">
                <p>{error}</p>
              </IonText>
            ) : gameDetails ? (
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
            ) : (
              <IonText>
                <p>Chargement des détails de la partie...</p>
              </IonText>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default Lobby;
  