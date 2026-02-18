import { useEffect, useRef, useState } from 'react';

/**
 * Retourne le cap de l'appareil en degrés (0-360, 0 = Nord).
 * Utilise l'API `deviceorientation` du navigateur.
 * Retourne `null` si l'orientation n'est pas disponible.
 */
export function useDeviceHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const unwrappedRef = useRef(0);
  const firstRef = useRef(true);

  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;

      // Convertir alpha (rotation autour de l'axe Z) en cap boussole
      let raw = 360 - e.alpha;
      if (raw >= 360) raw -= 360;
      if (raw < 0) raw += 360;

      // Déroulement pour éviter les sauts à la traversée 0°/360°
      if (firstRef.current) {
        unwrappedRef.current = raw;
        firstRef.current = false;
      } else {
        const prev = unwrappedRef.current;
        const prevNorm = ((prev % 360) + 360) % 360;
        let delta = raw - prevNorm;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        unwrappedRef.current = prev + delta;
      }

      setHeading(unwrappedRef.current);
    };

    window.addEventListener('deviceorientation', onOrientation as EventListener);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
    };
  }, []);

  return heading;
}
