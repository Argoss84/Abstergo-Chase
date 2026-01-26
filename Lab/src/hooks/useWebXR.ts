import { useCallback, useEffect, useRef, useState } from 'react';

export const useWebXR = () => {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [status, setStatus] = useState('Idle');

  useEffect(() => {
    let mounted = true;
    if (!navigator.xr || !navigator.xr.isSessionSupported) {
      setIsSupported(false);
      setStatus('WebXR not available in this browser.');
      return;
    }

    navigator.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (mounted) {
          setIsSupported(supported);
          if (!supported) {
            setStatus('WebXR AR is not supported on this device.');
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setIsSupported(false);
          setStatus('Unable to check WebXR support.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const sessionRef = useRef<XRSession | null>(null);

  const startSession = useCallback(
    async (
      onSessionStart: (session: XRSession) => void,
      overlayRoot?: HTMLElement | null
    ) => {
      if (!navigator.xr || isSessionActive) {
        return null;
      }

      setStatus('Starting AR session...');
      try {
        // On mobile, hand-tracking must be in optionalFeatures
        // Some devices may not support it, so it's optional
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local'],
          optionalFeatures: ['dom-overlay', 'local-floor', 'hand-tracking'],
        };
        
        console.log('Requesting AR session with features:', sessionInit);
        
        const session = await navigator.xr.requestSession(
          'immersive-ar',
          overlayRoot ? ({ ...sessionInit, domOverlay: { root: overlayRoot } } as XRSessionInit) : sessionInit
        );

        // Log enabled features for debugging
        console.log('Session enabled features:', session.enabledFeatures);
        console.log('Hand tracking enabled:', session.enabledFeatures?.includes('hand-tracking') ?? false);

        session.addEventListener('end', () => {
          setIsSessionActive(false);
          setStatus('AR session ended.');
          sessionRef.current = null;
        });

        sessionRef.current = session;
        setIsSessionActive(true);
        setStatus('AR session active.');
        onSessionStart(session);
        return session;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setStatus(`AR start failed: ${message}`);
        return null;
      }
    },
    [isSessionActive]
  );

  const stopSession = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.end();
    }
  }, []);

  return {
    isSupported,
    isSessionActive,
    status,
    startSession,
    stopSession,
    session: sessionRef.current,
  };
};
