import type { GeoPosition } from '../types/geolocation';

export const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

export const toDeg = (radians: number): number => (radians * 180) / Math.PI;

export const computeDistanceBearing = (
  from: GeoPosition,
  to: GeoPosition
): { distance: number; bearing: number } => {
  const earthRadius = 6371000;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLat = toRad(to.lat - from.lat);
  const deltaLon = toRad(to.lon - from.lon);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = earthRadius * c;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distance, bearing };
};
