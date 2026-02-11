import { useEffect, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { GameDetails } from '../components/Interfaces';

export const ResizeMap = () => {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, [map]);
  return null;
};

export const MapController = ({ onMapReady }: { onMapReady: (map: L.Map) => void }) => {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  return null;
};

const buildCircleLatLngs = (center: [number, number], radius: number, steps = 64): [number, number][] => {
  const [lat, lng] = center;
  const earthRadius = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularDistance = radius / earthRadius;

  return Array.from({ length: steps }, (_, index) => {
    const bearing = (index / steps) * 2 * Math.PI;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinAd = Math.sin(angularDistance);
    const cosAd = Math.cos(angularDistance);

    const lat2 = Math.asin(sinLat * cosAd + cosLat * sinAd * Math.cos(bearing));
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * sinAd * cosLat,
        cosAd - sinLat * Math.sin(lat2)
      );

    return [(lat2 * 180) / Math.PI, ((lng2 * 180) / Math.PI + 540) % 360 - 180];
  });
};

const WORLD_BOUNDS_POLYGON: [number, number][] = [
  [85.0511, -180],
  [85.0511, 180],
  [-85.0511, 180],
  [-85.0511, -180]
];

export const useFogRings = (gameDetails: GameDetails | null, ringCount = 20) => {
  return useMemo(() => {
    if (!gameDetails?.map_center_latitude || !gameDetails?.map_center_longitude) {
      return [];
    }
    const center: [number, number] = [
      parseFloat(gameDetails.map_center_latitude || '0'),
      parseFloat(gameDetails.map_center_longitude || '0')
    ];
    const baseRadius = gameDetails.map_radius || 750;
    const safeRingCount = Math.max(1, ringCount);
    const legacyRingCount = 4;
    const legacyStepSize = Math.max(baseRadius * 0.2, 150);
    const legacyLastOuterRadius = baseRadius + legacyStepSize * legacyRingCount;
    const stepSize = (legacyLastOuterRadius - baseRadius) / safeRingCount;
    const rings = Array.from({ length: safeRingCount }, (_, index) => {
      const innerRadius = baseRadius + stepSize * index;
      const outerRadius = baseRadius + stepSize * (index + 1);
      const t = (index + 1) / (safeRingCount + 1);
      const opacity = Math.min(0.22 + 0.9 * t * t, 0.98);
      return {
        outer: buildCircleLatLngs(center, outerRadius),
        inner: buildCircleLatLngs(center, innerRadius),
        opacity
      };
    });
    const lastOuterRadius = baseRadius + stepSize * safeRingCount;
    rings.push({
      outer: WORLD_BOUNDS_POLYGON,
      inner: buildCircleLatLngs(center, lastOuterRadius),
      opacity: 0.98
    });
    return rings;
  }, [gameDetails?.map_center_latitude, gameDetails?.map_center_longitude, gameDetails?.map_radius, ringCount]);
};
