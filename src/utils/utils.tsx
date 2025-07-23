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

/**
 * Calcule un itinéraire simple (ligne droite) entre deux points.
 * @param from Point de départ [lat, lng]
 * @param to Point d'arrivée [lat, lng]
 * @returns Tableau de points représentant l'itinéraire
 */
export function getStraightLineItinerary(from: [number, number], to: [number, number]): [number, number][] {
  return [from, to];
}

/**
 * Récupère les rues via l'API Overpass autour d'un centre et d'un rayon.
 * @param lat Latitude du centre
 * @param lng Longitude du centre
 * @param radius Rayon en mètres
 * @returns Promise<L.LatLngTuple[][]> Les rues sous forme de tableaux de points
 */
export async function fetchStreetsFromOverpass(lat: number, lng: number, radius: number): Promise<L.LatLngTuple[][]> {
  const query = `
    [out:json];
    (
      way(around:${radius},${lat},${lng})["highway"]["foot"!~"no"];
      way(around:${radius},${lat},${lng})["amenity"="square"]["foot"!~"no"];
    );
    (._;>;);
    out;
  `;
  const overpassUrl = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
  const response = await fetch(overpassUrl);
  const data = await response.json();
  const ways = data.elements.filter((el: any) => el.type === "way");
  const nodes = data.elements.filter((el: any) => el.type === "node");
  const nodeMap = new Map(nodes.map((node: any) => [node.id, [node.lat, node.lon]]));
  const streetLines = ways.map((way: any) => way.nodes.map((nodeId: any) => nodeMap.get(nodeId)));
  return streetLines;
}

/**
 * Trouve le point de rue le plus proche d'une position.
 * @param point [lat, lng]
 * @param streets L.LatLngTuple[][]
 * @returns [lat, lng] le point de rue le plus proche
 */
export function getNearestStreetPoint(point: [number, number], streets: L.LatLngTuple[][]): [number, number] {
  let minDist = Infinity;
  let nearest: [number, number] = streets[0][0] as [number, number];
  for (const street of streets) {
    for (const node of street) {
      const dist = L.latLng(point).distanceTo(L.latLng(node));
      if (dist < minDist) {
        minDist = dist;
        nearest = (node as [number, number]);
      }
    }
  }
  return nearest;
}

/**
 * Calcule le plus court chemin sur le graphe des rues entre deux points (Dijkstra simplifié).
 * @param from [lat, lng] point de départ
 * @param to [lat, lng] point d'arrivée
 * @param streets L.LatLngTuple[][]
 * @returns Tableau de points représentant le chemin
 */
export function getShortestPathOnStreets(from: [number, number], to: [number, number], streets: L.LatLngTuple[][]): [number, number][] {
  // 1. Construire la liste des nœuds et des arêtes
  const nodes: [number, number][] = [];
  const edges: Map<string, { to: string, weight: number }[]> = new Map();
  const nodeKey = (pt: [number, number]) => `${pt[0]},${pt[1]}`;

  for (const street of streets) {
    for (let i = 0; i < street.length; i++) {
      const pt = street[i] as [number, number];
      if (!nodes.some(n => n[0] === pt[0] && n[1] === pt[1])) nodes.push(pt);
      if (i > 0) {
        const prev = street[i - 1] as [number, number];
        const dist = L.latLng(pt).distanceTo(L.latLng(prev));
        // Ajout arête bidirectionnelle
        edges.set(nodeKey(pt), [...(edges.get(nodeKey(pt)) || []), { to: nodeKey(prev), weight: dist }]);
        edges.set(nodeKey(prev), [...(edges.get(nodeKey(prev)) || []), { to: nodeKey(pt), weight: dist }]);
      }
    }
  }

  // 2. Ajouter les points de départ et d'arrivée comme nœuds reliés à leur rue la plus proche
  const fromNode = getNearestStreetPoint(from, streets);
  const toNode = getNearestStreetPoint(to, streets);
  if (!nodes.some(n => n[0] === fromNode[0] && n[1] === fromNode[1])) nodes.push(fromNode);
  if (!nodes.some(n => n[0] === toNode[0] && n[1] === toNode[1])) nodes.push(toNode);
  edges.set(nodeKey(from), [{ to: nodeKey(fromNode), weight: L.latLng(from).distanceTo(L.latLng(fromNode)) }]);
  edges.set(nodeKey(fromNode), [...(edges.get(nodeKey(fromNode)) || []), { to: nodeKey(from), weight: L.latLng(from).distanceTo(L.latLng(fromNode)) }]);
  edges.set(nodeKey(to), [{ to: nodeKey(toNode), weight: L.latLng(to).distanceTo(L.latLng(toNode)) }]);
  edges.set(nodeKey(toNode), [...(edges.get(nodeKey(toNode)) || []), { to: nodeKey(to), weight: L.latLng(to).distanceTo(L.latLng(toNode)) }]);
  nodes.push(from);
  nodes.push(to);

  // 3. Dijkstra
  const distMap = new Map<string, number>();
  const prevMap = new Map<string, string | null>();
  const queue = new Set<string>(nodes.map(nodeKey));
  for (const n of queue) distMap.set(n, Infinity);
  distMap.set(nodeKey(from), 0);
  prevMap.set(nodeKey(from), null);

  while (queue.size > 0) {
    // Trouver le nœud avec la plus petite distance
    let u: string | null = null;
    let minDist = Infinity;
    for (const n of queue) {
      const d = distMap.get(n) ?? Infinity;
      if (d < minDist) {
        minDist = d;
        u = n;
      }
    }
    if (u === null) break;
    queue.delete(u);
    if (u === nodeKey(to)) break;
    const neighbors = edges.get(u) || [];
    for (const { to: v, weight } of neighbors) {
      if (!queue.has(v)) continue;
      const alt = (distMap.get(u) ?? Infinity) + weight;
      if (alt < (distMap.get(v) ?? Infinity)) {
        distMap.set(v, alt);
        prevMap.set(v, u);
      }
    }
  }

  // 4. Reconstruire le chemin
  const path: [number, number][] = [];
  let curr: string | null = nodeKey(to);
  while (curr && curr !== nodeKey(from)) {
    const [lat, lng] = curr.split(',').map(Number);
    path.unshift([lat, lng]);
    curr = prevMap.get(curr) ?? null;
  }
  path.unshift(from);
  return path;
}
