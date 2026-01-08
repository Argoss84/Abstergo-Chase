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

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

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
  private socket: WebSocket | null = null;
  private socketReady: Promise<void> | null = null;
  private pendingActions = new Map<string, (payload: any) => void>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private hostChannel: RTCDataChannel | null = null;

  subscribe(listener: (state: SessionState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  setPlayerName(name: string) {
    if (!name.trim()) return;
    localStorage.setItem('abstergo-player-name', name.trim());
    this.updateState({ playerName: name.trim() });
  }

  async createLobby(gameDetails: GameDetails, props: GameProp[]) {
    await this.ensureSocket();
    this.sendSocket('lobby:create', {
      playerName: this.state.playerName
    });

    const response = await this.waitFor('lobby:created');
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

    return lobbyCode;
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
    if (!this.state.isHost) {
      this.sendAction('action:request-state', {});
    }
  }

  private updateState(partial: Partial<SessionState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private async ensureSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.socketReady) {
      return this.socketReady;
    }

    const url = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:5174';
    this.updateState({ connectionStatus: 'connecting' });

    this.socket = new WebSocket(url);
    this.socketReady = new Promise((resolve, reject) => {
      if (!this.socket) return reject();

      this.socket.addEventListener('open', () => {
        this.updateState({ connectionStatus: 'connected' });
        resolve();
      });

      this.socket.addEventListener('error', () => {
        this.updateState({ connectionStatus: 'error' });
        reject();
      });

      this.socket.addEventListener('message', (event) => this.handleSocketMessage(event));
      this.socket.addEventListener('close', () => {
        this.updateState({ connectionStatus: 'idle' });
      });
    });

    return this.socketReady;
  }

  private waitFor(type: string): Promise<any> {
    return new Promise((resolve) => {
      this.pendingActions.set(type, resolve);
    });
  }

  private sendSocket(type: string, payload: Record<string, any>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ type, payload }));
  }

  private handleSocketMessage(event: MessageEvent) {
    const message = JSON.parse(event.data);
    const { type, payload } = message;

    if (this.pendingActions.has(type)) {
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
    }
  }

  private resetSession() {
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.hostChannel?.close();
    this.hostChannel = null;
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
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSocket('webrtc:signal', {
          targetId: peerId,
          signal: { type: 'ice', candidate: event.candidate }
        });
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
      if (this.state.isHost) {
        this.sendStateToChannel(channel);
      } else if (!this.state.isHost && isHostChannel) {
        this.requestLatestState();
      }
    };
    channel.onclose = () => {
      if (isHostChannel) {
        this.hostChannel = null;
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
      const { gameDetails, players, props } = message.payload;
      this.updateState({ gameDetails, players, props });
      return;
    }

    if (this.state.isHost) {
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
    }
  }
}

export const gameSessionService = new GameSessionService();

export type { SessionState };
