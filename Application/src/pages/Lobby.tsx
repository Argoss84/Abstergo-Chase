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
  IonFab,
  IonFabButton,
  IonBadge,
  IonIcon,
  IonInput,
  IonFooter,
} from '@ionic/react';
import { chatbubbleOutline, chevronBackOutline } from 'ionicons/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import QRCode from '../components/QRCode';

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
    startGame,
    props,
    isHost,
    connectionStatus,
    clearSession,
    leaveLobby,
    requestLatestState,
    lobbyChatMessages,
    sendLobbyChat,
  } = useGameSession();
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [lastReadCount, setLastReadCount] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mapKey, setMapKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Connexion au lobby...');
  const [isJoining, setIsJoining] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden);
  const [copySuccess, setCopySuccess] = useState(false);
  const [syncButtonReady, setSyncButtonReady] = useState(false);
  const modalOpenRef = useRef<'details' | 'chat' | 'qr' | null>(null);
  const fromPopstateRef = useRef(false);
  const lobbyNotFoundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LOBBY_NOT_FOUND_DELAY_MS = 3000;
  const SYNC_BUTTON_DELAY_MS = 5000;

  useEffect(() => {
    return () => {
      if (lobbyNotFoundTimeoutRef.current) {
        clearTimeout(lobbyNotFoundTimeoutRef.current);
        lobbyNotFoundTimeoutRef.current = null;
      }
      if (syncDelayTimeoutRef.current) {
        clearTimeout(syncDelayTimeoutRef.current);
        syncDelayTimeoutRef.current = null;
      }
    };
  }, []);

  // Délai de 5 s avant d'afficher le bouton de synchronisation (depuis JoinLobby)
  const isWaitingForSync = connectionStatus === 'connected' && !!lobbyCode && !gameDetails;
  useEffect(() => {
    if (!isWaitingForSync) {
      setSyncButtonReady(false);
      if (syncDelayTimeoutRef.current) {
        clearTimeout(syncDelayTimeoutRef.current);
        syncDelayTimeoutRef.current = null;
      }
      return;
    }
    setSyncButtonReady(false);
    syncDelayTimeoutRef.current = setTimeout(() => {
      syncDelayTimeoutRef.current = null;
      setSyncButtonReady(true);
    }, SYNC_BUTTON_DELAY_MS);
    return () => {
      if (syncDelayTimeoutRef.current) {
        clearTimeout(syncDelayTimeoutRef.current);
        syncDelayTimeoutRef.current = null;
      }
    };
  }, [isWaitingForSync]);

  useWakeLock(true);
  const { vibrate, patterns } = useVibration();

  const currentPlayer = useMemo(
    () => players.find((player) => player.id_player === playerId),
    [players, playerId]
  );

  const msgs = lobbyChatMessages ?? [];
  const unreadCount = isChatModalOpen ? 0 : Math.max(0, msgs.length - lastReadCount);

  useEffect(() => {
    if (isChatModalOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isChatModalOpen, msgs.length]);

  const handleOpenChat = () => {
    window.history.pushState({ modal: 'chat' }, '', window.location.href);
    modalOpenRef.current = 'chat';
    setIsChatModalOpen(true);
    setLastReadCount(msgs.length);
  };

  const handleCloseChat = () => {
    setIsChatModalOpen(false);
    setLastReadCount(msgs.length);
  };

  const handleOpenDetailsModal = () => {
    window.history.pushState({ modal: 'details' }, '', window.location.href);
    modalOpenRef.current = 'details';
    setIsModalOpen(true);
  };

  const handleOpenQRModal = () => {
    window.history.pushState({ modal: 'qr' }, '', window.location.href);
    modalOpenRef.current = 'qr';
    setIsQRModalOpen(true);
  };

  const handleDismissModal = useCallback((modal: 'details' | 'chat' | 'qr') => {
    if (!fromPopstateRef.current) window.history.back();
    fromPopstateRef.current = false;
    modalOpenRef.current = null;
    if (modal === 'details') setIsModalOpen(false);
    else if (modal === 'chat') { setIsChatModalOpen(false); setLastReadCount(msgs.length); }
    else if (modal === 'qr') setIsQRModalOpen(false);
  }, [msgs.length]);

  const handleSendChat = () => {
    const t = chatInput.trim();
    if (!t) return;
    sendLobbyChat(t);
    setChatInput('');
  };

  const handleErrorWithUser = async (errorMessage: string, error?: any, context?: string) => {
    const errorResult = await handleError(errorMessage, error, {
      context: context || ERROR_CONTEXTS.GENERAL,
      shouldLog: false
    });
    setError(errorResult.message);
    return errorResult;
  };

  const handleCopyCode = async () => {
    if (gameDetails?.code) {
      try {
        await navigator.clipboard.writeText(gameDetails.code);
        setCopySuccess(true);
        vibrate(patterns.short);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        console.error('Erreur lors de la copie du code:', err);
      }
    }
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
            // Ne pas afficher "lobby n'existe plus" quand la partie se lance (redirection vers agent/rogue en cours)
            if (gameDetails?.is_converging_phase && currentPlayer?.role) {
              setIsLoading(false);
              return;
            }
            // Vérifier si c'est une erreur de lobby inexistant : attendre 3 s avant d'afficher l'erreur
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes('Lobby introuvable') || errorMessage.includes('inexistant')) {
              if (lobbyNotFoundTimeoutRef.current) clearTimeout(lobbyNotFoundTimeoutRef.current);
              lobbyNotFoundTimeoutRef.current = setTimeout(() => {
                lobbyNotFoundTimeoutRef.current = null;
                setError(`Le lobby "${code}" n'existe pas ou a été fermé.`);
              }, LOBBY_NOT_FOUND_DELAY_MS);
            } else {
              await handleErrorWithUser('Impossible de rejoindre le lobby', err, ERROR_CONTEXTS.LOBBY_INIT);
            }
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

  // Fermer les modales au lieu de naviguer lors du bouton retour (navigateur ou matériel)
  useEffect(() => {
    const onPopState = () => {
      fromPopstateRef.current = true;
      setIsModalOpen(false);
      setIsChatModalOpen(false);
      setIsQRModalOpen(false);
      modalOpenRef.current = null;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      e.detail.register(101, (processNextHandler: () => void) => {
        if (modalOpenRef.current) {
          const w = modalOpenRef.current;
          modalOpenRef.current = null;
          if (w === 'details') setIsModalOpen(false);
          else if (w === 'chat') { setIsChatModalOpen(false); setLastReadCount(msgs.length); }
          else if (w === 'qr') setIsQRModalOpen(false);
        } else {
          processNextHandler();
        }
      });
    };
    document.addEventListener('ionBackButton', handler as EventListener);
    return () => document.removeEventListener('ionBackButton', handler as EventListener);
  }, [msgs.length]);

  useEffect(() => {
    if (gameDetails?.is_converging_phase && currentPlayer?.role) {
      if (lobbyNotFoundTimeoutRef.current) {
        clearTimeout(lobbyNotFoundTimeoutRef.current);
        lobbyNotFoundTimeoutRef.current = null;
      }
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
    // Appeler leaveLobby pour informer le serveur et nettoyer la session
    leaveLobby();
    history.push('/home');
  };

  const handleStartGame = async () => {
    try {
      const requirements = checkRoleRequirements();

      if (!requirements.agentsMet || !requirements.roguesMet) {
        return;
      }

      await startGame();
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
        ) : error && !(gameDetails?.is_converging_phase && currentPlayer?.role) ? (
          <>
            <IonCard color={error.includes("n'existe pas") || error.includes("fermé") ? "danger" : "warning"} style={{ margin: '1rem' }}>
              <IonCardHeader>
                <IonCardTitle style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {error.includes("n'existe pas") || error.includes("fermé") ? '❌ Lobby introuvable' : '⚠️ Problème de connexion'}
                </IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <IonText color="light">
                  <p>{error}</p>
                  {error.includes("n'existe pas") || error.includes("fermé") ? (
                    <p style={{ marginTop: '8px', fontSize: '0.9em', opacity: 0.9 }}>
                      Ce lobby n'existe plus ou n'a jamais existé. Vérifiez le code ou demandez un nouveau lien.
                    </p>
                  ) : (
                    <p style={{ marginTop: '8px', fontSize: '0.9em', opacity: 0.9 }}>
                      Vous pouvez continuer à attendre ou rafraîchir la page.
                    </p>
                  )}
                </IonText>
                {error.includes("n'existe pas") || error.includes("fermé") ? (
                  <>
                    <IonButton 
                      expand="block" 
                      color="light" 
                      onClick={() => {
                        setError(null);
                        clearSession();
                        history.push('/join-lobby');
                      }} 
                      style={{ marginTop: '1rem' }}
                    >
                      🔍 Essayer un autre code
                    </IonButton>
                    <IonButton 
                      expand="block" 
                      color="light" 
                      fill="outline"
                      onClick={() => {
                        setError(null);
                        clearSession();
                        history.push('/home');
                      }} 
                      style={{ marginTop: '0.5rem' }}
                    >
                      🏠 Retour à l'accueil
                    </IonButton>
                  </>
                ) : (
                  <>
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
                  </>
                )}
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

            <IonCard style={{ margin: '1rem' }}>
              <IonCardHeader>
                <IonCardTitle style={{ fontSize: '16px', textAlign: 'center' }}>
                  Code de la partie
                </IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <div style={{
                  textAlign: 'center',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  letterSpacing: '4px',
                  padding: '16px',
                  backgroundColor: 'var(--ion-color-light)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  marginBottom: '16px'
                }}>
                  {gameDetails.code}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <IonButton 
                    expand="block" 
                    onClick={handleCopyCode}
                    color={copySuccess ? 'success' : 'primary'}
                    style={{ flex: 1 }}
                  >
                    {copySuccess ? '✅ Copié !' : '📋 Copier le code'}
                  </IonButton>
                  <IonButton 
                    expand="block" 
                    onClick={handleOpenQRModal}
                    color="secondary"
                    style={{ flex: 1 }}
                  >
                    📱 QR Code
                  </IonButton>
                </div>
              </IonCardContent>
            </IonCard>

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

            <IonButton expand="block" onClick={handleOpenDetailsModal} className="ion-margin-bottom">
              Détails Partie
            </IonButton>

            {!gameDetails.is_converging_phase && (
              <IonFab slot="fixed" vertical="bottom" horizontal="end" style={{ marginBottom: '16px', marginEnd: '16px', overflow: 'visible' }}>
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <IonFabButton onClick={handleOpenChat} color="primary">
                    <IonIcon icon={chatbubbleOutline} />
                  </IonFabButton>
                  {unreadCount > 0 && (
                    <IonBadge
                      color="danger"
                      style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        minWidth: '22px',
                        height: '22px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        padding: '0 6px',
                        borderRadius: '11px',
                        zIndex: 10,
                      }}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </IonBadge>
                  )}
                </div>
              </IonFab>
            )}

            <IonModal isOpen={isChatModalOpen} onDidDismiss={() => handleDismissModal('chat')}>
              <IonHeader>
                <IonToolbar>
                  <IonButtons slot="start">
                    <IonButton fill="clear" onClick={() => { handleCloseChat(); }}>
                      <IonIcon icon={chevronBackOutline} />
                    </IonButton>
                  </IonButtons>
                  <IonTitle>Chat du lobby</IonTitle>
                  <IonButtons slot="end">
                    <IonButton onClick={handleCloseChat}>Fermer</IonButton>
                  </IonButtons>
                </IonToolbar>
              </IonHeader>
              <IonContent className="ion-padding">
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: '240px' }}>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {msgs.length === 0 && (
                      <IonText color="medium" style={{ textAlign: 'center', padding: '24px', fontSize: '14px' }}>
                        Aucun message. Envoyez le premier !
                      </IonText>
                    )}
                    {msgs.map((m) => {
                      const isMe = m.playerId === playerId;
                      return (
                        <div
                          key={`${m.timestamp}-${m.playerId}`}
                          style={{
                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                            maxWidth: '85%',
                            padding: '8px 12px',
                            borderRadius: '12px',
                            backgroundColor: isMe ? 'var(--ion-color-primary)' : 'var(--ion-color-light)',
                            color: isMe ? 'var(--ion-color-primary-contrast)' : 'var(--ion-color-dark)',
                          }}
                        >
                          <div style={{ fontSize: '11px', opacity: 0.9, marginBottom: '2px' }}>
                            {isMe ? 'Vous' : m.playerName}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
                          <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
                            {new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </IonContent>
              <IonFooter>
                <IonToolbar>
                  <div style={{ display: 'flex', gap: '8px', padding: '8px', alignItems: 'center' }}>
                    <IonInput
                      value={chatInput}
                      onIonInput={(e) => setChatInput(String(e.detail.value ?? ''))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendChat(); } }}
                      placeholder="Votre message..."
                      style={{ flex: 1, '--padding-start': '12px' } as React.CSSProperties}
                      clearOnEdit={false}
                    />
                    <IonButton onClick={handleSendChat} disabled={!chatInput.trim()} color="primary">
                      Envoyer
                    </IonButton>
                  </div>
                </IonToolbar>
              </IonFooter>
            </IonModal>

            <IonModal isOpen={isQRModalOpen} onDidDismiss={() => handleDismissModal('qr')}>
              <IonHeader>
                <IonToolbar>
                  <IonButtons slot="start">
                    <IonButton fill="clear" onClick={() => setIsQRModalOpen(false)}>
                      <IonIcon icon={chevronBackOutline} />
                    </IonButton>
                  </IonButtons>
                  <IonTitle>QR Code - Rejoindre la partie</IonTitle>
                  <IonButtons slot="end">
                    <IonButton onClick={() => setIsQRModalOpen(false)}>Fermer</IonButton>
                  </IonButtons>
                </IonToolbar>
              </IonHeader>
              <IonContent className="ion-padding">
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  minHeight: '100%',
                  padding: '20px'
                }}>
                  <IonText color="medium" style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <h2>Scannez ce QR Code pour rejoindre la partie</h2>
                    <p>Le code sera automatiquement pré-rempli</p>
                  </IonText>
                  
                  <QRCode 
                    value={`${window.location.origin}/join-lobby?code=${gameDetails.code}`}
                    size={280}
                    level="H"
                  />
                  
                  <div style={{
                    marginTop: '30px',
                    textAlign: 'center',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    letterSpacing: '4px',
                    fontFamily: 'monospace',
                    padding: '16px',
                    backgroundColor: 'var(--ion-color-light)',
                    borderRadius: '8px',
                    width: '100%',
                    maxWidth: '300px'
                  }}>
                    {gameDetails.code}
                  </div>

                  <IonButton 
                    expand="block" 
                    onClick={handleCopyCode}
                    color={copySuccess ? 'success' : 'primary'}
                    style={{ marginTop: '20px', maxWidth: '300px', width: '100%' }}
                  >
                    {copySuccess ? '✅ Code copié !' : '📋 Copier le code'}
                  </IonButton>
                </div>
              </IonContent>
            </IonModal>

            <IonModal isOpen={isModalOpen} onDidDismiss={() => handleDismissModal('details')}>
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
                    <IonLabel>
                      <h2>Code de la partie</h2>
                      <div style={{ 
                        marginTop: '12px',
                        fontSize: '24px', 
                        fontWeight: 'bold', 
                        letterSpacing: '4px',
                        fontFamily: 'monospace'
                      }}>
                        {gameDetails.code}
                      </div>
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
        ) : isWaitingForSync ? (
          syncButtonReady ? (
            <IonCard style={{ margin: '1rem' }}>
              <IonCardHeader>
                <IonCardTitle>En attente des données du lobby...</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <IonText>
                  <p>Connexion établie. En attente de la synchronisation des données du lobby.</p>
                </IonText>
                <IonButton 
                  expand="block" 
                  color="primary"
                  onClick={() => requestLatestState()} 
                  style={{ marginTop: '1rem' }}
                >
                  🔄 Demander la synchronisation
                </IonButton>
              </IonCardContent>
            </IonCard>
          ) : (
            <Loading 
              message="Synchronisation des données du lobby..." 
              progress={50} 
              showSpinner={true} 
            />
          )
        ) : null}
      </IonContent>
    </IonPage>
  );
};

export default Lobby;
