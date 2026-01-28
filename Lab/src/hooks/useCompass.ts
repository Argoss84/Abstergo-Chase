import { useCallback, useEffect, useRef, useState } from 'react';

export const useCompass = (onError?: (error: string) => void) => {
  const [heading, setHeading] = useState<number | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const orientationHandlerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const betaRef = useRef<number | null>(null);
  const gammaRef = useRef<number | null>(null);

  const requestCompass = useCallback(async () => {
    if (compassEnabled) {
      return;
    }

    const requestPermission = (
      DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    ).requestPermission;

    try {
      smoothedHeadingRef.current = null;

      if (requestPermission) {
        const permission = await requestPermission();
        if (permission !== 'granted') {
          const errorMsg = 'Compass permission denied.';
          onError?.(errorMsg);
          return;
        }
      }

      const handler = (event: DeviceOrientationEvent) => {
        if (event.beta != null && !isNaN(event.beta)) betaRef.current = event.beta;
        if (event.gamma != null && !isNaN(event.gamma)) gammaRef.current = event.gamma;
        const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
          .webkitCompassHeading;
        if (typeof webkitHeading === 'number' && !isNaN(webkitHeading)) {
          const smoothingFactor = 0.2;
          if (smoothedHeadingRef.current === null) {
            smoothedHeadingRef.current = webkitHeading;
          } else {
            let diff = webkitHeading - smoothedHeadingRef.current;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            smoothedHeadingRef.current = (smoothedHeadingRef.current + diff * smoothingFactor + 360) % 360;
          }
          setHeading(smoothedHeadingRef.current);
          return;
        }
        if (event.alpha !== null && !isNaN(event.alpha)) {
          const rawHeading = (360 - event.alpha) % 360;

          const smoothingFactor = 0.2;
          if (smoothedHeadingRef.current === null) {
            smoothedHeadingRef.current = rawHeading;
          } else {
            let diff = rawHeading - smoothedHeadingRef.current;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;

            const maxChange = 45;
            if (Math.abs(diff) > maxChange) {
              return;
            }

            smoothedHeadingRef.current = (smoothedHeadingRef.current + diff * smoothingFactor + 360) % 360;
          }
          setHeading(smoothedHeadingRef.current);
        }
      };

      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
      orientationHandlerRef.current = handler;
      setCompassEnabled(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorMsg = `Compass error: ${message}`;
      onError?.(errorMsg);
    }
  }, [compassEnabled, onError]);

  useEffect(() => {
    return () => {
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      }
    };
  }, []);

  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta != null && !isNaN(e.beta)) betaRef.current = e.beta;
      if (e.gamma != null && !isNaN(e.gamma)) gammaRef.current = e.gamma;
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
      window.removeEventListener('deviceorientationabsolute', onOrientation, true);
    };
  }, []);

  return {
    heading,
    compassEnabled,
    requestCompass,
    betaRef,
    gammaRef,
  };
};
