import { useEffect, useRef } from 'react';

interface WakeLockSentinel {
  released: boolean;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
  release: () => Promise<void>;
}

export const useWakeLock = (enabled: boolean = true) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        // Vérifier si l'API Wake Lock est supportée
        if ('wakeLock' in navigator) {
          // Demander le Wake Lock
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          console.log('🔒 Wake Lock activé - L\'écran ne se mettra pas en veille');
          
          // Écouter les événements de libération du Wake Lock
          wakeLockRef.current.addEventListener('release', () => {
            console.log('🔓 Wake Lock libéré');
          });
        } else {
          console.warn('⚠️ Wake Lock API non supportée par ce navigateur');
        }
      } catch (error) {
        console.error('❌ Erreur lors de l\'activation du Wake Lock:', error);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          console.log('🔓 Wake Lock libéré manuellement');
        } catch (error) {
          console.error('❌ Erreur lors de la libération du Wake Lock:', error);
        }
      }
    };

    // Gérer la visibilité de la page
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Page cachée, libérer le Wake Lock
        await releaseWakeLock();
      } else if (enabled) {
        // Page visible, redemander le Wake Lock
        await requestWakeLock();
      }
    };

    // Activer le Wake Lock si demandé
    if (enabled) {
      requestWakeLock();
    }

    // Écouter les changements de visibilité
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup lors du démontage
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [enabled]);

  // Fonction pour libérer manuellement le Wake Lock
  const releaseWakeLock = async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('🔓 Wake Lock libéré manuellement');
      } catch (error) {
        console.error('❌ Erreur lors de la libération du Wake Lock:', error);
      }
    }
  };

  return { releaseWakeLock };
}; 