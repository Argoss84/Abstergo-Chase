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
    IonAvatar,
    IonToggle,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import GameService from '../services/GameService';
import { MapContainer, TileLayer, Circle, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useAuth } from '../contexts/AuthenticationContext';
import { getUserByAuthId } from '../services/UserServices';

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
  max_agents: number;
  max_rogue: number;
}

interface GameProp {
  id_prop: number;
  latitude: string;
  longitude: string;
  type: string;
}

interface Player {
  id_player: number;
  id_game: number;
  user_id: string;
  role: string;
  created_at: string;
  users: {
    email: string;
  };
}

const Lobby: React.FC = () => {
  const location = useLocation();
  const { userEmail, session } = useAuth();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [objectives, setObjectives] = useState<GameProp[]>([]);
  const [streets, setStreets] = useState<L.LatLngTuple[][]>([]);
  const [mapKey, setMapKey] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);

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
          
          // Fetch initial players
          const initialPlayers = await gameService.getPlayersByGameId(game[0].id_game.toString());
          setPlayers(initialPlayers || []);

          // Vérifier si l'utilisateur est déjà dans la partie
          const isUserInGame = initialPlayers?.some(player => player.users.email === userEmail);
          
          // Si l'utilisateur n'est pas dans la partie, l'ajouter
          if (!isUserInGame && userEmail && session?.user?.id) {
            // Récupérer l'ID de l'utilisateur
            const user = await getUserByAuthId(session.user.id);
            console.log('User from getUserByAuthId:', user);
            
            if (!user) {
              setError('Utilisateur non trouvé');
              return;
            }

            // Déterminer le rôle en fonction du nombre de joueurs
            const role = initialPlayers?.length === 0 ? 'AGENT' : 'ROGUE';
            
            const playerData = {
              id_game: game[0].id_game,
              user_id: user.id,
              role: role,
              created_at: new Date().toISOString()
            };
            
            console.log('Creating player with data:', playerData);
            
            await gameService.createPlayer(playerData);
          }

          // Subscribe to player changes
          const playerChangesChannel = gameService.subscribeToPlayerChanges(
            game[0].id_game.toString(),
            (payload) => {
              if (payload.eventType === 'INSERT') {
                setPlayers(prev => [...prev, payload.new]);
              } else if (payload.eventType === 'UPDATE') {
                setPlayers(prev => prev.map(p => 
                  p.id_player === payload.new.id_player ? payload.new : p
                ));
              }
            }
          );

          // Subscribe to player deletions
          const playerDeleteChannel = gameService.subscribeToPlayerDelete(
            game[0].id_game.toString(),
            (payload) => {
              setPlayers(prev => prev.filter(p => p.id_player !== payload.old.id_player));
            }
          );

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

          // Cleanup subscriptions
          return () => {
            playerChangesChannel.unsubscribe();
            playerDeleteChannel.unsubscribe();
          };
        } else {
          setError('Partie non trouvée');
        }
      } catch (err) {
        console.error('Error fetching game details:', err);
        setError('Erreur lors du chargement de la partie');
      }
    };

    fetchGameDetails();
  }, [location.search, userEmail, session]);

  const handleRoleChange = async (playerId: number, newRole: string) => {
    try {
      const gameService = new GameService();
      
      // Compter le nombre actuel de joueurs par rôle
      const currentAgents = players.filter(p => p.role === 'AGENT').length;
      const currentRogues = players.filter(p => p.role === 'ROGUE').length;
      
      // Vérifier si le changement est possible
      if (newRole === 'AGENT' && currentAgents >= (gameDetails?.max_agents || 1)) {
        setError('Nombre maximum d\'agents atteint');
        return;
      }
      if (newRole === 'ROGUE' && currentRogues >= (gameDetails?.max_rogue || 1)) {
        setError('Nombre maximum de rogues atteint');
        return;
      }

      // Mettre à jour le rôle
      await gameService.updatePlayer(playerId.toString(), { role: newRole });
      console.log(`Rôle mis à jour avec succès sur le serveur: ${playerId} -> ${newRole}`);
    } catch (err) {
      console.error('Error updating player role:', err);
      setError('Erreur lors du changement de rôle');
    }
  };

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

            <IonCard>
              <IonCardHeader>
                <IonCardTitle>Joueurs ({players.length})</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  {players.map((player) => (
                    <IonItem key={player.id_player}>
                      <IonAvatar slot="start">
                        <div style={{
                          width: '100%',
                          height: '100%',
                          backgroundColor: player.role === 'AGENT' ? '#3880ff' : '#ff4961',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: 'bold'
                        }}>
                          {player.role === 'AGENT' ? 'A' : 'R'}
                        </div>
                      </IonAvatar>
                      <IonLabel>
                        <h2>{player.users.email}</h2>
                        <p>{player.role}</p>
                      </IonLabel>
                      {player.users.email === userEmail && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span style={{ color: '#3880ff' }}>Agent</span>
                          <IonToggle
                            checked={player.role === 'ROGUE'}
                            onIonChange={(e) => {
                              const newRole = e.detail.checked ? 'ROGUE' : 'AGENT';
                              console.log(`Mise à jour locale du rôle: ${player.users.email} -> ${newRole}`);
                              // Mise à jour immédiate de l'état local
                              setPlayers(prev => prev.map(p => 
                                p.id_player === player.id_player 
                                  ? { ...p, role: newRole }
                                  : p
                              ));
                              handleRoleChange(player.id_player, newRole);
                            }}
                            color="danger"
                          />
                          <span style={{ color: '#ff4961' }}>Rogue</span>
                        </div>
                      )}
                    </IonItem>
                  ))}
                </IonList>
              </IonCardContent>
            </IonCard>

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
  