import { useCallback } from 'react';

interface VibrationPattern {
  duration?: number;
  pattern?: number[];
}

export const useVibration = () => {
  // Vérifier si l'API Vibration est supportée
  const isSupported = 'vibrate' in navigator;

  // Fonction pour faire vibrer avec une durée simple
  const vibrate = useCallback((duration: number = 200) => {
    if (!isSupported) {
      console.warn('⚠️ API Vibration non supportée par ce navigateur');
      return false;
    }

    try {
      navigator.vibrate(duration);
      console.log(`📳 Vibration activée pour ${duration}ms`);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la vibration:', error);
      return false;
    }
  }, [isSupported]);

  // Fonction pour faire vibrer avec un pattern complexe
  const vibratePattern = useCallback((pattern: number[]) => {
    if (!isSupported) {
      console.warn('⚠️ API Vibration non supportée par ce navigateur');
      return false;
    }

    try {
      navigator.vibrate(pattern);
      console.log(`📳 Pattern de vibration activé:`, pattern);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors du pattern de vibration:', error);
      return false;
    }
  }, [isSupported]);

  // Fonction pour arrêter la vibration
  const stopVibration = useCallback(() => {
    if (!isSupported) {
      return false;
    }

    try {
      navigator.vibrate(0);
      console.log('📳 Vibration arrêtée');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de l\'arrêt de la vibration:', error);
      return false;
    }
  }, [isSupported]);

  // Fonction pour faire vibrer avec des options prédéfinies
  const vibrateWithOptions = useCallback((options: VibrationPattern) => {
    if (!isSupported) {
      console.warn('⚠️ API Vibration non supportée par ce navigateur');
      return false;
    }

    try {
      if (options.pattern) {
        navigator.vibrate(options.pattern);
        console.log(`📳 Pattern de vibration activé:`, options.pattern);
      } else if (options.duration) {
        navigator.vibrate(options.duration);
        console.log(`📳 Vibration activée pour ${options.duration}ms`);
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la vibration avec options:', error);
      return false;
    }
  }, [isSupported]);

  // Patterns de vibration prédéfinis
  const patterns = {
    short: 100,
    medium: 200,
    long: 500,
    double: [100, 100, 100, 100],
    triple: [100, 100, 100, 200, 100, 100, 100],
    success: [100, 50, 100, 50, 100],
    error: [200, 100, 200, 100, 200],
    notification: [200, 100, 200],
    alert: [300, 200, 300, 200, 300]
  };

  return {
    isSupported,
    vibrate,
    vibratePattern,
    stopVibration,
    vibrateWithOptions,
    patterns
  };
};
