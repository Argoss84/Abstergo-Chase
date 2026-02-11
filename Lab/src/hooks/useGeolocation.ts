import { useEffect, useState } from 'react';
import type { GeoPosition } from '../types/geolocation';

export const useGeolocation = () => {
  const [geoStatus, setGeoStatus] = useState('Waiting for location...');
  const [currentPos, setCurrentPos] = useState<GeoPosition | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus('Geolocation not supported.');
      return;
    }

    const geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextPos: GeoPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          heading: position.coords.heading ?? null,
        };
        setCurrentPos(nextPos);
        setGeoStatus(`Location OK (±${Math.round(nextPos.accuracy ?? 0)}m)`);
      },
      (error) => {
        setGeoStatus(`Geolocation error: ${error.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(geoWatchId);
    };
  }, []);

  return { currentPos, geoStatus };
};
