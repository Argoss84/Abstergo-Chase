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
    IonSelect,
    IonSelectOption,
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
import { useVibration } from '../hooks/useVibration';
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

  // Hook pour la vibration
  const { vibrate, patterns } = useVibration();



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
          const isUserInGame = initialPlayers?.some(player => player.users?.email === userEmail);
          
          // Vérifier aussi dans les joueurs actuels pour éviter les doublons
          const isUserAlreadyInCurrentPlayers = players.some(player => player.users?.email === userEmail);
          
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

              // Les joueurs entrent sans rôle assigné par défaut
              const role = null;
              
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
                
                // Vibration courte pour indiquer qu'un joueur a rejoint
                vibrate(patterns.short);
              }
            } catch (error) {
              await handleErrorWithUser('Erreur lors de l\'ajout du joueur', error, ERROR_CONTEXTS.PLAYER_CREATION);
            } finally {
              isJoiningRef.current = false; // Réinitialiser le flag
            }
          }

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
                    const currentPlayer = playersRef.current.find(p => p.users?.email === userEmail);
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

          // Attendre que la page soit complètement chargée avant de créer les abonnements
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Créer les abonnements aux joueurs à la fin du chargement
          console.log('🚀 Setting up player subscriptions for game:', game[0].id_game);
          const playerChangesChannel = gameService.subscribeToPlayerChanges(
            game[0].id_game.toString(),
            (payload) => {
              console.log('🔔 Player change event received:', {
                eventType: payload.eventType,
                timestamp: new Date().toISOString(),
                gameId: game[0].id_game,
                payload: payload
              });
              
              if (payload.eventType === 'INSERT') {
                console.log('➕ INSERT event - adding new player:', {
                  newPlayer: payload.new,
                  currentPlayersCount: players.length,
                  newPlayersCount: players.length + 1
                });
                
                // Récupérer les données utilisateur complètes pour le nouveau joueur
                const fetchPlayerWithUser = async () => {
                  try {
                    const gameService = new GameService();
                    const playerWithUser = await gameService.getPlayerByIdWithUser(payload.new.id_player.toString());
                    
                    if (playerWithUser && playerWithUser[0]) {
                      setPlayers(prev => {
                        // Vérifier si le joueur n'est pas déjà présent pour éviter les doublons
                        const isPlayerAlreadyPresent = prev.some(p => p.id_player === playerWithUser[0].id_player);
                        
                        if (!isPlayerAlreadyPresent) {
                          const newPlayers = [...prev, playerWithUser[0]];
                          playersRef.current = newPlayers;
                          
                          console.log('✅ Player added successfully with user data. New players list:', newPlayers);
                          
                          // Vibration courte pour indiquer qu'un joueur a rejoint
                          vibrate(patterns.short);
                          
                          return newPlayers;
                        } else {
                          console.log('⚠️ Player already present, skipping duplicate:', playerWithUser[0]);
                          return prev;
                        }
                      });
                    } else {
                      console.log('⚠️ No player data found for ID:', payload.new.id_player);
                    }
                  } catch (error) {
                    console.error('❌ Error fetching player user data:', error);
                  }
                };
                
                fetchPlayerWithUser();
              } else if (payload.eventType === 'UPDATE') {
                console.log('🔄 UPDATE event - updating player:', {
                  updatedPlayer: payload.new,
                  playerId: payload.new.id_player,
                  previousPlayersCount: players.length
                });
                
                // Récupérer les données utilisateur complètes pour la mise à jour
                const updatePlayerWithUser = async () => {
                  try {
                    const gameService = new GameService();
                    const playerWithUser = await gameService.getPlayerByIdWithUser(payload.new.id_player.toString());
                    
                    if (playerWithUser && playerWithUser[0]) {
                      setPlayers(prev => {
                        const newPlayers = prev.map(p => 
                          p.id_player === payload.new.id_player ? playerWithUser[0] : p
                        );
                        playersRef.current = newPlayers;
                        
                        console.log('✅ Player updated successfully with user data. Updated players list:', newPlayers);
                        
                        return newPlayers;
                      });
                    } else {
                      // Fallback si la récupération échoue
                      setPlayers(prev => {
                        const newPlayers = prev.map(p => 
                          p.id_player === payload.new.id_player ? payload.new : p
                        );
                        playersRef.current = newPlayers;
                        
                        console.log('⚠️ Player updated without user data. Updated players list:', newPlayers);
                        
                        return newPlayers;
                      });
                    }
                  } catch (error) {
                    console.error('❌ Error fetching updated player user data:', error);
                    // Fallback en cas d'erreur
                    setPlayers(prev => {
                      const newPlayers = prev.map(p => 
                        p.id_player === payload.new.id_player ? payload.new : p
                      );
                      playersRef.current = newPlayers;
                      
                      console.log('⚠️ Player updated without user data (error fallback). Updated players list:', newPlayers);
                      
                      return newPlayers;
                    });
                  }
                };
                
                updatePlayerWithUser();
              } else {
                console.log('❓ Unknown event type:', payload.eventType);
              }
            }
          );

          // Subscribe to player deletions
          const playerDeleteChannel = gameService.subscribeToPlayerDelete(
            game[0].id_game.toString(),
            (payload) => {
              console.log('🗑️ Player DELETE event received:', {
                eventType: payload.eventType,
                timestamp: new Date().toISOString(),
                gameId: game[0].id_game,
                deletedPlayer: payload.old,
                playerId: payload.old.id_player,
                currentPlayersCount: players.length
              });
              
              setPlayers(prev => {
                const newPlayers = prev.filter(p => p.id_player !== payload.old.id_player);
                playersRef.current = newPlayers;
                
                console.log('✅ Player deleted successfully. Remaining players list:', newPlayers);
                
                return newPlayers;
              });
            }
          );

          // Cleanup subscriptions
          return () => {
            console.log('🧹 Cleaning up subscriptions for game:', game[0].id_game);
            playerChangesChannel.unsubscribe();
            playerDeleteChannel.unsubscribe();
            gameChangesChannel.unsubscribe();
            console.log('✅ All subscriptions cleaned up');
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

  const handleRoleChange = async (playerId: number, newRole: string | null) => {
    try {
      const gameService = new GameService();
      
      // Mettre à jour le rôle sans vérification de limite
      await gameService.updatePlayer(playerId.toString(), { role: newRole });
    } catch (err) {
      await handleErrorWithUser('Erreur lors du changement de rôle', err, ERROR_CONTEXTS.ROLE_CHANGE);
    }
  };

  // Fonction pour vérifier si les prérequis de rôles sont remplis
  const checkRoleRequirements = () => {
    const currentAgents = players.filter(p => p.role === 'AGENT').length;
    const currentRogues = players.filter(p => p.role === 'ROGUE').length;
    const playersWithoutRole = players.filter(p => !p.role).length;
    
    // Le minimum est toujours 1, le maximum est défini dans les paramètres de la partie
    const minAgents = 1;
    const minRogues = 1;
    const maxAgents = gameDetails?.max_agents || 1;
    const maxRogues = gameDetails?.max_rogue || 1;
    
    return {
      agentsMet: currentAgents >= minAgents && currentAgents <= maxAgents,
      roguesMet: currentRogues >= minRogues && currentRogues <= maxRogues,
      currentAgents,
      currentRogues,
      playersWithoutRole,
      minAgents,
      minRogues,
      maxAgents,
      maxRogues
    };
  };

  const handleStartGame = async () => {
    try {
      // Vérifier les prérequis de rôles avant de démarrer
      const requirements = checkRoleRequirements();
      
      // Vérifier si les prérequis sont remplis
      if (!requirements.agentsMet) {
        if (requirements.currentAgents < requirements.minAgents) {
          await handleErrorWithUser(
            `Nombre d'agents insuffisant. Minimum requis: ${requirements.minAgents}, Actuel: ${requirements.currentAgents}`, 
            null, 
            ERROR_CONTEXTS.GAME_START
          );
        } else if (requirements.currentAgents > requirements.maxAgents) {
          await handleErrorWithUser(
            `Nombre d'agents trop élevé. Maximum autorisé: ${requirements.maxAgents}, Actuel: ${requirements.currentAgents}`, 
            null, 
            ERROR_CONTEXTS.GAME_START
          );
        }
        return;
      }
      
      if (!requirements.roguesMet) {
        if (requirements.currentRogues < requirements.minRogues) {
          await handleErrorWithUser(
            `Nombre de rogues insuffisant. Minimum requis: ${requirements.minRogues}, Actuel: ${requirements.currentRogues}`, 
            null, 
            ERROR_CONTEXTS.GAME_START
          );
        } else if (requirements.currentRogues > requirements.maxRogues) {
          await handleErrorWithUser(
            `Nombre de rogues trop élevé. Maximum autorisé: ${requirements.maxRogues}, Actuel: ${requirements.currentRogues}`, 
            null, 
            ERROR_CONTEXTS.GAME_START
          );
        }
        return;
      }

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
                      const currentPlayer = players.find(p => p.users?.email === userEmail);
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
                          backgroundColor: player.role === 'AGENT' ? '#3880ff' : player.role === 'ROGUE' ? '#ff4961' : '#6c757d',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: 'bold'
                        }}>
                          {player.role === 'AGENT' ? 'A' : player.role === 'ROGUE' ? 'R' : '?'}
                        </div>
                      </IonAvatar>
                      <IonLabel>
                        <h2>
                          {player.users?.email || 'Utilisateur inconnu'}
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
                        {/* Contrôles de rôle visibles uniquement pour l'admin */}
                        {players.find(p => p.users?.email === userEmail)?.is_admin && (
                          <IonSelect
                            value={player.role || ''}
                            placeholder="Sélectionner un rôle"
                            interface="popover"
                            interfaceOptions={{
                              showBackdrop: false
                            }}
                            onIonChange={(e) => {
                              const newRole = e.detail.value || null;
                              setPlayers(prev => prev.map(p => 
                                p.id_player === player.id_player 
                                  ? { ...p, role: newRole }
                                  : p
                              ));
                              handleRoleChange(player.id_player, newRole);
                            }}
                            style={{ marginTop: '8px' }}
                          >
                            <IonSelectOption value="AGENT">Agent</IonSelectOption>
                            <IonSelectOption value="ROGUE">Rogue</IonSelectOption>
                            <IonSelectOption value="">Aucun rôle</IonSelectOption>
                          </IonSelect>
                        )}
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
              </IonCardContent>
            </IonCard>

            {/* Indicateur des prérequis de rôles */}
            {players.find(player => player.users?.email === userEmail)?.is_admin && (
              <IonCard style={{ margin: '1rem' }}>
                <IonCardHeader>
                  <IonCardTitle>Prérequis pour démarrer</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  {(() => {
                    const requirements = checkRoleRequirements();
                    return (
                      <div>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '4px',
                          marginBottom: '4px',
                          fontSize: '14px',
                          color: requirements.agentsMet ? '#28a745' : '#dc3545'
                        }}>
                          <span>{requirements.agentsMet ? '✅' : '❌'}</span>
                          <span>Agents: {requirements.currentAgents}/{requirements.minAgents}-{requirements.maxAgents}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '4px',
                          marginBottom: '4px',
                          fontSize: '14px',
                          color: requirements.roguesMet ? '#28a745' : '#dc3545'
                        }}>
                          <span>{requirements.roguesMet ? '✅' : '❌'}</span>
                          <span>Rogues: {requirements.currentRogues}/{requirements.minRogues}-{requirements.maxRogues}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '4px',
                          fontSize: '14px',
                          color: '#6c757d'
                        }}>
                          <span>ℹ️</span>
                          <span>Sans rôle: {requirements.playersWithoutRole}</span>
                        </div>
                      </div>
                    );
                  })()}
                </IonCardContent>
              </IonCard>
            )}

            {/* Bouton Démarrer visible uniquement pour l'admin */}
            {players.find(player => player.users?.email === userEmail)?.is_admin && (
              <IonButton 
                expand="block" 
                color="success"
                onClick={handleStartGame}
                className="ion-margin-bottom"
                disabled={!checkRoleRequirements().agentsMet || !checkRoleRequirements().roguesMet}
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
  