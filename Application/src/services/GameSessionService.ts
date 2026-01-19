import { io, Socket } from 'socket.io-client';
import { GameDetails, GameProp, Player } from '../components/Interfaces';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type SessionScope = 'lobby' | 'game';

interface SessionState {
  lobbyCode: string | null;
  gameCode: string | null;
  playerId: string | null;
  playerName: string;
  isHost: boolean;
  players: Player[];
  gameDetails: GameDetails | null;
  props: GameProp[];
  connectionStatus: ConnectionStatus;
  sessionScope: SessionScope;
}

interface PersistedSessionData {
  lobbyCode: string;
  gameCode?: string | null;
  playerId: string;
  playerName: string;
  isHost: boolean;
  sessionScope?: SessionScope;
  timestamp: number;
  gameDetails?: GameDetails | null;
  players?: Player[];
  props?: GameProp[];
}

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

const SESSION_STORAGE_KEY = 'abstergo-game-session';
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 heures

const defaultPlayerName = () => {
  const stored = localStorage.getItem('abstergo-player-name');
  if (stored) return stored;
  const fallback = `Joueur-${Math.floor(Math.random() * 9999)}`;
  localStorage.setItem('abstergo-player-name', fallback);
  return fallback;
};

const createInitialState = (): SessionState => ({
  lobbyCode: null,
  gameCode: null,
  playerId: null,
  playerName: defaultPlayerName(),
  isHost: false,
  players: [],
  gameDetails: null,
  props: [],
  connectionStatus: 'idle',
  sessionScope: 'lobby'
});

interface PendingAction {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
}

class GameSessionService {
  private state: SessionState = createInitialState();
  private listeners = new Set<(state: SessionState) => void>();
  private socket: Socket | null = null;
  private socketReady: Promise<void> | null = null;
  private pendingActions = new Map<string, PendingAction>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private hostChannel: RTCDataChannel | null = null;
  private reconnectAttempts = new Map<string, number>();
  private rejoinInFlight = false;
  private joinInProgress = false;
  private hostReconnectInProgress = false;
  private gameRejoinInFlight = false;
  private gameJoinInProgress = false;
  private gameHostReconnectInProgress = false;
  private lastStatusUpdate = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      // Restaurer la session si elle existe
      this.restoreSession();

      if ((this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
        this.ensureSocket().catch(() => {
          this.updateState({ connectionStatus: 'error' });
        });
      }
      
      window.addEventListener('visibilitychange', () => {
        // Gérer le changement de visibilité de la page
        if (!document.hidden) {
          // Quand l'utilisateur revient sur la page
          if ((this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
            // D'abord vérifier la connexion socket avant de mettre à jour le statut
            if (!this.socket?.connected) {
              // Ne pas déclencher de reconnexion pour le host si le socket se reconnecte automatiquement
              // Socket.io va gérer la reconnexion automatiquement
              console.log('Socket en cours de reconnexion automatique...');
            } else {
              // Socket connecté, mettre à jour le statut à "active"
              this.updatePlayerStatus('active');
              
              // Vérifier que tout est synchronisé
              if (this.state.isHost) {
                // Pour le host, rétablir les connexions WebRTC si nécessaire
                if (this.dataChannels.size === 0 && this.state.players.length > 1) {
                  this.reestablishAllPeerConnections();
                }
              } else {
                this.requestResync('visibilitychange');
              }
            }
          }
        } else {
          // Quand l'utilisateur quitte la page - marquer comme away
          if ((this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
            // Mettre à jour le statut à "away" (via WebRTC ET socket.io)
            this.updatePlayerStatus('away');
          }
        }
      });
      window.addEventListener('beforeunload', () => {
        // Marquer le joueur comme déconnecté avant de fermer
        if ((this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
          // Utiliser sendBeacon pour envoyer le message même si la page se ferme
          const url = window.location.hostname === 'localhost'
            ? 'http://localhost:5174'
            : 'https://ws.abstergochase.fr';
          
          // Essayer d'envoyer via socket si disponible (synchrone)
          if (this.socket?.connected) {
            this.sendSocket('player:status-update', { status: 'disconnected' });
          }
        }
        
        // Ne pas nettoyer la session, juste les connexions
        this.cleanupConnections();
      });
    }
  }

  subscribe(listener: (state: SessionState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  setPlayerName(name: string) {
    if (!name.trim()) return;
    localStorage.setItem('abstergo-player-name', name.trim());
    this.updateState({ playerName: name.trim() });
  }

  clearSession() {
    console.log('Nettoyage complet de la session utilisateur');
    
    // Informer le serveur qu'on quitte le lobby (si connecté)
    if ((this.state.lobbyCode || this.state.gameCode) && this.socket?.connected) {
      this.sendSocket('player:status-update', { status: 'disconnected' });
    }
    
    // Nettoyer localStorage
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.clearObjectiveCirclesSession();
    
    // Réinitialiser la session
    this.resetSession();
  }
  
  // Nouvelle méthode pour forcer la sortie d'un lobby sans nettoyer le nom du joueur
  leaveLobby() {
    console.log('Sortie du lobby actuel');
    
    // Informer le serveur qu'on quitte définitivement le lobby (si connecté)
    if (this.state.lobbyCode && this.socket?.connected) {
      this.sendSocket('lobby:leave', { 
        lobbyCode: this.state.lobbyCode,
        playerId: this.state.playerId
      });
    }
    
    // Nettoyer localStorage
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.clearObjectiveCirclesSession();
    
    // Nettoyer les connexions mais garder le socket
    this.cleanupConnections();
    
    // Réinitialiser seulement les données du lobby, pas le nom du joueur
    const playerName = this.state.playerName;
    this.updateState({
      lobbyCode: null,
      gameCode: null,
      playerId: null,
      isHost: false,
      players: [],
      gameDetails: null,
      props: [],
      connectionStatus: this.socket?.connected ? 'connected' : 'idle',
      sessionScope: 'lobby'
    });
    this.state.playerName = playerName;
  }

  leaveGame() {
    console.log('Sortie de la partie en cours');

    if (this.state.gameCode && this.socket?.connected) {
      this.sendSocket('game:leave', {
        gameCode: this.state.gameCode,
        playerId: this.state.playerId
      });
    }

    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.clearObjectiveCirclesSession();
    this.cleanupConnections();

    const playerName = this.state.playerName;
    this.updateState({
      lobbyCode: null,
      gameCode: null,
      playerId: null,
      isHost: false,
      players: [],
      gameDetails: null,
      props: [],
      connectionStatus: this.socket?.connected ? 'connected' : 'idle',
      sessionScope: 'lobby'
    });
    this.state.playerName = playerName;
  }

  hasPersistedSession(): boolean {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return false;
    
    try {
      const data: PersistedSessionData = JSON.parse(stored);
      const age = Date.now() - data.timestamp;
      return age < SESSION_EXPIRY_MS;
    } catch {
      return false;
    }
  }

  disconnectSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.socketReady = null;
    }
    this.updateState({ connectionStatus: 'idle' });
  }


  async createLobby(gameDetails: GameDetails, props: GameProp[]) {
    try {
      // Nettoyer toute session existante avant de créer un nouveau lobby
      if (this.state.lobbyCode || this.state.gameCode || this.state.playerId) {
        console.log('Nettoyage de la session existante avant création d\'un nouveau lobby');
        this.cleanupConnections();
        localStorage.removeItem(SESSION_STORAGE_KEY);
        this.clearObjectiveCirclesSession();
        // Réinitialiser l'état mais garder le nom du joueur
        const playerName = this.state.playerName;
        this.state = {
          ...createInitialState(),
          playerName
        };
      }
      
      await this.ensureSocket();
      
      this.sendSocket('lobby:create', {
        playerName: this.state.playerName
      });

      const response = await this.waitFor('lobby:created', 15000);
      
      const lobbyCode = response.code as string;
      const playerId = response.playerId as string;

    const hostPlayer: Player = {
      id_player: playerId,
      user_id: playerId,
      id_game: gameDetails.id_game,
      created_at: new Date().toISOString(),
      latitude: null,
      longitude: null,
      color: null,
      role: null,
      isInStartZone: null,
      IsReady: null,
      status: 'active', // Host est actif par défaut
      updated_at: null,
      is_admin: true,
      displayName: this.state.playerName
    };

    const updatedGameDetails = {
      ...gameDetails,
      code: lobbyCode,
      props,
      players: [hostPlayer]
    };

    this.updateState({
      lobbyCode,
      gameCode: null,
      playerId,
      isHost: true,
      players: [hostPlayer],
      gameDetails: updatedGameDetails,
      props,
      connectionStatus: 'connected',
      sessionScope: 'lobby'
    });

    // Informer le serveur socket.io que le joueur est actif
    this.sendSocket('player:status-update', { status: 'active' });

    return lobbyCode;
    } catch (error) {
      throw error;
    }
  }

  async joinLobby(code: string) {
    // Éviter les appels concurrents
    if (this.joinInProgress || this.rejoinInFlight || this.hostReconnectInProgress) {
      return;
    }

    // Si on est déjà connecté au bon lobby, ne rien faire
    if (this.state.lobbyCode === code && this.state.connectionStatus === 'connected') {
      return;
    }

    // Si c'est le host qui se reconnecte, utiliser la logique de reconnexion du host
    const isReconnectingHost = this.state.isHost && this.state.lobbyCode === code && this.state.playerId;
    if (isReconnectingHost) {
      await this.reconnectToLobby();
      return;
    }

    this.joinInProgress = true;
    try {
      await this.ensureSocket();
      
      // Si on a un ancien playerId et qu'on rejoint le même lobby, c'est une reconnexion
      const isReconnecting = this.state.lobbyCode === code && this.state.playerId;
      
      // Si on rejoint un NOUVEAU lobby différent de l'actuel, nettoyer l'ancienne session
      if (this.state.lobbyCode && this.state.lobbyCode !== code) {
        console.log(`Nettoyage de l'ancienne session (lobby ${this.state.lobbyCode}) avant de rejoindre le nouveau lobby ${code}`);
        this.cleanupConnections();
        // Ne pas supprimer de localStorage pour l'instant, on va le mettre à jour
      }
      
      this.sendSocket('lobby:join', {
        code,
        playerName: this.state.playerName,
        // Envoyer l'ancien playerId si c'est une reconnexion
        oldPlayerId: isReconnecting ? this.state.playerId : undefined
      });

      const response = await this.waitFor('lobby:joined');
      
      this.updateState({
        lobbyCode: response.code,
        gameCode: null,
        playerId: response.playerId,
        isHost: response.playerId === response.hostId,
        connectionStatus: 'connected',
        sessionScope: 'lobby'
      });

      // Informer le serveur socket.io que le joueur est actif
      this.sendSocket('player:status-update', { status: 'active' });
    } catch (error) {
      // Propager l'erreur pour qu'elle soit gérée par l'appelant
      this.joinInProgress = false;
      throw error;
    } finally {
      this.joinInProgress = false;
    }
  }

  async startGame() {
    if (!this.state.isHost || !this.state.lobbyCode || !this.state.gameDetails) {
      return;
    }

    await this.ensureSocket();

    const updatedGameDetails = {
      ...this.state.gameDetails,
      is_converging_phase: true,
      started: true,
      started_date: new Date().toISOString()
    } as GameDetails;

    this.updateState({ gameDetails: updatedGameDetails });

    this.sendSocket('game:create', { code: this.state.lobbyCode });
    const response = await this.waitFor('game:created', 15000);

    this.cleanupConnections();
    this.updateState({
      lobbyCode: null,
      gameCode: response.code,
      playerId: response.playerId,
      isHost: true,
      connectionStatus: 'connected',
      sessionScope: 'game',
      gameDetails: updatedGameDetails
    });

    await this.reestablishAllPeerConnections();
  }

  async joinGame(code: string) {
    if (this.gameJoinInProgress || this.gameRejoinInFlight || this.gameHostReconnectInProgress) {
      return;
    }

    if (this.state.gameCode === code && this.state.sessionScope === 'game' && this.state.connectionStatus === 'connected') {
      return;
    }

    this.gameJoinInProgress = true;
    try {
      await this.ensureSocket();
      this.cleanupConnections();

      const isReconnecting = this.state.gameCode === code && this.state.playerId;

      this.sendSocket('game:join', {
        code,
        playerName: this.state.playerName,
        oldPlayerId: isReconnecting ? this.state.playerId : undefined
      });

      const response = await this.waitFor('game:joined');

      this.updateState({
        lobbyCode: null,
        gameCode: response.code,
        playerId: response.playerId,
        isHost: response.playerId === response.hostId,
        connectionStatus: 'connected',
        sessionScope: 'game'
      });

      this.sendSocket('player:status-update', { status: 'active' });
    } finally {
      this.gameJoinInProgress = false;
    }
  }

  private transitionToGame(code: string) {
    if (this.state.isHost) {
      return;
    }
    if (this.state.sessionScope === 'game' && this.state.gameCode === code) {
      return;
    }
    this.joinGame(code);
  }

  async updateGameDetails(partial: Partial<GameDetails>) {
    if (this.state.isHost) {
      if (!this.state.gameDetails) return;
      const updated = {
        ...this.state.gameDetails,
        ...partial
      } as GameDetails;
      this.updateState({ gameDetails: updated });
      this.broadcastState();
    } else {
      this.sendAction('action:update-game', { changes: partial });
    }
  }

  async updatePlayer(playerId: string, partial: Partial<Player>) {
    if (this.state.isHost) {
      if (!this.state.gameDetails) return;
      const players = this.state.players.map((player) =>
        player.id_player === playerId ? { ...player, ...partial } : player
      );
      this.updateState({ players, gameDetails: { ...this.state.gameDetails!, players } });
      this.broadcastState();
      if (partial.role !== undefined) {
        this.sendSocket('player:role-update', { playerId, role: partial.role });
      }
    } else {
      this.sendAction('action:update-player', { playerId, changes: partial });
    }
  }

  // Méthode dédiée pour mettre à jour le statut du joueur local
  private updatePlayerStatus(status: string) {
    if (!this.state.playerId || !this.state.gameDetails) return;
    
    // Throttle: éviter les mises à jour trop fréquentes (max 1 par seconde)
    const now = Date.now();
    if (now - this.lastStatusUpdate < 1000) {
      return;
    }
    this.lastStatusUpdate = now;
    
    // Vérifier que le statut a vraiment changé
    const currentPlayer = this.state.players.find(p => p.id_player === this.state.playerId);
    if (currentPlayer?.status === status) {
      return; // Pas de changement, ne rien faire
    }
    
    // Mettre à jour localement
    const players = this.state.players.map((player) =>
      player.id_player === this.state.playerId ? { ...player, status } : player
    );
    
    this.updateState({ 
      players, 
      gameDetails: { ...this.state.gameDetails, players } 
    });
    
    // Si on est le host, broadcaster aux autres
    if (this.state.isHost) {
      this.broadcastState();
    } else {
      // Si on est un peer, envoyer au host via WebRTC
      this.sendAction('action:update-player', { 
        playerId: this.state.playerId, 
        changes: { status } 
      });
    }
    
    // Envoyer aussi au serveur socket.io pour le monitoring
    this.sendSocket('player:status-update', { status });
  }

  async updateProp(propId: number, partial: Partial<GameProp>) {
    if (this.state.isHost) {
      if (!this.state.gameDetails) return;
      const props = this.state.props.map((prop) =>
        prop.id_prop === propId ? { ...prop, ...partial } : prop
      );
      this.updateState({ props, gameDetails: { ...this.state.gameDetails!, props } });
      this.broadcastState();
    } else {
      this.sendAction('action:update-prop', { propId, changes: partial });
    }
  }

  async requestLatestState() {
    if (this.state.isHost) {
      // Le host a déjà l'état, demander juste un refresh des connexions WebRTC
      this.broadcastState();
    } else {
      // Demande un resync via socket pour garantir un fallback
      this.requestResync('manual-state-request');
      this.sendAction('action:request-state', {});
    }
  }

  private persistSession() {
    if ((!this.state.lobbyCode && !this.state.gameCode) || !this.state.playerId) {
      return;
    }

    const data: PersistedSessionData = {
      lobbyCode: this.state.lobbyCode || this.state.gameCode || '',
      gameCode: this.state.gameCode,
      playerId: this.state.playerId,
      playerName: this.state.playerName,
      isHost: this.state.isHost,
      sessionScope: this.state.sessionScope,
      timestamp: Date.now(),
      gameDetails: this.state.gameDetails,
      players: this.state.players,
      props: this.state.props
    };

    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      // Erreur silencieuse
    }
  }

  private restoreSession() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;

    try {
      const data: PersistedSessionData = JSON.parse(stored);
      const age = Date.now() - data.timestamp;

      // Vérifier l'expiration
      if (age > SESSION_EXPIRY_MS) {
        console.log('Session expirée, suppression');
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      
      // Validation des données essentielles
      if ((!data.lobbyCode && !data.gameCode) || !data.playerId || !data.playerName) {
        console.warn('Session invalide (données manquantes), suppression');
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      
      console.log(`Restauration de la session: lobby ${data.lobbyCode}, joueur ${data.playerName}`);
      
      // Restaurer tous les états y compris gameDetails, players et props
      const restoredScope = data.sessionScope || 'lobby';
      const stateUpdate: Partial<SessionState> = {
        lobbyCode: restoredScope === 'lobby' ? data.lobbyCode : null,
        gameCode: restoredScope === 'game' ? data.gameCode || data.lobbyCode : null,
        playerId: data.playerId,
        playerName: data.playerName,
        isHost: data.isHost,
        sessionScope: restoredScope
      };

      // Restaurer les données du jeu si elles existent (important pour le host)
      if (data.gameDetails) {
        stateUpdate.gameDetails = data.gameDetails;
      }
      if (data.players && Array.isArray(data.players)) {
        stateUpdate.players = data.players;
      }
      if (data.props && Array.isArray(data.props)) {
        stateUpdate.props = data.props;
      }

      this.state = { ...this.state, ...stateUpdate };
      this.listeners.forEach((listener) => listener(this.state));
    } catch (error) {
      console.error('Erreur lors de la restauration de la session:', error);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  private async reconnectToLobby() {
    if (!this.state.lobbyCode || !this.state.playerId) {
      return;
    }

    // Éviter les reconnexions multiples simultanées
    if (this.hostReconnectInProgress || this.joinInProgress || this.rejoinInFlight) {
      return;
    }
    
    try {
      await this.ensureSocket();
      
      if (this.state.isHost) {
        this.hostReconnectInProgress = true;
        
        // Pour le host, essayer de se reconnecter
        this.sendSocket('lobby:rejoin-host', {
          code: this.state.lobbyCode,
          playerId: this.state.playerId,
          playerName: this.state.playerName
        });
        
        // Attendre la réponse de reconnexion
        try {
          const response = await this.waitFor('lobby:joined', 10000);
          
          // Mettre à jour le playerId si changé
          const oldPlayerId = this.state.playerId;
          const newPlayerId = response.playerId;
          
          // Mettre à jour la liste des joueurs pour refléter le changement de playerId du host
          const updatedPlayers = this.state.players.map((player) => 
            player.id_player === oldPlayerId 
              ? { ...player, id_player: newPlayerId, user_id: newPlayerId }
              : player
          );
          
          // Mettre à jour gameDetails avec la nouvelle liste de joueurs
          const updatedGameDetails = this.state.gameDetails 
            ? { ...this.state.gameDetails, players: updatedPlayers }
            : null;
          
          this.updateState({
            playerId: newPlayerId,
            players: updatedPlayers,
            gameDetails: updatedGameDetails,
            connectionStatus: 'connected'
          });
          
          // Fermer toutes les anciennes connexions WebRTC
          this.peerConnections.forEach((pc) => pc.close());
          this.peerConnections.clear();
          this.dataChannels.clear();
          this.reconnectAttempts.clear();
          
          // Rétablir les connexions WebRTC avec tous les joueurs existants
          await this.reestablishAllPeerConnections();
        } catch (error) {
          this.updateState({ connectionStatus: 'error' });
        } finally {
          this.hostReconnectInProgress = false;
        }
      } else {
        // Pour les autres joueurs, rejoindre normalement
        await this.attemptRejoin();
      }
    } catch (error) {
      this.updateState({ connectionStatus: 'error' });
      this.hostReconnectInProgress = false;
    }
  }

  private async reconnectToGame() {
    if (!this.state.gameCode || !this.state.playerId) {
      return;
    }

    if (this.gameHostReconnectInProgress || this.gameJoinInProgress || this.gameRejoinInFlight) {
      return;
    }

    try {
      await this.ensureSocket();

      if (this.state.isHost) {
        this.gameHostReconnectInProgress = true;

        this.sendSocket('game:rejoin-host', {
          code: this.state.gameCode,
          playerId: this.state.playerId,
          playerName: this.state.playerName
        });

        try {
          const response = await this.waitFor('game:joined', 10000);

          const oldPlayerId = this.state.playerId;
          const newPlayerId = response.playerId;

          const updatedPlayers = this.state.players.map((player) =>
            player.id_player === oldPlayerId
              ? { ...player, id_player: newPlayerId, user_id: newPlayerId }
              : player
          );

          const updatedGameDetails = this.state.gameDetails
            ? { ...this.state.gameDetails, players: updatedPlayers }
            : null;

          this.updateState({
            playerId: newPlayerId,
            players: updatedPlayers,
            gameDetails: updatedGameDetails,
            connectionStatus: 'connected',
            sessionScope: 'game'
          });

          this.cleanupConnections();
          await this.reestablishAllPeerConnections();
        } catch (error) {
          this.updateState({ connectionStatus: 'error' });
        } finally {
          this.gameHostReconnectInProgress = false;
        }
      } else {
        await this.attemptGameRejoin();
      }
    } catch (error) {
      this.updateState({ connectionStatus: 'error' });
      this.gameHostReconnectInProgress = false;
    }
  }

  private updateState(partial: Partial<SessionState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener(this.state));
    
    // Persister la session si on a un lobby actif
    if ((this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
      this.persistSession();
    }
  }


  private async ensureSocket() {
    if (this.socket?.connected) {
      return;
    }

    if (this.socketReady) {
      return this.socketReady;
    }

    const defaultUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:5174'
      : 'https://ws.abstergochase.fr';
    const url = defaultUrl;
    const path = '/socket.io';
    this.updateState({ connectionStatus: 'connecting' });

    this.socket = io(url, {
      path,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['polling', 'websocket']
    });
    this.socketReady = new Promise((resolve, reject) => {
      if (!this.socket) return reject();

      this.socket.on('connect', () => {
        this.updateState({ connectionStatus: 'connected' });
        resolve();
        this.handleSocketReconnect();
        
        // Si on est sur la page et qu'on a un lobby, mettre à jour le statut à "active"
        if (!document.hidden && (this.state.lobbyCode || this.state.gameCode) && this.state.playerId) {
          // Attendre un peu que la connexion soit stable
          setTimeout(() => {
            this.updatePlayerStatus('active');
          }, 500);
        }
      });

      this.socket.on('connect_error', (error: Error) => {
        console.warn('Erreur de connexion socket.io (réessai automatique):', error);
        // Ne pas passer en 'error' immédiatement, laisser socket.io réessayer
        // On ne met en 'error' que si vraiment toutes les tentatives échouent
      });

      this.socket.on('message', (message: { type: string; payload: any }) => this.handleSocketMessage(message));
      this.socket.on('disconnect', (reason) => {
        console.log('Socket déconnecté, raison:', reason);
        // Ne pas mettre en 'error' si c'est juste une déconnexion normale ou transport
        // Socket.io va gérer la reconnexion automatique
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          this.updateState({ connectionStatus: 'idle' });
        } else {
          // Pour les autres raisons (transport close, etc), rester en connecting
          // car socket.io va réessayer automatiquement
          this.updateState({ connectionStatus: 'connecting' });
        }
      });
    });

    return this.socketReady;
  }

  private waitFor(type: string, timeoutMs: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(type);
        reject(new Error(`Timeout en attente du message: ${type}`));
      }, timeoutMs);

      this.pendingActions.set(type, {
        resolve: (payload: any) => {
          clearTimeout(timeout);
          resolve(payload);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private sendSocket(type: string, payload: Record<string, any>) {
    if (!this.socket) {
      return;
    }
    
    if (!this.socket.connected) {
      return;
    }
    
    const message = { type, payload };
    this.socket.emit('message', message);
  }

  private handleSocketMessage(message: { type: string; payload: any }) {
    const { type, payload } = message;

    if (this.pendingActions.has(type)) {
      const action = this.pendingActions.get(type)!;
      this.pendingActions.delete(type);
      action.resolve(payload);
      return;
    }

    // Gérer les erreurs de lobby
    if (type === 'lobby:error') {
      // Trouver la promise en attente et la rejeter
      const waitingTypes = ['lobby:joined', 'lobby:created'];
      for (const waitingType of waitingTypes) {
        if (this.pendingActions.has(waitingType)) {
          const action = this.pendingActions.get(waitingType)!;
          this.pendingActions.delete(waitingType);
          action.reject(new Error(payload?.message || 'Erreur de lobby'));
          break;
        }
      }
      return;
    }

    if (type === 'game:error') {
      const waitingTypes = ['game:joined', 'game:created'];
      for (const waitingType of waitingTypes) {
        if (this.pendingActions.has(waitingType)) {
          const action = this.pendingActions.get(waitingType)!;
          this.pendingActions.delete(waitingType);
          action.reject(new Error(payload?.message || 'Erreur de partie'));
          break;
        }
      }
      return;
    }

    if (type === 'lobby:peer-joined' && this.state.isHost) {
      this.handlePeerJoined(payload.playerId, payload.playerName);
      return;
    }

    if (type === 'game:peer-joined' && this.state.isHost) {
      this.handlePeerJoined(payload.playerId, payload.playerName);
      return;
    }

    if (type === 'lobby:peer-reconnected' && this.state.isHost) {
      this.handlePeerReconnected(payload.playerId, payload.playerName);
      return;
    }

    if (type === 'game:peer-reconnected' && this.state.isHost) {
      this.handlePeerReconnected(payload.playerId, payload.playerName);
      return;
    }

    if (type === 'lobby:peer-left' && this.state.isHost) {
      this.handlePeerLeft(payload.playerId);
      return;
    }

    if (type === 'game:peer-left' && this.state.isHost) {
      this.handlePeerLeft(payload.playerId);
      return;
    }

    if (type === 'lobby:host-reconnected') {
      this.handleHostReconnected(payload.newHostId);
      return;
    }

    if (type === 'game:host-reconnected') {
      this.handleHostReconnected(payload.newHostId);
      return;
    }

    if (type === 'lobby:closed') {
      this.resetSession();
      return;
    }

    if (type === 'game:closed') {
      this.resetSession();
      return;
    }

    if (type === 'game:started') {
      const code = payload?.code;
      if (code) {
        this.transitionToGame(code);
      }
      return;
    }

    if (type === 'webrtc:signal') {
      this.handleSignal(payload.fromId, payload.signal);
      return;
    }

    if (type === 'game:signal') {
      this.handleSignal(payload.fromId, payload.signal);
      return;
    }

    if (type === 'lobby:request-resync' && this.state.isHost) {
      this.handleResyncRequest(payload?.playerId);
      return;
    }

    if (type === 'game:request-resync' && this.state.isHost) {
      this.handleResyncRequest(payload?.playerId);
      return;
    }

    if (type === 'state:sync') {
      this.handleStateSync(payload);
      return;
    }

    if (type === 'action:relay' && this.state.isHost) {
      this.handleActionMessage(payload?.action);
    }

    if (type === 'game:action-relay' && this.state.isHost) {
      this.handleActionMessage(payload?.action);
    }
  }

  private resetSession() {
    this.cleanupConnections();
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.clearObjectiveCirclesSession();
    this.updateState({
      lobbyCode: null,
      gameCode: null,
      playerId: null,
      isHost: false,
      players: [],
      gameDetails: null,
      props: [],
      connectionStatus: 'idle',
      sessionScope: 'lobby'
    });
  }

  private async handlePeerJoined(playerId: string, playerName: string) {
    // Vérifier si le joueur n'existe pas déjà pour éviter les doublons
    if (this.state.players.some((player) => player.id_player === playerId)) {
      return;
    }

    const newPlayer: Player = {
      id_player: playerId,
      user_id: playerId,
      id_game: this.state.gameDetails?.id_game || 0,
      created_at: new Date().toISOString(),
      latitude: null,
      longitude: null,
      color: null,
      role: null,
      isInStartZone: null,
      IsReady: null,
      status: 'active', // Nouveau joueur est actif par défaut
      updated_at: null,
      is_admin: false,
      displayName: playerName
    };

    const players = [...this.state.players, newPlayer];
    this.updateState({ players, gameDetails: { ...this.state.gameDetails!, players } });

    const pc = this.createPeerConnection(playerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(playerId, { type: 'offer', sdp: pc.localDescription });

    this.broadcastState();
  }

  private async handlePeerReconnected(playerId: string, playerName: string) {
    // Fermer l'ancienne connexion si elle existe
    const existingPc = this.peerConnections.get(playerId);
    if (existingPc) {
      existingPc.close();
      this.peerConnections.delete(playerId);
    }
    const existingChannel = this.dataChannels.get(playerId);
    if (existingChannel) {
      existingChannel.close();
      this.dataChannels.delete(playerId);
    }
    this.reconnectAttempts.delete(playerId);

    // Mettre à jour le nom du joueur s'il a changé
    const players = this.state.players.map((player) =>
      player.id_player === playerId 
        ? { ...player, displayName: playerName }
        : player
    );
    this.updateState({ players, gameDetails: { ...this.state.gameDetails!, players } });

    // Créer une nouvelle connexion WebRTC
    const pc = this.createPeerConnection(playerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(playerId, { type: 'offer', sdp: pc.localDescription });

    // Envoyer l'état actuel une fois la connexion établie
    this.broadcastState();
  }

  private handlePeerLeft(playerId: string) {
    const players = this.state.players.filter((player) => player.id_player !== playerId);
    this.updateState({ players, gameDetails: { ...this.state.gameDetails!, players } });
    const pc = this.peerConnections.get(playerId);
    pc?.close();
    this.peerConnections.delete(playerId);
    this.dataChannels.delete(playerId);
    this.broadcastState();
  }

  private handleHostReconnected(newHostId: string) {
    // Fermer les anciennes connexions avec l'ancien host
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.hostChannel?.close();
    this.hostChannel = null;

    // Mettre à jour le hostId dans gameDetails
    if (this.state.gameDetails) {
      this.updateState({
        gameDetails: { ...this.state.gameDetails }
      });
    }

    // Le nouveau host va initier une nouvelle connexion WebRTC avec nous
    // Nous allons recevoir un signal offer de sa part
  }

  private async reestablishAllPeerConnections() {
    if (!this.state.isHost) return;
    
    // Pour chaque joueur (sauf le host lui-même)
    for (const player of this.state.players) {
      if (player.id_player !== this.state.playerId) {
        try {
          const pc = this.createPeerConnection(player.id_player, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal(player.id_player, { type: 'offer', sdp: pc.localDescription });
        } catch (error) {
          // Erreur silencieuse
        }
      }
    }
    
    // Une fois les connexions établies, diffuser l'état
    setTimeout(() => this.broadcastState(), 2000);
  }

  private sendSignal(targetId: string, signal: SignalMessage) {
    const type = this.state.sessionScope === 'game' ? 'game:signal' : 'webrtc:signal';
    this.sendSocket(type, {
      targetId,
      signal
    });
  }


  private createPeerConnection(peerId: string, isHost: boolean) {
    const pc = new RTCPeerConnection({
      iceServers: this.getIceServers()
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, { type: 'ice', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.handlePeerConnectionIssue(peerId, state);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.handlePeerConnectionIssue(peerId, state);
      }
    };

    if (isHost) {
      const channel = pc.createDataChannel('game');
      this.registerDataChannel(peerId, channel);
    } else {
      pc.ondatachannel = (event) => {
        this.hostChannel = event.channel;
        this.registerDataChannel(peerId, event.channel, true);
      };
    }

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  private registerDataChannel(peerId: string, channel: RTCDataChannel, isHostChannel = false) {
    channel.onmessage = (event) => this.handleDataChannelMessage(event.data);
    channel.onopen = () => {
      this.reconnectAttempts.delete(peerId);
      if (this.state.isHost) {
        this.sendStateToChannel(channel);
      } else if (!this.state.isHost && isHostChannel) {
        this.requestLatestState();
      }
    };
    channel.onclose = () => {
      if (isHostChannel) {
        this.hostChannel = null;
        this.requestResync('datachannel-closed');
      } else if (this.state.isHost) {
        this.schedulePeerReconnect(peerId);
      }
    };

    this.dataChannels.set(peerId, channel);
  }

  private async handleSignal(fromId: string, signal: SignalMessage) {
    let pc = this.peerConnections.get(fromId);

    if (!pc) {
      pc = this.createPeerConnection(fromId, false);
    }

    if (signal.type === 'offer' && signal.sdp) {
      await pc.setRemoteDescription(signal.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(fromId, { type: 'answer', sdp: pc.localDescription });
    }

    if (signal.type === 'answer' && signal.sdp) {
      await pc.setRemoteDescription(signal.sdp);
    }

    if (signal.type === 'ice' && signal.candidate) {
      await pc.addIceCandidate(signal.candidate);
    }
  }


  private handleDataChannelMessage(raw: string) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      return;
    }

    if (message.type === 'state:sync') {
      this.handleStateSync(message.payload);
      return;
    }

    if (this.state.isHost) {
      this.handleActionMessage(message);
    }
  }

  private sendStateToChannel(channel: RTCDataChannel) {
    const payload = {
      gameDetails: this.state.gameDetails,
      players: this.state.players,
      props: this.state.props
    };
    channel.send(JSON.stringify({ type: 'state:sync', payload }));
  }

  private broadcastState() {
    if (!this.state.isHost) return;
    const payload = {
      gameDetails: this.state.gameDetails,
      players: this.state.players,
      props: this.state.props
    };
    const message = JSON.stringify({ type: 'state:sync', payload });

    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(message);
      }
    });
  }

  private sendAction(type: string, payload: Record<string, any>) {
    if (this.state.isHost) return;
    if (this.hostChannel && this.hostChannel.readyState === 'open') {
      this.hostChannel.send(JSON.stringify({ type, payload }));
      return;
    }
    const relayType = this.state.sessionScope === 'game' ? 'game:action-relay' : 'action:relay';
    this.sendSocket(relayType, { action: { type, payload } });
  }

  private handleActionMessage(message?: { type?: string; payload?: any }) {
    if (!message?.type) return;
    if (message.type === 'action:update-game') {
      this.updateGameDetails(message.payload.changes);
    }

    if (message.type === 'action:update-player') {
      this.updatePlayer(message.payload.playerId, message.payload.changes);
    }

    if (message.type === 'action:update-prop') {
      this.updateProp(message.payload.propId, message.payload.changes);
    }

    if (message.type === 'action:request-state') {
      this.broadcastState();
    }
  }

  private handleStateSync(payload: { gameDetails: GameDetails; players: Player[]; props: GameProp[] }) {
    if (!payload) return;
    const { gameDetails, players, props } = payload;
    this.updateState({ gameDetails, players, props });
  }

  private handleSocketReconnect() {
    if (this.state.sessionScope === 'game' && this.state.gameCode) {
      if (this.state.isHost) {
        this.reconnectToGame();
      } else {
        this.attemptGameRejoin();
      }
      return;
    }
    if (this.state.lobbyCode) {
      if (this.state.isHost) {
        this.reconnectToLobby();
      } else {
        this.attemptRejoin();
      }
    }
  }

  private async attemptRejoin() {
    // Éviter les appels concurrents
    if (this.rejoinInFlight || this.joinInProgress || !this.state.lobbyCode) {
      return;
    }

    // Si on est déjà connecté, ne pas rejoindre
    if (this.state.connectionStatus === 'connected') {
      return;
    }

    this.rejoinInFlight = true;
    try {
      this.sendSocket('lobby:join', {
        code: this.state.lobbyCode,
        playerName: this.state.playerName,
        // Envoyer l'ancien playerId pour la reconnexion
        oldPlayerId: this.state.playerId
      });
      const response = await this.waitFor('lobby:joined', 10000);
      this.updateState({
        lobbyCode: response.code,
        playerId: response.playerId,
        isHost: response.playerId === response.hostId,
        connectionStatus: 'connected'
      });
      this.requestResync('socket-reconnect');
    } catch (error) {
      // Erreur silencieuse
    } finally {
      this.rejoinInFlight = false;
    }
  }

  private async attemptGameRejoin() {
    if (this.gameRejoinInFlight || this.gameJoinInProgress || !this.state.gameCode) {
      return;
    }

    if (this.state.connectionStatus === 'connected') {
      return;
    }

    this.gameRejoinInFlight = true;
    try {
      this.sendSocket('game:join', {
        code: this.state.gameCode,
        playerName: this.state.playerName,
        oldPlayerId: this.state.playerId
      });
      const response = await this.waitFor('game:joined', 10000);
      this.updateState({
        lobbyCode: null,
        gameCode: response.code,
        playerId: response.playerId,
        isHost: response.playerId === response.hostId,
        connectionStatus: 'connected',
        sessionScope: 'game'
      });
      this.requestResync('socket-reconnect');
    } catch (error) {
      // Erreur silencieuse
    } finally {
      this.gameRejoinInFlight = false;
    }
  }

  private requestResync(reason: string) {
    if (this.state.isHost) return;
    if (this.state.sessionScope === 'game') {
      if (!this.state.gameCode) return;
      this.sendSocket('game:request-resync', { reason });
      return;
    }
    if (!this.state.lobbyCode) return;
    this.sendSocket('lobby:request-resync', { reason });
  }

  private handleResyncRequest(playerId: string) {
    if (!this.state.isHost) return;
    if (!playerId) return;
    const channel = this.dataChannels.get(playerId);
    if (channel && channel.readyState === 'open') {
      this.sendStateToChannel(channel);
    } else {
      this.sendStateToSocket(playerId);
      this.schedulePeerReconnect(playerId);
    }
  }

  private sendStateToSocket(targetId: string) {
    if (!this.state.isHost) return;
    const payload = {
      gameDetails: this.state.gameDetails,
      players: this.state.players,
      props: this.state.props
    };
    this.sendSocket('state:sync', { targetId, payload });
  }

  private schedulePeerReconnect(peerId: string) {
    if (!this.state.isHost) return;
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts >= 3) {
      return;
    }
    this.reconnectAttempts.set(peerId, attempts + 1);
    const delay = 1000 * (attempts + 1);
    setTimeout(() => this.restartPeerConnection(peerId), delay);
  }

  private async restartPeerConnection(peerId: string) {
    if (!this.state.isHost) return;
    const existing = this.peerConnections.get(peerId);
    existing?.close();
    this.peerConnections.delete(peerId);
    this.dataChannels.delete(peerId);
    const pc = this.createPeerConnection(peerId, true);
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    this.sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });
  }

  private handlePeerConnectionIssue(peerId: string, state: string) {
    if (this.state.isHost) {
      this.schedulePeerReconnect(peerId);
    } else {
      this.requestResync(`webrtc-${state}`);
    }
  }


  private cleanupConnections() {
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.dataChannels.forEach((channel) => channel.close());
    this.dataChannels.clear();
    this.hostChannel?.close();
    this.hostChannel = null;
    this.reconnectAttempts.clear();
  }

  private clearObjectiveCirclesSession() {
    if (typeof window === 'undefined') return;
    try {
      const prefixes = ['objectiveCircles:'];
      const purge = (storage: Storage) => {
        const keysToRemove: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => storage.removeItem(key));
      };

      purge(localStorage);
      purge(sessionStorage);
    } catch (_) {
      // Erreur silencieuse
    }
  }

  private getIceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrl = import.meta.env?.VITE_TURN_URL;
    const turnUser = import.meta.env?.VITE_TURN_USERNAME;
    const turnCredential = import.meta.env?.VITE_TURN_CREDENTIAL;
    if (turnUrl && turnUser && turnCredential) {
      servers.push({
        urls: turnUrl,
        username: turnUser,
        credential: turnCredential
      });
    }
    return servers;
  }
}

export const gameSessionService = new GameSessionService();

export type { SessionState };
