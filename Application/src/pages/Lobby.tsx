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
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { GameDetails, GameProp, Player } from '../components/Interfaces';
import { useWakeLock } from '../utils/useWakeLock';
import { useVibration } from '../hooks/useVibration';
import { handleError, ERROR_CONTEXTS } from '../utils/ErrorUtils';
import Loading from '../components/Loading';
import { useGameSession } from '../contexts/GameSessionContext';

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
  const {
    lobbyCode,
    joinLobby,
    gameDetails,
    players,
    playerId,
    updatePlayer,
    updateGameDetails,
    props,
    isHost,
    connectionStatus,
    clearSession
  } = useGameSession();
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Connexion au lobby...');
  const [isJoining, setIsJoining] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden);

  useWakeLock(true);
  const { vibrate, patterns } = useVibration();

  const currentPlayer = useMemo(
    () => players.find((player) => player.id_player === playerId),
    [players, playerId]
  );

  const handleErrorWithUser = async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      shouldLog: false
    });
    setError(errorResult.message);
    return errorResult;
  };

  useEffect(() => {
    const fetchLobby = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');

      // Si nous sommes déjà connectés au bon lobby, ne rien faire
      if (lobbyCode && code && lobbyCode === code && connectionStatus === 'connected') {
        setIsLoading(false);
        setIsJoining(false);
        return;
      }

      // Si en cours de connexion, attendre mais ne pas rester bloqué indéfiniment
      if (connectionStatus === 'connecting') {
        setLoadingMessage('Connexion en cours...');
        // Réinitialiser le compteur d'erreurs si on essaie de se connecter
        setErrorCount(0);
        // Ne pas bloquer, laisser l'useEffect suivant gérer la fin du chargement
        return;
      }

      // Si erreur de connexion, être plus tolérant
      if (connectionStatus === 'error') {
        // Ne pas afficher l'erreur immédiatement, attendre plusieurs erreurs
        const newErrorCount = errorCount + 1;
        setErrorCount(newErrorCount);
        
        // Afficher l'erreur seulement après 3 erreurs consécutives
        if (newErrorCount >= 3) {
          setIsLoading(false);
          setIsJoining(false);
          setError('Impossible de se connecter au serveur après plusieurs tentatives.');
          return;
        }
        // Sinon, continuer à attendre
        setLoadingMessage('Nouvelle tentative de connexion...');
        return;
      }

      // Éviter les appels multiples simultanés
      if (isJoining) {
        return;
      }

      // Si un code est fourni dans l'URL
      if (code) {
        // Si on a déjà le même lobbyCode et qu'on est déjà connecté, ne rien faire
        if (lobbyCode === code && connectionStatus === 'connected') {
          setIsLoading(false);
          setIsJoining(false);
          return;
        }
        
        // Si on a le même lobbyCode mais pas encore connecté, rejoindre
        if (lobbyCode !== code || connectionStatus === 'idle') {
          try {
            setIsJoining(true);
            setLoadingMessage('Connexion au lobby WebRTC...');
            await joinLobby(code);
            vibrate(patterns.short);
          } catch (err) {
            await handleErrorWithUser('Impossible de rejoindre le lobby', err, ERROR_CONTEXTS.LOBBY_INIT);
            setIsLoading(false);
          } finally {
            setIsJoining(false);
          }
        }
        return;
      }

      // Si pas de code dans l'URL mais qu'on a une session persistée
      if (!code && lobbyCode) {
        history.replace(`/lobby?code=${lobbyCode}`);
        return;
      }

      // Si vraiment aucun code n'est disponible
      if (!code && !lobbyCode) {
        await handleErrorWithUser('Code de partie non trouvé', null, ERROR_CONTEXTS.LOBBY_INIT);
        setIsLoading(false);
        setIsJoining(false);
        return;
      }

      setIsLoading(false);
    };

    fetchLobby();
  }, [location.search, lobbyCode, connectionStatus]);

  // Désactiver le loading quand on a les détails du jeu
  useEffect(() => {
    if (gameDetails && connectionStatus === 'connected') {
      setIsLoading(false);
      setIsJoining(false);
      setErrorCount(0); // Réinitialiser le compteur d'erreurs
      setError(null); // Effacer les erreurs précédentes
    }
  }, [gameDetails, connectionStatus]);

  // Timeout de sécurité pour éviter de rester bloqué en chargement (plus tolérant)
  useEffect(() => {
    if (connectionStatus === 'connecting' || connectionStatus === 'idle') {
      const timeout = setTimeout(() => {
        // Vérifier si on est toujours en train de se connecter après le délai
        if (connectionStatus === 'connecting' || connectionStatus === 'idle') {
          // Ne pas afficher d'erreur immédiatement si on a déjà des données
          if (!gameDetails) {
            setError('La connexion prend plus de temps que prévu. Veuillez patienter ou rafraîchir la page.');
            setIsLoading(false);
            setIsJoining(false);
          }
        }
      }, 60000); // 60 secondes (augmenté de 30 à 60)

      return () => clearTimeout(timeout);
    }
  }, [connectionStatus, gameDetails]);

  // Synchroniser l'état de visibilité de la page pour l'affichage local
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);


  useEffect(() => {
    if (gameDetails?.is_converging_phase && currentPlayer?.role) {
      if (currentPlayer.role === 'AGENT') {
        history.push(`/agent?code=${gameDetails.code}`);
      } else if (currentPlayer.role === 'ROGUE') {
        history.push(`/rogue?code=${gameDetails.code}`);
      }
    }
  }, [gameDetails?.is_converging_phase, currentPlayer?.role]);

  const checkRoleRequirements = () => {
    const currentAgents = players.filter((p) => p.role === 'AGENT').length;
    const currentRogues = players.filter((p) => p.role === 'ROGUE').length;
    const playersWithoutRole = players.filter((p) => !p.role).length;

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

  const handleRoleChange = async (playerId: string, newRole: string | null) => {
    try {
      await updatePlayer(playerId, { role: newRole });
    } catch (err) {
      await handleErrorWithUser('Erreur lors du changement de rôle', err, ERROR_CONTEXTS.ROLE_CHANGE);
    }
  };

  const handleLeaveLobby = () => {
    clearSession();
    history.push('/home');
  };

  const handleStartGame = async () => {
    try {
      const requirements = checkRoleRequirements();

      if (!requirements.agentsMet || !requirements.roguesMet) {
        return;
      }

      await updateGameDetails({
        is_converging_phase: true,
        started: true,
        started_date: new Date().toISOString()
      });
    } catch (error) {
      await handleErrorWithUser('Erreur lors du démarrage de la partie', error, ERROR_CONTEXTS.GAME_START);
    }
  };

  const renderPlayerLabel = (player: Player) => {
    return player.displayName || `Joueur ${player.id_player.slice(0, 4)}`;
  };

  const getConnectionBadge = () => {
    const badgeStyles = {
      display: 'inline-block',
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: '600',
      marginLeft: '8px',
      verticalAlign: 'middle'
    };

    switch (connectionStatus) {
      case 'connected':
        return (
          <span style={{ ...badgeStyles, backgroundColor: '#28a745', color: 'white' }}>
            🟢 Connecté
          </span>
        );
      case 'connecting':
        return (
          <span style={{ ...badgeStyles, backgroundColor: '#ffc107', color: '#000' }}>
            🟡 Connexion...
          </span>
        );
      case 'error':
        return (
          <span style={{ ...badgeStyles, backgroundColor: '#dc3545', color: 'white' }}>
            🔴 Erreur
          </span>
        );
      case 'idle':
        return (
          <span style={{ ...badgeStyles, backgroundColor: '#6c757d', color: 'white' }}>
            ⚪ Inactif
          </span>
        );
      default:
        return (
          <span style={{ ...badgeStyles, backgroundColor: '#6c757d', color: 'white' }}>
            ⚪ Inconnu
          </span>
        );
    }
  };

  return (
    <IonPage id="Lobby-page">
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Lobby</span>
              {getConnectionBadge()}
            </div>
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleLeaveLobby} color="danger">
              Quitter
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        {(isLoading || connectionStatus === 'connecting') && !error ? (
          <Loading 
            message={
              connectionStatus === 'connecting' 
                ? 'Connexion au serveur...' 
                : connectionStatus === 'error' && errorCount < 3
                ? `Tentative de reconnexion (${errorCount}/3)...`
                : loadingMessage
            } 
            progress={connectionStatus === 'connecting' ? 60 : 50} 
            showSpinner={true} 
          />
        ) : error ? (
          <>
            <IonCard color="warning" style={{ margin: '1rem' }}>
              <IonCardHeader>
                <IonCardTitle style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ⚠️ Problème de connexion
                </IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <IonText color="light">
                  <p>{error}</p>
                  <p style={{ marginTop: '8px', fontSize: '0.9em', opacity: 0.9 }}>
                    Vous pouvez continuer à attendre ou rafraîchir la page.
                  </p>
                </IonText>
                <IonButton 
                  expand="block" 
                  color="light" 
                  onClick={() => {
                    setError(null);
                    setErrorCount(0);
                    setIsLoading(true);
                  }} 
                  style={{ marginTop: '1rem' }}
                >
                  ⏳ Continuer à attendre
                </IonButton>
                <IonButton 
                  expand="block" 
                  color="light" 
                  fill="outline"
                  onClick={() => {
                    window.location.reload();
                  }} 
                  style={{ marginTop: '0.5rem' }}
                >
                  🔄 Rafraîchir la page
                </IonButton>
                <IonButton 
                  expand="block" 
                  color="light" 
                  fill="clear"
                  onClick={() => {
                    setError(null);
                    clearSession();
                    history.push('/home');
                  }} 
                  style={{ marginTop: '0.5rem' }}
                >
                  🏠 Retour à l'accueil
                </IonButton>
              </IonCardContent>
            </IonCard>
            
          </>
        ) : null}
        
        {gameDetails ? (
          <>
            {gameDetails.is_converging_phase && (
              <IonCard color="warning" style={{ margin: '1rem' }}>
                <IonCardHeader>
                  <IonCardTitle style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    ⚠️ Partie en cours
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonText color="light">
                    <p>Cette partie a déjà commencé.</p>
                  </IonText>
                  <IonButton
                    expand="block"
                    color="success"
                    onClick={() => {
                      if (currentPlayer?.role === 'AGENT') {
                        history.push(`/agent?code=${gameDetails.code}`);
                      } else if (currentPlayer?.role === 'ROGUE') {
                        history.push(`/rogue?code=${gameDetails.code}`);
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
                {props.map((objective: GameProp) => (
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
                      iconAnchor: [10, 10]
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
                        iconAnchor: [10, 10]
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
                      position={[
                        parseFloat(gameDetails.start_zone_rogue_latitude),
                        parseFloat(gameDetails.start_zone_rogue_longitude)
                      ]}
                      icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style="background-color: green; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                      })}
                    />
                    <Circle
                      center={[
                        parseFloat(gameDetails.start_zone_rogue_latitude),
                        parseFloat(gameDetails.start_zone_rogue_longitude)
                      ]}
                      radius={50}
                      pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 0.1 }}
                    />
                    </>
                  )}
              </MapContainer>
            </div>

            <IonCard>
              <IonCardHeader>
                <IonCardTitle>Joueurs ({players.length})</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  {players.map((player) => {
                    const isCurrentPlayer = player.id_player === playerId;
                    const isPlayerAway = player.status === 'away';
                    const isPlayerDisconnected = player.status === 'disconnected';
                    
                    const getPlayerConnectionColor = () => {
                      // Pour les joueurs déconnectés, afficher rouge
                      if (isPlayerDisconnected) return '#dc3545';
                      
                      // Pour les joueurs "away", afficher orange
                      if (isPlayerAway) return '#ff9800';
                      
                      if (!isCurrentPlayer) return '#28a745'; // Vert pour les autres joueurs
                      if (connectionStatus === 'connected') return '#28a745';
                      if (connectionStatus === 'error') return '#dc3545';
                      return '#6c757d';
                    };
                    
                    const getPlayerConnectionTitle = () => {
                      // Pour les joueurs déconnectés
                      if (isPlayerDisconnected) return 'Déconnecté (page fermée)';
                      
                      // Pour les joueurs "away"
                      if (isPlayerAway) return 'Absent (onglet inactif)';
                      
                      if (!isCurrentPlayer) return 'Connecté';
                      if (connectionStatus === 'connected') return 'Connecté';
                      if (connectionStatus === 'error') return 'Erreur de connexion';
                      return 'Inactif';
                    };
                    
                    return (
                      <IonItem key={player.id_player}>
                        <IonAvatar slot="start">
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              backgroundColor:
                                player.role === 'AGENT'
                                  ? '#3880ff'
                                  : player.role === 'ROGUE'
                                  ? '#ff4961'
                                  : '#6c757d',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                              fontWeight: 'bold',
                              position: 'relative'
                            }}
                          >
                            {player.role === 'AGENT' ? 'A' : player.role === 'ROGUE' ? 'R' : '?'}
                            <div
                              style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '14px',
                                height: '14px',
                                borderRadius: '50%',
                                backgroundColor: getPlayerConnectionColor(),
                                border: '2px solid white',
                                boxShadow: isCurrentPlayer && connectionStatus === 'connected' ? '0 0 4px rgba(40, 167, 69, 0.6)' : 'none'
                              }}
                              title={getPlayerConnectionTitle()}
                            />
                          </div>
                        </IonAvatar>
                        <IonLabel>
                          <h2 style={{ opacity: isPlayerDisconnected ? 0.4 : (isPlayerAway ? 0.6 : 1) }}>
                            {renderPlayerLabel(player)}
                            {isCurrentPlayer && (
                              <span
                                style={{
                                  color: '#667eea',
                                  fontSize: '0.8em',
                                  marginLeft: '8px',
                                  fontWeight: 'bold'
                                }}
                              >
                                (Vous)
                              </span>
                            )}
                            {player.is_admin && (
                              <span
                                style={{
                                  color: '#ff6b35',
                                  fontSize: '0.8em',
                                  marginLeft: '8px',
                                  fontWeight: 'bold'
                                }}
                              >
                                👑 Host
                              </span>
                            )}
                            {isPlayerDisconnected && (
                              <span
                                style={{
                                  color: '#dc3545',
                                  fontSize: '0.75em',
                                  marginLeft: '8px',
                                  fontWeight: 'normal',
                                  fontStyle: 'italic'
                                }}
                              >
                                ❌ Déconnecté
                              </span>
                            )}
                            {isPlayerAway && !isPlayerDisconnected && (
                              <span
                                style={{
                                  color: '#ff9800',
                                  fontSize: '0.75em',
                                  marginLeft: '8px',
                                  fontWeight: 'normal',
                                  fontStyle: 'italic'
                                }}
                              >
                                💤 Absent
                              </span>
                            )}
                          </h2>
                        {(currentPlayer?.is_admin || isHost) && (
                          <IonSelect
                            value={player.role || ''}
                            placeholder="Sélectionner un rôle"
                            interface="popover"
                            interfaceOptions={{
                              showBackdrop: false
                            }}
                            onIonChange={(e) => {
                              const newRole = e.detail.value || null;
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
                    );
                  })}
                </IonList>
              </IonCardContent>
            </IonCard>

            {(currentPlayer?.is_admin || isHost) && (
              <IonCard style={{ margin: '1rem' }}>
                <IonCardHeader>
                  <IonCardTitle>Prérequis pour démarrer</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  {(() => {
                    const requirements = checkRoleRequirements();
                    return (
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginBottom: '4px',
                            fontSize: '14px',
                            color: requirements.agentsMet ? '#28a745' : '#dc3545'
                          }}
                        >
                          <span>{requirements.agentsMet ? '✅' : '❌'}</span>
                          <span>
                            Agents: {requirements.currentAgents}/{requirements.minAgents}-{requirements.maxAgents}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginBottom: '4px',
                            fontSize: '14px',
                            color: requirements.roguesMet ? '#28a745' : '#dc3545'
                          }}
                        >
                          <span>{requirements.roguesMet ? '✅' : '❌'}</span>
                          <span>
                            Rogues: {requirements.currentRogues}/{requirements.minRogues}-{requirements.maxRogues}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '14px',
                            color: '#6c757d'
                          }}
                        >
                          <span>ℹ️</span>
                          <span>Sans rôle: {requirements.playersWithoutRole}</span>
                        </div>
                      </div>
                    );
                  })()}
                </IonCardContent>
              </IonCard>
            )}

            {(currentPlayer?.is_admin || isHost) && (
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

            <IonButton expand="block" onClick={() => setIsModalOpen(true)} className="ion-margin-bottom">
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
                      <p style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '2px' }}>{gameDetails.code}</p>
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
                      <p>{gameDetails.duration} secondes</p>
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
