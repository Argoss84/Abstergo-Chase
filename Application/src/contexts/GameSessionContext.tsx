import React, { createContext, useContext, useEffect, useState } from 'react';
import { gameSessionService, SessionState } from '../services/GameSessionService';
import { GameDetails, GameProp, Player } from '../components/Interfaces';

// Interface du contexte de session de jeu
interface GameSessionContextValue extends SessionState {
  createLobby: (gameDetails: GameDetails, props: GameProp[]) => Promise<string>;
  joinLobby: (code: string) => Promise<void>;
  startGame: () => Promise<void>;
  joinGame: (code: string) => Promise<void>;
  updateGameDetails: (partial: Partial<GameDetails>) => Promise<void>;
  updatePlayer: (playerId: string, partial: Partial<Player>) => Promise<void>;
  updateProp: (propId: number, partial: Partial<GameProp>) => Promise<void>;
  requestLatestState: () => Promise<void>;
  setPlayerName: (name: string) => void;
  clearSession: () => void;
  leaveLobby: () => void;
  leaveGame: () => void;
  hasPersistedSession: () => boolean;
  disconnectSocket: () => void;
}

const GameSessionContext = createContext<GameSessionContextValue | undefined>(undefined);

export const GameSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SessionState>(gameSessionService.getState());

  useEffect(() => {
    return gameSessionService.subscribe(setState);
  }, []);

  const value: GameSessionContextValue = {
    ...state,
    createLobby: async (gameDetails, props) => {
      return gameSessionService.createLobby(gameDetails, props);
    },
    joinLobby: async (code: string) => gameSessionService.joinLobby(code),
    startGame: async () => gameSessionService.startGame(),
    joinGame: async (code: string) => gameSessionService.joinGame(code),
    updateGameDetails: async (partial) => gameSessionService.updateGameDetails(partial),
    updatePlayer: async (playerId, partial) => gameSessionService.updatePlayer(playerId, partial),
    updateProp: async (propId, partial) => gameSessionService.updateProp(propId, partial),
    requestLatestState: async () => gameSessionService.requestLatestState(),
    setPlayerName: (name: string) => gameSessionService.setPlayerName(name),
    clearSession: () => gameSessionService.clearSession(),
    leaveLobby: () => gameSessionService.leaveLobby(),
    leaveGame: () => gameSessionService.leaveGame(),
    hasPersistedSession: () => gameSessionService.hasPersistedSession(),
    disconnectSocket: () => gameSessionService.disconnectSocket()
  };

  return <GameSessionContext.Provider value={value}>{children}</GameSessionContext.Provider>;
};

export const useGameSession = () => {
  const context = useContext(GameSessionContext);
  if (!context) {
    throw new Error('useGameSession must be used within GameSessionProvider');
  }
  return context;
};
