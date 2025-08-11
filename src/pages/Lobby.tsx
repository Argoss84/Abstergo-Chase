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
import { useEffect, useState, useRef } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import GameService from '../services/GameService';
import { MapContainer, TileLayer, Circle, Marker, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useAuth } from '../contexts/AuthenticationContext';
import { getUserByAuthId } from '../services/UserServices';
import { GameDetails, GameProp, Player } from '../components/Interfaces';
import { useWakeLock } from '../utils/useWakeLock';
import { LogService } from '../services/LogService';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';

// Interface étendue pour Player avec les informations utilisateur
interface PlayerWithUser extends Player {
  users: {
    email: string;
  };
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

const Lobby: React.FC = () => {
  const location = useLocation();
  const history = useHistory();
  const { userEmail, session } = useAuth();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [objectives, setObjectives] = useState<GameProp[]>([]);
  const [streets, setStreets] = useState<L.LatLngTuple[][]>([]);
  const [mapKey, setMapKey] = useState(0);
  const [players, setPlayers] = useState<PlayerWithUser[]>([]);
  const playersRef = useRef<PlayerWithUser[]>([]);
  const isJoiningRef = useRef(false);

  // Wake Lock pour empêcher l'écran de se mettre en veille
  const { releaseWakeLock } = useWakeLock(true);



  // Fonction utilitaire pour effacer les erreurs
  const clearError = () => {
    setError(null);
  };

  // Fonction helper pour gérer les erreurs avec l'email de l'utilisateur
  const handleErrorWithUser = async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      userEmail: userEmail || undefined
    });
    setError(errorResult.message);
    return errorResult;
  };

  // Update the ref whenever players changes
  useEffect(() => {
    if (players.length > 0) {
      playersRef.current = [...players];
    }
  }, [players]);

  useEffect(() => {
    const fetchGameDetails = async () => {
      try {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        
        if (!code) {
          await handleErrorWithUser('Code de partie non trouvé', null, ERROR_CONTEXTS.LOBBY_INIT);
          return;
        }

        const gameService = new GameService();
        const game = await gameService.getGameDatasByCode(code);
        
        if (game && game[0]) {
          setGameDetails(game[0]);
          setObjectives(game[0].props || []);
          
          // Fetch initial players
          const initialPlayers = await gameService.getPlayersByGameId(game[0].id_game.toString());
          if (initialPlayers) {
            setPlayers(initialPlayers);
            playersRef.current = initialPlayers;
          }
          
          // Vérifier si l'utilisateur est déjà dans la partie
          const isUserInGame = initialPlayers?.some(player => player.users.email === userEmail);
          
          // Vérifier aussi dans les joueurs actuels pour éviter les doublons
          const isUserAlreadyInCurrentPlayers = players.some(player => player.users.email === userEmail);
          
          // Si l'utilisateur n'est pas dans la partie, l'ajouter
          if (!isUserInGame && !isUserAlreadyInCurrentPlayers && userEmail && session?.user?.id && !isJoiningRef.current) {
            isJoiningRef.current = true; // Marquer que nous sommes en train de rejoindre
            
            
            try {
              // Récupérer l'ID de l'utilisateur
              const user = await getUserByAuthId(session.user.id);
              
              if (!user) {
                await handleErrorWithUser('Utilisateur non trouvé', null, ERROR_CONTEXTS.PLAYER_CREATION);
                return;
              }

              // Déterminer le rôle en fonction du nombre de joueurs
              const role = initialPlayers?.length === 0 ? 'AGENT' : 'ROGUE';
              
              // Le premier joueur devient automatiquement admin
              const isAdmin = initialPlayers?.length === 0; 

              const playerData = {
                id_game: game[0].id_game,
                user_id: user.id,
                role: role,
                is_admin: isAdmin,
                created_at: new Date().toISOString()
              };
                          
              await gameService.createPlayer(playerData);
              
              // Attendre un peu pour s'assurer que la base de données a bien enregistré les changements
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Logger la connexion du joueur seulement lors de l'ajout effectif
              await LogService.quickLog(
                userEmail,
                'LOBBY',
                `Joueur ${userEmail} a rejoint la partie ${game[0].code}`, "null"
              );
              
              // Rafraîchir la liste des joueurs après la création
              const updatedPlayers = await gameService.getPlayersByGameId(game[0].id_game.toString());
              if (updatedPlayers) {
                console.log('Refreshed players list:', updatedPlayers);
                setPlayers(updatedPlayers);
                playersRef.current = updatedPlayers;
              }
            } catch (error) {
              await handleErrorWithUser('Erreur lors de l\'ajout du joueur', error, ERROR_CONTEXTS.PLAYER_CREATION);
            } finally {
              isJoiningRef.current = false; // Réinitialiser le flag
            }
          }

          // Subscribe to player changes
          const playerChangesChannel = gameService.subscribeToPlayerChanges(
            game[0].id_game.toString(),
            (payload) => {
              console.log('Player change event received:', payload);
              if (payload.eventType === 'INSERT') {
                console.log('INSERT event - adding new player:', payload.new);
                setPlayers(prev => {
                  const newPlayers = [...prev, payload.new];
                  playersRef.current = newPlayers;
                  return newPlayers;
                });
              } else if (payload.eventType === 'UPDATE') {
                console.log('UPDATE event - updating player:', payload.new);
                setPlayers(prev => {
                  const newPlayers = prev.map(p => 
                    p.id_player === payload.new.id_player ? payload.new : p
                  );
                  playersRef.current = newPlayers;
                  return newPlayers;
                });
              }
            }
          );

          // Subscribe to player deletions
          const playerDeleteChannel = gameService.subscribeToPlayerDelete(
            game[0].id_game.toString(),
            (payload) => {
              setPlayers(prev => {
                const newPlayers = prev.filter(p => p.id_player !== payload.old.id_player);
                playersRef.current = newPlayers;
                return newPlayers;
              });
            }
          );

          // Subscribe to game changes with improved handling
          const gameChangesChannel = gameService.subscribeToGameDataChanges(
            game[0].code,
            async (payload) => {
              
              if (payload.eventType === 'UPDATE') {
                setGameDetails(prev => {
                  const newGameDetails = prev ? { ...prev, ...payload.new } : null;
                  
                  // Check if the game has started (is_converging_phase is true)
                  if (payload.new.is_converging_phase === true) {
                    // Find the current player's role using the ref
                    const currentPlayer = playersRef.current.find(p => p.users.email === userEmail);
                    if (currentPlayer) {
                      // Redirect based on role
                      const gameCode = payload.new.code;
                      if (currentPlayer.role === 'AGENT') {
                        history.push(`/agent?code=${gameCode}`);
                      } else if (currentPlayer.role === 'ROGUE') {
                        history.push(`/rogue?code=${gameCode}`);
                      }
                    }
                  }
                  
                  return newGameDetails;
                });
              } else if (payload.eventType === 'INSERT') {
                // Handle new game data if needed
                console.log('New game data inserted:', payload.new);
                             } else if (payload.eventType === 'DELETE') {
                 // Handle game deletion if needed
                 console.log('Game deleted:', payload.old);
                 await handleErrorWithUser('La partie a été supprimée', payload.old, ERROR_CONTEXTS.GAME_EVENTS);
               }
            }
          );



          // Fetch streets
          if (game[0].map_center_latitude && game[0].map_center_longitude) {
            try {
              const overpassUrl = `https://overpass-api.de/api/interpreter?data=
                [out:json];
                (
                  way(around:${game[0].map_radius},${game[0].map_center_latitude},${game[0].map_center_longitude})["highway"]["foot"!~"no"];
                  way(around:${game[0].map_radius},${game[0].map_center_latitude},${game[0].map_center_longitude})["amenity"="square"]["foot"!~"no"];
                );
                (._;>;);
                out;`;

              const response = await fetch(overpassUrl);
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
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
                         } catch (streetError) {
               // Log l'erreur mais ne bloque pas le chargement de la partie
               console.warn('Erreur lors de la récupération des rues:', streetError);
               // Utiliser la fonction factorisée handleError pour le logging
               await handleError('Erreur lors de la récupération des rues', streetError, {
                 context: ERROR_CONTEXTS.STREET_FETCH,
                 userEmail: userEmail || undefined,
                 shouldShowError: false // Ne pas afficher l'erreur à l'utilisateur
               });
             }
          }

          // Cleanup subscriptions
          return () => {
            playerChangesChannel.unsubscribe();
            playerDeleteChannel.unsubscribe();
            gameChangesChannel.unsubscribe();
          };
        } else {
          await handleErrorWithUser('Partie non trouvée', null, ERROR_CONTEXTS.LOBBY_INIT);
        }
      } catch (err) {
        await handleErrorWithUser('Erreur lors du chargement de la partie', err, ERROR_CONTEXTS.LOBBY_INIT);
      }
    };

    fetchGameDetails();
  }, [location.search, userEmail, session?.user?.id]);

  const handleRoleChange = async (playerId: number, newRole: string) => {
    try {
      const gameService = new GameService();
      
      // Compter le nombre actuel de joueurs par rôle
      const currentAgents = players.filter(p => p.role === 'AGENT').length;
      const currentRogues = players.filter(p => p.role === 'ROGUE').length;
      
      // Vérifier si le changement est possible
      if (newRole === 'AGENT' && currentAgents >= (gameDetails?.max_agents || 1)) {
        await handleErrorWithUser('Nombre maximum d\'agents atteint', null, ERROR_CONTEXTS.ROLE_CHANGE);
        return;
      }
      if (newRole === 'ROGUE' && currentRogues >= (gameDetails?.max_rogue || 1)) {
        await handleErrorWithUser('Nombre maximum de rogues atteint', null, ERROR_CONTEXTS.ROLE_CHANGE);
        return;
      }

      // Mettre à jour le rôle
      await gameService.updatePlayer(playerId.toString(), { role: newRole });
    } catch (err) {
      await handleErrorWithUser('Erreur lors du changement de rôle', err, ERROR_CONTEXTS.ROLE_CHANGE);
    }
  };

  const handleStartGame = async () => {
    try {
      const gameService = new GameService();
      await gameService.updateGameByCode(gameDetails!.code, {
        is_converging_phase: true
      });
    } catch (error) {
      await handleErrorWithUser('Erreur lors du démarrage de la partie', error, ERROR_CONTEXTS.GAME_START);
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
          <IonCard color="danger" style={{ margin: '1rem' }}>
            <IonCardHeader>
              <IonCardTitle style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚠️ Erreur
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonText color="light">
                <p>{error}</p>
              </IonText>
              <IonButton 
                expand="block" 
                color="light"
                onClick={clearError}
                style={{ marginTop: '1rem' }}
              >
                ✕ Fermer l'erreur
              </IonButton>
            </IonCardContent>
          </IonCard>
        ) : gameDetails ? (
          <>
            {/* Cadre pour partie en cours */}
            {gameDetails.is_converging_phase && (
              <IonCard color="warning" style={{ margin: '1rem' }}>
                <IonCardHeader>
                  <IonCardTitle style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    ⚠️ Partie en cours
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonText color="light">
                    <p>Cette partie a déjà commencé. Vous pouvez la rejoindre en tant que spectateur ou participant.</p>
                  </IonText>
                  <IonButton 
                    expand="block" 
                    color="success"
                    onClick={() => {
                      const currentPlayer = players.find(p => p.users.email === userEmail);
                      if (currentPlayer) {
                        if (currentPlayer.role === 'AGENT') {
                          history.push(`/agent?code=${gameDetails.code}`);
                        } else if (currentPlayer.role === 'ROGUE') {
                          history.push(`/rogue?code=${gameDetails.code}`);
                        }
                      }
                    }}
                    style={{ marginTop: '1rem' }}
                  >
                    🎮 Rejoindre la partie
                  </IonButton>
                </IonCardContent>
              </IonCard>
            )}

            <div style={{ height: '300px', width: '100%', marginBottom: '1rem' }}>
              <MapContainer
                key={mapKey}
                center={[
                  parseFloat(gameDetails.map_center_latitude || '0'), 
                  parseFloat(gameDetails.map_center_longitude || '0')
                ]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
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
                  radius={gameDetails.map_radius || 1000}
                  pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                />
                {objectives.map((objective) => (
                  <Marker
                    key={objective.id_prop}
                    position={[
                      parseFloat(objective.latitude || '0'), 
                      parseFloat(objective.longitude || '0')
                    ]}
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
                        <h2>
                          {player.users.email}
                          {player.is_admin && (
                            <span style={{ 
                              color: '#ff6b35', 
                              fontSize: '0.8em', 
                              marginLeft: '8px',
                              fontWeight: 'bold'
                            }}>
                              👑 Admin
                            </span>
                          )}
                        </h2>
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

            {/* Bouton Démarrer visible uniquement pour l'admin */}
            {players.find(player => player.users.email === userEmail)?.is_admin && (
              <IonButton 
                expand="block" 
                color="success"
                onClick={handleStartGame}
                className="ion-margin-bottom"
              >
                🚀 Démarrer la partie
              </IonButton>
            )}

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
                      <p>{(gameDetails.hack_duration_ms || 0) / 1000} secondes</p>
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
  