import { gameSessionService } from '../services/GameSessionService';

// Fonction pour mettre à jour la position du joueur en base de données
export const updatePlayerPosition = async (playerId: string, latitude: number, longitude: number) => {
  try {
    await gameSessionService.updatePlayer(playerId.toString(), {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      updated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la position:', error);
  }
};

// Fonction pour mettre à jour le statut IsInStartZone du joueur
export const updatePlayerInStartZone = async (playerId: string, isInStartZone: boolean) => {
  try {
    await gameSessionService.updatePlayer(playerId.toString(), {
      isInStartZone: isInStartZone,
      updated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut IsInStartZone:', error);
  }
};

// Fonction pour mettre à jour les données de la partie
export const updateGameData = async (code: string) => {
  try {
    if (!code) {
      console.warn('Code de partie non disponible pour la mise à jour');
      return null;
    }

    const currentState = gameSessionService.getState();
    if (currentState.gameDetails && currentState.gameDetails.code === code) {
      return currentState.gameDetails;
    }

    return currentState.gameDetails;
  } catch (error) {
    console.error('Erreur lors de la mise à jour des données de la partie:', error);
    return null;
  }
};

// Fonction pour identifier le joueur actuel dans une partie
export const identifyCurrentPlayer = (gamePlayers: any[], currentUserId: string) => {
  if (gamePlayers && gamePlayers.length > 0 && currentUserId) {
    const currentPlayer = gamePlayers.find((player: any) => player.user_id === currentUserId);
    if (currentPlayer) {
      console.log(`Joueur actuel identifié: ${currentPlayer.id_player} (${currentPlayer.role})`);
      return currentPlayer;
    } else {
      console.warn(`Aucun joueur trouvé pour l'utilisateur ID ${currentUserId} dans cette partie`);
    }
  }
  return null;
}; 
