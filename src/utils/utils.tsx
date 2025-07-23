import L from "leaflet";

export const generateStartZone = (
  center: [number, number],
  radius: number,
  objectives: [number, number][],
  streets: L.LatLngTuple[][]
): [number, number] => {
  const pointsOnCircle: [number, number][] = [];
  const numPoints = 360; // Number of points to generate on the circle

  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    const point: [number, number] = [
      center[0] + (radius / 111320) * Math.cos(angle),
      center[1] + (radius / (111320 * Math.cos(center[0]))) * Math.sin(angle),
    ];
    pointsOnCircle.push(point);
  }

  const farthestPoint = pointsOnCircle.reduce((farthest, current) => {
    const currentMinDistance = Math.min(
      ...objectives.map((obj) => L.latLng(current).distanceTo(L.latLng(obj)))
    );
    const farthestMinDistance = Math.min(
      ...objectives.map((obj) => L.latLng(farthest).distanceTo(L.latLng(obj)))
    );
    return currentMinDistance > farthestMinDistance ? current : farthest;
  });

  const closestStreetPoint = streets.reduce((closest, street) => {
    const closestPointOnStreet = street.reduce((prev, curr) =>
      L.latLng(curr).distanceTo(L.latLng(farthestPoint)) <
      L.latLng(prev).distanceTo(L.latLng(farthestPoint))
        ? curr
        : prev
    );
    return L.latLng(closestPointOnStreet).distanceTo(L.latLng(farthestPoint)) <
      L.latLng(closest).distanceTo(L.latLng(farthestPoint))
      ? closestPointOnStreet
      : closest;
  }, streets[0][0]);

  return closestStreetPoint as [number, number];
};

export const generateStartZoneRogue = (
    center: [number, number],
    radius: number,
    startZone: [number, number],
    objectives: [number, number][],
    streets: L.LatLngTuple[][]
  ): [number, number] => {
    const angle = Math.atan2(startZone[1] - center[1], startZone[0] - center[0]);
    const randomOffset = (Math.random() * (Math.PI - Math.PI / 2)) + Math.PI / 2; // Random angle between 90 and 180 degrees
    const rogueAngle = angle + randomOffset * (Math.random() < 0.5 ? 1 : -1); // Randomly add or subtract the offset
  
    const rogueLat = center[0] + (radius / 111320) * Math.cos(rogueAngle); // Conversion en degrés
    const rogueLng = center[1] + (radius / (111320 * Math.cos(center[0]))) * Math.sin(rogueAngle); // Conversion en degrés
  
    const roguePoint: [number, number] = [rogueLat, rogueLng];
  
    const minDistance = radius / 3;
  
    const isFarEnoughFromObjectives = (point: [number, number]) => {
      return objectives.every(
        (objective) => L.latLng(point).distanceTo(L.latLng(objective)) >= minDistance
      );
    };
  
    const closestStreetPoint = streets.reduce((closest, street) => {
      const closestPointOnStreet = street.reduce((prev, curr) =>
        L.latLng(curr).distanceTo(L.latLng(roguePoint)) <
        L.latLng(prev).distanceTo(L.latLng(roguePoint))
          ? curr
          : prev
      );
      return L.latLng(closestPointOnStreet).distanceTo(L.latLng(roguePoint)) <
        L.latLng(closest).distanceTo(L.latLng(roguePoint)) &&
        isFarEnoughFromObjectives(closestPointOnStreet as [number, number])
        ? closestPointOnStreet
        : closest;
    }, streets[0][0]);
  
    return closestStreetPoint as [number, number];
  };

export const generateRandomPoints = (
  center: [number, number],
  radius: number,
  count: number,
  streets: L.LatLngTuple[][]
): [number, number][] => {
  const points: [number, number][] = [];
  const minDistance = radius / 2.5;

  const isFarEnough = (point: [number, number]) => {
    return points.every(
      (existingPoint) =>
        L.latLng(point).distanceTo(L.latLng(existingPoint)) >= minDistance
    );
  };

  let attempts = 0;
  const maxAttempts = 1000;

  while (points.length < count && attempts < maxAttempts) {
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radius;
    const newPoint: [number, number] = [
      center[0] + (distance / 111320) * Math.cos(angle),
      center[1] + (distance / (111320 * Math.cos(center[0]))) * Math.sin(angle),
    ];

    if (
      streets.some((street) =>
        street.some(
          (node) => L.latLng(node).distanceTo(L.latLng(newPoint)) < minDistance
        )
      )
    ) {
      const closestStreet = streets.find((street) =>
        street.some(
          (node) => L.latLng(node).distanceTo(L.latLng(newPoint)) < minDistance
        )
      );
      if (closestStreet) {
        const closestNode = closestStreet.reduce((prev, curr) =>
          L.latLng(curr).distanceTo(L.latLng(newPoint)) <
          L.latLng(prev).distanceTo(L.latLng(newPoint))
            ? curr
            : prev
        );
        if (isFarEnough(closestNode as [number, number])) {
          points.push(closestNode as [number, number]);
        }
      }
    }
    attempts++;
  }

  if (points.length < count) {
    throw new Error("Impossible de générer suffisamment de points éloignés.");
  }

  return points;
};

const isPointInCircle = (
  point: L.LatLngTuple,
  center: L.LatLngTuple,
  radius: number
) => {
  const distance = L.latLng(point).distanceTo(L.latLng(center));
  return distance <= radius;
};

export const clipPolyline = (
  polyline: L.LatLngTuple[],
  center: L.LatLngTuple,
  radius: number
) => {
  const clippedPolyline: L.LatLngTuple[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const point1 = polyline[i];
    const point2 = polyline[i + 1];
    const point1InCircle = isPointInCircle(point1, center, radius);
    const point2InCircle = isPointInCircle(point2, center, radius);

    if (point1InCircle && point2InCircle) {
      clippedPolyline.push(point1, point2);
    } else if (point1InCircle) {
      clippedPolyline.push(point1);
    } else if (point2InCircle) {
      clippedPolyline.push(point2);
    }
  }
  return clippedPolyline;
};

export const generateRandomPointInCircle = (center: [number, number], radius: number): [number, number] => {
  // Convertir le rayon en degrés (approximation)
  const radiusInDegrees = radius / 111000; // 111000 mètres par degré

  // Générer un angle aléatoire
  const angle = Math.random() * 2 * Math.PI;
  
  // Générer une distance aléatoire (racine carrée pour une distribution uniforme)
  const distance = Math.sqrt(Math.random()) * radiusInDegrees;
  
  // Calculer les nouvelles coordonnées
  const lat = center[0] + distance * Math.cos(angle);
  const lng = center[1] + distance * Math.sin(angle);
  
  return [lat, lng];
};

// Fonction pour calculer la distance entre deux points géographiques
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Rayon de la Terre en mètres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

// Fonction pour vérifier si le joueur est dans la zone de départ
export const checkIfInStartZone = (position: [number, number], startZoneLat: string, startZoneLon: string, radius: number = 50): boolean => {
  const distance = calculateDistance(
    position[0], 
    position[1], 
    parseFloat(startZoneLat), 
    parseFloat(startZoneLon)
  );
  return distance <= radius;
};
