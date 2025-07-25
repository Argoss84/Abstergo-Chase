import GameService from '../services/GameService';

/**
 * Met à jour le winner_type d'une partie
 * @param gameCode - Le code de la partie
 * @param winnerType - Le type de gagnant ('AGENT', 'ROGUE', 'DRAW', etc.)
 * @returns Promise<boolean> - True si la mise à jour a réussi, false sinon
 */
export const updateGameWinnerType = async (gameCode: string, winnerType: string): Promise<boolean> => {
  try {
    console.log(`🏆 Mise à jour du winner_type pour la partie ${gameCode} -> ${winnerType}`);
    
    const gameService = new GameService();
    
    // Utiliser la méthode updateGameByCode existante
    const result = await gameService.updateGameByCode(gameCode, { winner_type: winnerType });
    
    if (result && result.length > 0) {
      console.log(`✅ Winner_type mis à jour avec succès: ${winnerType}`);
      return true;
    } else {
      console.error(`❌ Échec de la mise à jour du winner_type pour ${gameCode}`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour du winner_type:', error);
    return false;
  }
};