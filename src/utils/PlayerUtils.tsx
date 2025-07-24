import GameService from '../services/GameService';

// Fonction pour mettre à jour la position du joueur en base de données
export const updatePlayerPosition = async (playerId: number, latitude: number, longitude: number) => {
  try {
    const gameService = new GameService();
    await gameService.updatePlayer(playerId.toString(), {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      updated_at: new Date().toISOString()
    });
    console.log(`Position du joueur ${playerId} mise à jour en BDD: ${latitude}, ${longitude}`);
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la position:', error);
  }
};

// Fonction pour mettre à jour le statut IsInStartZone du joueur
export const updatePlayerInStartZone = async (playerId: number, isInStartZone: boolean) => {
  try {
    const gameService = new GameService();
    await gameService.updatePlayer(playerId.toString(), {
      isInStartZone: isInStartZone,
      updated_at: new Date().toISOString()
    });
    console.log(`Statut IsInStartZone du joueur ${playerId} mis à jour: ${isInStartZone}`);
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

    const gameService = new GameService();
    const game = await gameService.getGameDatasByCode(code);
    
    if (game && game[0]) {
      console.log(`Données de la partie mises à jour: ${game[0].code} - Phase: ${game[0].is_converging_phase ? 'Convergence' : 'Normale'}`);
      return game[0];
    }
    
    return null;
  } catch (error) {
    console.error('Erreur lors de la mise à jour des données de la partie:', error);
    return null;
  }
};

// Fonction pour identifier le joueur actuel dans une partie
export const identifyCurrentPlayer = (gamePlayers: any[], currentUserId: number) => {
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