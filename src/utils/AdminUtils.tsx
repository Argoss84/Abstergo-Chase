import { gameSessionService } from '../services/GameSessionService';

/**
 * Met à jour le winner_type d'une partie
 * @param gameCode - Le code de la partie
 * @param winnerType - Le type de gagnant ('AGENT', 'ROGUE', 'DRAW', etc.)
 * @returns Promise<boolean> - True si la mise à jour a réussi, false sinon
 */
export const updateGameWinnerType = async (gameCode: string, winnerType: string): Promise<boolean> => {
  try {
    console.log(`🏆 Mise à jour du winner_type pour la partie ${gameCode} -> ${winnerType}`);

    const currentState = gameSessionService.getState();
    if (!currentState.gameDetails || currentState.gameDetails.code !== gameCode) {
      console.error(`❌ Partie introuvable pour ${gameCode}`);
      return false;
    }

    await gameSessionService.updateGameDetails({ winner_type: winnerType });
    console.log(`✅ Winner_type mis à jour avec succès: ${winnerType}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour du winner_type:', error);
    return false;
  }
};
