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
    ObjectiveHintZone? bestZone;
    for (final loop in graph.cycles) {
      final zone = _enclosingZone(objective, loop);
      if (bestZone == null || zone.radiusMeters < bestZone.radiusMeters) {
        bestZone = zone;
      }
    }
    if (bestZone != null) return cachedZones[cacheKey] = bestZone;

    return cachedZones[cacheKey] = ObjectiveHintZone(
      center: objective,
      radiusMeters: fallbackRadiusMeters,
    );
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
  late final List<List<GeoPoint>> cycles = _findCycles();

  List<List<GeoPoint>> _findCycles() {
    final visited = <String>{};
    final treeEdges = <String>{};
    final cycleEdgeKeys = <String>{};
    final parent = <String, String?>{};
    for (final start in points.keys) {
      if (!visited.add(start)) continue;
      parent[start] = null;
      final queue = Queue<String>()..add(start);
      while (queue.isNotEmpty) {
        final current = queue.removeFirst();
        for (final neighbor in adjacency[current] ?? const <_Neighbor>[]) {
          if (visited.add(neighbor.nodeKey)) {
            treeEdges.add(neighbor.edgeKey);
            parent[neighbor.nodeKey] = current;
            queue.add(neighbor.nodeKey);
          } else if (!treeEdges.contains(neighbor.edgeKey)) {
            cycleEdgeKeys.add(neighbor.edgeKey);
          }
        }
      }
    }

    final edgesByKey = <String, _Edge>{
      for (final edge in edges) edge.key: edge,
    };
    final cycles = <List<GeoPoint>>[];
    for (final edgeKey in cycleEdgeKeys) {
      final edge = edgesByKey[edgeKey]!;
      final startAncestors = <String, int>{};
      final startPath = <String>[];
      String? current = edge.startKey;
      while (current != null) {
        startAncestors[current] = startPath.length;
        startPath.add(current);
        current = parent[current];
      }

      final endPath = <String>[];
      current = edge.endKey;
      while (current != null && !startAncestors.containsKey(current)) {
        endPath.add(current);
        current = parent[current];
      }
      if (current == null) continue;
      final commonIndex = startAncestors[current]!;
      final keys = <String>[
        ...startPath.take(commonIndex + 1),
        ...endPath.reversed,
      ];
      cycles.add(
        keys.map((key) => points[key]!).toList(growable: false),
      );
    }
    return cycles;
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

class _Edge {
  const _Edge({
    required this.key,
    required this.startKey,
    required this.endKey,
  });

  final String key;
  final String startKey;
  final String endKey;
}

class _XY {
  const _XY(this.x, this.y);

  final double x;
  final double y;
}
