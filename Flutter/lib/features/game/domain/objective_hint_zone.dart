import 'dart:collection';
import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

class ObjectiveHintZone {
  const ObjectiveHintZone({
    required this.center,
    required this.radiusMeters,
  });

  final GeoPoint center;
  final double radiusMeters;
}

class ObjectiveHintZoneCalculator {
  const ObjectiveHintZoneCalculator();

  static final Expando<_StreetGraph> _graphCache = Expando<_StreetGraph>();
  static final Expando<Map<String, ObjectiveHintZone>> _zoneCache =
      Expando<Map<String, ObjectiveHintZone>>();

  ObjectiveHintZone calculate({
    required GeoPoint objective,
    required List<List<GeoPoint>> streets,
    double fallbackRadiusMeters = 25,
  }) {
    final cacheKey =
        '${objective.latitude},${objective.longitude},$fallbackRadiusMeters';
    final cachedZones =
        _zoneCache[streets] ??= <String, ObjectiveHintZone>{};
    final cached = cachedZones[cacheKey];
    if (cached != null) return cached;

    final graph =
        _graphCache[streets] ??= _StreetGraph.fromStreets(streets);
    final candidates = graph.cycleEdges.toList()
      ..sort(
        (a, b) => _distanceToSegment(objective, a.start, a.end)
            .compareTo(_distanceToSegment(objective, b.start, b.end)),
      );
    ObjectiveHintZone? bestZone;
    for (final edge in candidates.take(24)) {
      final loop = graph.pathBetween(
        edge.startKey,
        edge.endKey,
        excluding: edge.key,
      );
      if (loop == null) continue;
      final zone = _enclosingZone(objective, loop);
      if (bestZone == null || zone.radiusMeters < bestZone.radiusMeters) {
        bestZone = zone;
      }
    }
    if (bestZone != null) return cachedZones[cacheKey] = bestZone;

    return cachedZones[cacheKey] = _fallbackZone(
      objective,
      fallbackRadiusMeters,
    );
  }

  double _distanceToSegment(GeoPoint point, GeoPoint start, GeoPoint end) {
    final a = _toMeters(start, point);
    final b = _toMeters(end, point);
    final dx = b.x - a.x;
    final dy = b.y - a.y;
    final lengthSquared = dx * dx + dy * dy;
    if (lengthSquared == 0) return sqrt(a.x * a.x + a.y * a.y);
    final t = (-(a.x * dx + a.y * dy) / lengthSquared).clamp(0.0, 1.0);
    final nearestX = a.x + t * dx;
    final nearestY = a.y + t * dy;
    return sqrt(nearestX * nearestX + nearestY * nearestY);
  }

  ObjectiveHintZone _enclosingZone(
    GeoPoint objective,
    List<GeoPoint> loop,
  ) {
    final points = <GeoPoint>[objective, ...loop];
    final projected = points.map((point) => _toMeters(point, objective)).toList();
    final minX = projected.map((point) => point.x).reduce(min);
    final maxX = projected.map((point) => point.x).reduce(max);
    final minY = projected.map((point) => point.y).reduce(min);
    final maxY = projected.map((point) => point.y).reduce(max);
    final centerMeters = _XY((minX + maxX) / 2, (minY + maxY) / 2);
    final radius = projected
        .map(
          (point) => sqrt(
            pow(point.x - centerMeters.x, 2) +
                pow(point.y - centerMeters.y, 2),
          ),
        )
        .reduce(max);

    return ObjectiveHintZone(
      center: _fromMeters(centerMeters, objective),
      radiusMeters: radius + 5,
    );
  }

  ObjectiveHintZone _fallbackZone(GeoPoint objective, double radiusMeters) {
    if (radiusMeters <= 1) {
      return ObjectiveHintZone(center: objective, radiusMeters: radiusMeters);
    }
    final seed = _stableHash('${objective.latitude},${objective.longitude}');
    final angle = (seed % 360) * pi / 180;
    final distance = radiusMeters * (0.35 + (seed % 25) / 100);
    return ObjectiveHintZone(
      center: _fromMeters(
        _XY(distance * cos(angle), distance * sin(angle)),
        objective,
      ),
      radiusMeters: radiusMeters,
    );
  }

  int _stableHash(String value) {
    var hash = 2166136261;
    for (final code in value.codeUnits) {
      hash ^= code;
      hash = (hash * 16777619) & 0x7fffffff;
    }
    return hash;
  }

  _XY _toMeters(GeoPoint point, GeoPoint origin) {
    final metersPerDegreeLng =
        111320.0 * cos(origin.latitude * pi / 180).abs();
    return _XY(
      (point.longitude - origin.longitude) * metersPerDegreeLng,
      (point.latitude - origin.latitude) * 111320.0,
    );
  }

  GeoPoint _fromMeters(_XY point, GeoPoint origin) {
    final metersPerDegreeLng =
        111320.0 * cos(origin.latitude * pi / 180).abs();
    return GeoPoint(
      latitude: origin.latitude + point.y / 111320.0,
      longitude:
          origin.longitude + point.x / max(metersPerDegreeLng, 0.000001),
    );
  }
}

class _StreetGraph {
  _StreetGraph({
    required this.points,
    required this.adjacency,
    required this.edges,
  });

  factory _StreetGraph.fromStreets(List<List<GeoPoint>> streets) {
    final points = <String, GeoPoint>{};
    final adjacency = <String, List<_Neighbor>>{};
    final edges = <String, _Edge>{};
    for (final street in streets.where((street) => street.length >= 2)) {
      for (var index = 0; index < street.length - 1; index++) {
        final start = street[index];
        final end = street[index + 1];
        final startKey = _pointKey(start);
        final endKey = _pointKey(end);
        if (startKey == endKey) continue;
        final edgeKey = _edgeKey(startKey, endKey);
        points[startKey] = start;
        points[endKey] = end;
        if (edges.containsKey(edgeKey)) continue;
        edges[edgeKey] = _Edge(
          key: edgeKey,
          startKey: startKey,
          endKey: endKey,
          start: start,
          end: end,
        );
        adjacency.putIfAbsent(startKey, () => <_Neighbor>[]).add(
          _Neighbor(endKey, edgeKey),
        );
        adjacency.putIfAbsent(endKey, () => <_Neighbor>[]).add(
          _Neighbor(startKey, edgeKey),
        );
      }
    }
    return _StreetGraph(
      points: points,
      adjacency: adjacency,
      edges: edges.values.toList(growable: false),
    );
  }

  final Map<String, GeoPoint> points;
  final Map<String, List<_Neighbor>> adjacency;
  final List<_Edge> edges;
  late final List<_Edge> cycleEdges = _findCycleEdges();

  List<_Edge> _findCycleEdges() {
    final discovered = <String, int>{};
    final low = <String, int>{};
    final bridges = <String>{};
    var time = 0;

    for (final root in points.keys) {
      if (discovered.containsKey(root)) continue;
      discovered[root] = time;
      low[root] = time;
      time++;
      final stack = <_DfsFrame>[_DfsFrame(node: root)];
      while (stack.isNotEmpty) {
        final frame = stack.last;
        final neighbors = adjacency[frame.node] ?? const <_Neighbor>[];
        if (frame.nextNeighborIndex < neighbors.length) {
          final neighbor = neighbors[frame.nextNeighborIndex++];
          if (neighbor.edgeKey == frame.parentEdge) continue;
          if (!discovered.containsKey(neighbor.nodeKey)) {
            discovered[neighbor.nodeKey] = time;
            low[neighbor.nodeKey] = time;
            time++;
            stack.add(
              _DfsFrame(
                node: neighbor.nodeKey,
                parentNode: frame.node,
                parentEdge: neighbor.edgeKey,
              ),
            );
          } else {
            low[frame.node] = min(
              low[frame.node]!,
              discovered[neighbor.nodeKey]!,
            );
          }
          continue;
        }

        stack.removeLast();
        if (frame.parentNode != null && frame.parentEdge != null) {
          low[frame.parentNode!] = min(
            low[frame.parentNode!]!,
            low[frame.node]!,
          );
          if (low[frame.node]! > discovered[frame.parentNode!]!) {
            bridges.add(frame.parentEdge!);
          }
        }
      }
    }

    return edges
        .where((edge) => !bridges.contains(edge.key))
        .toList(growable: false);
  }

  List<GeoPoint>? pathBetween(
    String start,
    String end, {
    required String excluding,
  }) {
    final queue = Queue<String>()..add(start);
    final previous = <String, String?>{start: null};
    while (queue.isNotEmpty) {
      final current = queue.removeFirst();
      if (current == end) break;
      for (final neighbor in adjacency[current] ?? const <_Neighbor>[]) {
        if (neighbor.edgeKey == excluding ||
            previous.containsKey(neighbor.nodeKey)) {
          continue;
        }
        previous[neighbor.nodeKey] = current;
        queue.add(neighbor.nodeKey);
      }
    }
    if (!previous.containsKey(end)) return null;

    final path = <GeoPoint>[];
    String? current = end;
    while (current != null) {
      path.add(points[current]!);
      current = previous[current];
    }
    return path.reversed.toList(growable: false);
  }

  static String _pointKey(GeoPoint point) =>
      '${point.latitude.toStringAsFixed(7)},'
      '${point.longitude.toStringAsFixed(7)}';

  static String _edgeKey(String a, String b) =>
      a.compareTo(b) < 0 ? '$a|$b' : '$b|$a';
}

class _Neighbor {
  const _Neighbor(this.nodeKey, this.edgeKey);

  final String nodeKey;
  final String edgeKey;
}

class _DfsFrame {
  _DfsFrame({
    required this.node,
    this.parentNode,
    this.parentEdge,
  });

  final String node;
  final String? parentNode;
  final String? parentEdge;
  int nextNeighborIndex = 0;
}

class _Edge {
  const _Edge({
    required this.key,
    required this.startKey,
    required this.endKey,
    required this.start,
    required this.end,
  });

  final String key;
  final String startKey;
  final String endKey;
  final GeoPoint start;
  final GeoPoint end;
}

class _XY {
  const _XY(this.x, this.y);

  final double x;
  final double y;
}
