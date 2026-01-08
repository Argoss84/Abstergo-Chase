
/**
 * Interface pour les options de gestion d'erreur
 */
export interface ErrorOptions {
  context?: string;
  userEmail?: string;
  shouldLog?: boolean;
  shouldShowError?: boolean;
}

/**
 * Interface pour le résultat de la gestion d'erreur
 */
export interface ErrorResult {
  success: boolean;
  message: string;
  error?: any;
}

/**
 * Fonction utilitaire pour gérer les erreurs avec logging
 * @param errorMessage - Message d'erreur à afficher
 * @param error - Objet d'erreur (optionnel)
 * @param options - Options de configuration
 * @returns Promise<ErrorResult> - Résultat de la gestion d'erreur
 */
export const handleError = async (
  errorMessage: string, 
  error?: any, 
  options: ErrorOptions = {}
): Promise<ErrorResult> => {
  const {
    context = 'GENERAL',
    userEmail,
    shouldLog = true,
    shouldShowError = true
  } = options;

  const fullMessage = `${context}: ${errorMessage}`;
  
  // Log dans la console
  console.error(fullMessage, error);
  
  // Logging distant désactivé (pas de backend Supabase)
  if (shouldLog && userEmail) {
    console.warn('Logging distant désactivé pour', userEmail);
  }
  
  return {
    success: false,
    message: errorMessage,
    error
  };
};

/**
 * Fonction utilitaire pour gérer les erreurs de manière silencieuse (sans affichage)
 * @param errorMessage - Message d'erreur
 * @param error - Objet d'erreur (optionnel)
 * @param options - Options de configuration
 * @returns Promise<ErrorResult> - Résultat de la gestion d'erreur
 */
export const handleSilentError = async (
  errorMessage: string,
  error?: any,
  options: ErrorOptions = {}
): Promise<ErrorResult> => {
  return handleError(errorMessage, error, {
    ...options,
    shouldShowError: false
  });
};

/**
 * Fonction utilitaire pour gérer les erreurs avec contexte spécifique
 * @param context - Contexte de l'erreur
 * @param errorMessage - Message d'erreur
 * @param error - Objet d'erreur (optionnel)
 * @param options - Options de configuration
 * @returns Promise<ErrorResult> - Résultat de la gestion d'erreur
 */
export const handleContextualError = async (
  context: string,
  errorMessage: string,
  error?: any,
  options: ErrorOptions = {}
): Promise<ErrorResult> => {
  return handleError(errorMessage, error, {
    ...options,
    context
  });
};

/**
 * Fonction utilitaire pour valider une réponse HTTP
 * @param response - Réponse fetch
 * @param context - Contexte pour le message d'erreur
 * @returns Promise<void> - Lance une erreur si la réponse n'est pas OK
 */
export const validateHttpResponse = async (response: Response, context: string): Promise<void> => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} - ${context}`);
  }
};

/**
 * Fonction utilitaire pour gérer les erreurs de fetch avec validation
 * @param fetchPromise - Promise de fetch
 * @param context - Contexte de l'erreur
 * @param options - Options de configuration
 * @returns Promise<ErrorResult> - Résultat de la gestion d'erreur
 */
export const handleFetchError = async (
  fetchPromise: Promise<Response>,
  context: string,
  options: ErrorOptions = {}
): Promise<ErrorResult> => {
  try {
    const response = await fetchPromise;
    await validateHttpResponse(response, context);
    return { success: true, message: 'Fetch successful' };
  } catch (error) {
    return handleError(`Erreur lors de la requête ${context}`, error, options);
  }
};

/**
 * Constantes pour les contextes d'erreur communs
 */
export const ERROR_CONTEXTS = {
  LOBBY_INIT: 'LOBBY_INIT',
  PLAYER_CREATION: 'PLAYER_CREATION',
  ROLE_CHANGE: 'ROLE_CHANGE',
  GAME_START: 'GAME_START',
  GAME_EVENTS: 'GAME_EVENTS',
  STREET_FETCH: 'STREET_FETCH',
  SUBSCRIPTION_ERROR: 'SUBSCRIPTION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION',
  DATABASE: 'DATABASE',
  NETWORK: 'NETWORK',
  VALIDATION: 'VALIDATION',
  GENERAL: 'GENERAL'
} as const;

/**
 * Type pour les contextes d'erreur
 */
export type ErrorContext = typeof ERROR_CONTEXTS[keyof typeof ERROR_CONTEXTS];
