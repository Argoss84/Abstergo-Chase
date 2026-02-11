import React, { useEffect, useRef } from 'react';

interface WakeLockSentinel {
  released: boolean;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
  release: () => Promise<void>;
}

interface WakeLockProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export const WakeLockProvider: React.FC<WakeLockProviderProps> = ({ 
  children, 
  enabled = true 
}) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        // Vérifier si l'API Wake Lock est supportée
        if ('wakeLock' in navigator) {
          // Demander le Wake Lock
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          console.log('🔒 Wake Lock global activé - L\'écran ne se mettra pas en veille');
          
          // Écouter les événements de libération du Wake Lock
          wakeLockRef.current.addEventListener('release', () => {
            console.log('🔓 Wake Lock global libéré');
          });
        } else {
          console.warn('⚠️ Wake Lock API non supportée par ce navigateur');
        }
      } catch (error) {
        console.error('❌ Erreur lors de l\'activation du Wake Lock global:', error);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          console.log('🔓 Wake Lock global libéré manuellement');
        } catch (error) {
          console.error('❌ Erreur lors de la libération du Wake Lock global:', error);
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

    // Gérer la fermeture de la page
    const handleBeforeUnload = async () => {
      await releaseWakeLock();
    };

    // Activer le Wake Lock si demandé
    if (enabled) {
      requestWakeLock();
    }

    // Écouter les changements de visibilité
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Écouter la fermeture de la page
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup lors du démontage
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      releaseWakeLock();
    };
  }, [enabled]);

  return <>{children}</>;
}; 