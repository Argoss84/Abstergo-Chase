import { io, Socket } from 'socket.io-client';
import { GameDetails, GameProp, Player } from '../components/Interfaces';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface SessionState {
  lobbyCode: string | null;
  playerId: string | null;
  playerName: string;
  isHost: boolean;
  players: Player[];
  gameDetails: GameDetails | null;
  props: GameProp[];
  connectionStatus: ConnectionStatus;
}

interface PersistedSessionData {
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
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
  playerId: null,
  playerName: defaultPlayerName(),
  isHost: false,
  players: [],
  gameDetails: null,
  props: [],
  connectionStatus: 'idle'
});

class GameSessionService {
  private state: SessionState = createInitialState();
  private listeners = new Set<(state: SessionState) => void>();
  private socket: Socket | null = null;
  private socketReady: Promise<void> | null = null;
  private pendingActions = new Map<string, (payload: any) => void>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private hostChannel: RTCDataChannel | null = null;
  private reconnectAttempts = new Map<string, number>();
  private rejoinInFlight = false;

  constructor() {
    if (typeof window !== 'undefined') {
      // Restaurer la session si elle existe
      this.restoreSession();
      
      window.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          // Quand l'utilisateur revient sur la page
          if (this.state.lobbyCode && !this.socket?.connected) {
            console.log('[GameSession] Page visible, tentative de reconnexion...');
            this.reconnectToLobby();
          } else if (!this.state.isHost) {
            this.requestResync('visibilitychange');
          }
        }
      });
      window.addEventListener('beforeunload', () => {
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
    console.log('[GameSession] Nettoyage de la session');
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.resetSession();
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

  async createLobby(gameDetails: GameDetails, props: GameProp[]) {
    console.log('[GameSession] Début de la création du lobby', { playerName: this.state.playerName });
    
    try {
      await this.ensureSocket();
      console.log('[GameSession] Socket prêt, envoi de la requête lobby:create');
      
      this.sendSocket('lobby:create', {
        playerName: this.state.playerName
      });

      console.log('[GameSession] En attente de la réponse lobby:created...');
      const response = await this.waitFor('lobby:created', 15000);
      console.log('[GameSession] Réponse lobby:created reçue:', response);
      
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
      status: null,
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
      playerId,
      isHost: true,
      players: [hostPlayer],
      gameDetails: updatedGameDetails,
      props,
      connectionStatus: 'connected'
    });

    console.log('[GameSession] Lobby créé avec succès:', lobbyCode);
    return lobbyCode;
    } catch (error) {
      console.error('[GameSession] Erreur lors de la création du lobby:', error);
      throw error;
    }
  }

  async joinLobby(code: string) {
    await this.ensureSocket();
    this.sendSocket('lobby:join', {
      code,
      playerName: this.state.playerName
    });

    const response = await this.waitFor('lobby:joined');
    this.updateState({
      lobbyCode: response.code,
      playerId: response.playerId,
      isHost: response.playerId === response.hostId,
      connectionStatus: 'connected'
    });
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
    } else {
      this.sendAction('action:update-player', { playerId, changes: partial });
    }
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
      this.sendAction('action:request-state', {});
    }
  }

  private persistSession() {
    if (!this.state.lobbyCode || !this.state.playerId) {
      return;
    }

    const data: PersistedSessionData = {
      lobbyCode: this.state.lobbyCode,
      playerId: this.state.playerId,
      playerName: this.state.playerName,
      isHost: this.state.isHost,
      timestamp: Date.now(),
      gameDetails: this.state.gameDetails,
      players: this.state.players,
      props: this.state.props
    };

    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
      console.log('[GameSession] Session persistée:', data.lobbyCode);
    } catch (error) {
      console.error('[GameSession] Erreur lors de la persistance:', error);
    }
  }

  private restoreSession() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;

    try {
      const data: PersistedSessionData = JSON.parse(stored);
      const age = Date.now() - data.timestamp;

      if (age > SESSION_EXPIRY_MS) {
        console.log('[GameSession] Session expirée, nettoyage');
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }

      console.log('[GameSession] Restauration de session:', data.lobbyCode);
      
      // Restaurer tous les états y compris gameDetails, players et props
      const stateUpdate: Partial<SessionState> = {
        lobbyCode: data.lobbyCode,
        playerId: data.playerId,
        playerName: data.playerName,
        isHost: data.isHost
      };

      // Restaurer les données du jeu si elles existent (important pour le host)
      if (data.gameDetails) {
        stateUpdate.gameDetails = data.gameDetails;
      }
      if (data.players) {
        stateUpdate.players = data.players;
      }
      if (data.props) {
        stateUpdate.props = data.props;
      }

      this.state = { ...this.state, ...stateUpdate };
      this.listeners.forEach((listener) => listener(this.state));
    } catch (error) {
      console.error('[GameSession] Erreur lors de la restauration:', error);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  private async reconnectToLobby() {
    if (!this.state.lobbyCode || !this.state.playerId) return;

    console.log('[GameSession] Reconnexion au lobby:', this.state.lobbyCode);
    
    try {
      await this.ensureSocket();
      
      if (this.state.isHost) {
        // Pour le host, essayer de se reconnecter
        console.log('[GameSession] Reconnexion en tant que host');
        this.sendSocket('lobby:rejoin-host', {
          code: this.state.lobbyCode,
          playerId: this.state.playerId,
          playerName: this.state.playerName
        });
        
        // Attendre la réponse de reconnexion
        try {
          const response = await this.waitFor('lobby:joined', 10000);
          console.log('[GameSession] Host reconnecté avec succès:', response);
          this.updateState({
            connectionStatus: 'connected'
          });
          // Demander une resynchronisation de l'état
          this.requestLatestState();
        } catch (error) {
          console.error('[GameSession] Échec de la reconnexion host:', error);
          this.updateState({ connectionStatus: 'error' });
        }
      } else {
        // Pour les autres joueurs, rejoindre normalement
        await this.attemptRejoin();
      }
    } catch (error) {
      console.error('[GameSession] Erreur de reconnexion:', error);
      this.updateState({ connectionStatus: 'error' });
    }
  }

  private updateState(partial: Partial<SessionState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener(this.state));
    
    // Persister la session si on a un lobby actif
    if (this.state.lobbyCode && this.state.playerId) {
      this.persistSession();
    }
  }

  private async ensureSocket() {
    if (this.socket?.connected) {
      console.log('[GameSession] Socket déjà ouvert');
      return;
    }

    if (this.socketReady) {
      console.log('[GameSession] Socket en cours de connexion, attente...');
      return this.socketReady;
    }

    const defaultUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:5174'
      : 'https://ws.abstergochase.fr';
    const url = defaultUrl;
    const path = '/socket.io';
    console.log(`[GameSession] Connexion au serveur Socket.io: ${url} (path: ${path})`);
    this.updateState({ connectionStatus: 'connecting' });

    this.socket = io(url, {
      path,
      reconnection: true,
      transports: ['polling', 'websocket']
    });
    this.socketReady = new Promise((resolve, reject) => {
      if (!this.socket) return reject();

      this.socket.on('connect', () => {
        console.log('[GameSession] Socket.io connecté avec succès');
        this.updateState({ connectionStatus: 'connected' });
        resolve();
        this.handleSocketReconnect();
      });

      this.socket.on('connect_error', (error: Error) => {
        console.error('[GameSession] Erreur Socket.io:', error);
        this.updateState({ connectionStatus: 'error' });
        reject(error);
      });

      this.socket.on('message', (message: { type: string; payload: any }) => this.handleSocketMessage(message));
      this.socket.on('disconnect', () => {
        console.log('[GameSession] Socket.io fermé');
        this.updateState({ connectionStatus: 'idle' });
      });
    });

    return this.socketReady;
  }

  private waitFor(type: string, timeoutMs: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(type);
        console.error(`[GameSession] Timeout en attente de: ${type} (${timeoutMs}ms)`);
        reject(new Error(`Timeout en attente du message: ${type}`));
      }, timeoutMs);

      this.pendingActions.set(type, (payload: any) => {
        clearTimeout(timeout);
        resolve(payload);
      });
      
      console.log(`[GameSession] En attente du message: ${type}`);
    });
  }

  private sendSocket(type: string, payload: Record<string, any>) {
    if (!this.socket) {
      console.error(`[GameSession] Impossible d'envoyer ${type}: socket null`);
      return;
    }
    
    if (!this.socket.connected) {
      console.error(`[GameSession] Impossible d'envoyer ${type}: socket pas ouvert`);
      return;
    }
    
    const message = { type, payload };
    console.log(`[GameSession] Envoi message:`, { type, payload });
    this.socket.emit('message', message);
  }

  private handleSocketMessage(message: { type: string; payload: any }) {
    console.log('[GameSession] Message reçu du serveur:', message);
    const { type, payload } = message;

    if (this.pendingActions.has(type)) {
      console.log(`[GameSession] Résolution de l'action en attente: ${type}`, payload);
      const resolve = this.pendingActions.get(type)!;
      this.pendingActions.delete(type);
      resolve(payload);
      return;
    }

    if (type === 'lobby:peer-joined' && this.state.isHost) {
      this.handlePeerJoined(payload.playerId, payload.playerName);
      return;
    }

    if (type === 'lobby:peer-left' && this.state.isHost) {
      this.handlePeerLeft(payload.playerId);
      return;
    }

    if (type === 'lobby:closed') {
      this.resetSession();
      return;
    }

    if (type === 'webrtc:signal') {
      this.handleSignal(payload.fromId, payload.signal);
      return;
    }

    if (type === 'lobby:request-resync' && this.state.isHost) {
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
  }

  private resetSession() {
    this.cleanupConnections();
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.updateState({
      lobbyCode: null,
      playerId: null,
      isHost: false,
      players: [],
      gameDetails: null,
      props: [],
      connectionStatus: 'idle'
    });
  }

  private async handlePeerJoined(playerId: string, playerName: string) {
    // Vérifier si le joueur n'existe pas déjà pour éviter les doublons
    if (this.state.players.some((player) => player.id_player === playerId)) {
      console.warn(`Player ${playerId} already exists in the lobby`);
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
      status: null,
      updated_at: null,
      is_admin: false,
      displayName: playerName
    };

    const players = [...this.state.players, newPlayer];
    this.updateState({ players, gameDetails: { ...this.state.gameDetails!, players } });

    const pc = this.createPeerConnection(playerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSocket('webrtc:signal', {
      targetId: playerId,
      signal: { type: 'offer', sdp: pc.localDescription }
    });

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

  private createPeerConnection(peerId: string, isHost: boolean) {
    const pc = new RTCPeerConnection({
      iceServers: this.getIceServers()
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSocket('webrtc:signal', {
          targetId: peerId,
          signal: { type: 'ice', candidate: event.candidate }
        });
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
      this.sendSocket('webrtc:signal', {
        targetId: fromId,
        signal: { type: 'answer', sdp: pc.localDescription }
      });
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
    this.sendSocket('action:relay', { action: { type, payload } });
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
    if (this.state.lobbyCode && !this.state.isHost) {
      this.attemptRejoin();
    }
  }

  private async attemptRejoin() {
    if (this.rejoinInFlight || !this.state.lobbyCode) return;
    this.rejoinInFlight = true;
    try {
      this.sendSocket('lobby:join', {
        code: this.state.lobbyCode,
        playerName: this.state.playerName
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
      console.error('[GameSession] Échec de reconnexion au lobby:', error);
    } finally {
      this.rejoinInFlight = false;
    }
  }

  private requestResync(reason: string) {
    if (this.state.isHost) return;
    if (!this.state.lobbyCode) return;
    console.log('[GameSession] Demande de resynchronisation:', reason);
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
      console.warn(`[GameSession] Reconnexion WebRTC abandonnée pour ${peerId}`);
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
    this.sendSocket('webrtc:signal', {
      targetId: peerId,
      signal: { type: 'offer', sdp: pc.localDescription }
    });
  }

  private handlePeerConnectionIssue(peerId: string, state: string) {
    if (this.state.isHost) {
      console.warn(`[GameSession] Problème WebRTC (${state}) avec ${peerId}, tentative de reconnexion`);
      this.schedulePeerReconnect(peerId);
    } else {
      console.warn(`[GameSession] Problème WebRTC (${state}) avec l'hôte, demande de resync`);
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
