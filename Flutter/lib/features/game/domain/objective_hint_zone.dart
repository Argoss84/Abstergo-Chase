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
    final edges = graph.cycleEdges.toList()
      ..sort(
        (a, b) => _distanceToSegment(objective, a.start, a.end)
            .compareTo(_distanceToSegment(objective, b.start, b.end)),
      );

    for (final edge in edges) {
      final loop = graph.pathBetween(
        edge.startKey,
        edge.endKey,
        excluding: edge.key,
      );
      if (loop != null) {
        return cachedZones[cacheKey] = _enclosingZone(objective, loop);
      }
    }

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

  double _distanceToSegment(GeoPoint point, GeoPoint start, GeoPoint end) {
    final p = _toMeters(point, point);
    final a = _toMeters(start, point);
    final b = _toMeters(end, point);
    final dx = b.x - a.x;
    final dy = b.y - a.y;
    final lengthSquared = dx * dx + dy * dy;
    if (lengthSquared == 0) {
      return sqrt(a.x * a.x + a.y * a.y);
    }
    final t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
    final clamped = t.clamp(0.0, 1.0);
    final nearestX = a.x + clamped * dx;
    final nearestY = a.y + clamped * dy;
    return sqrt(
      pow(p.x - nearestX, 2) + pow(p.y - nearestY, 2),
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
    final visited = <String>{};
    final treeEdges = <String>{};
    final cycleEdgeKeys = <String>{};
    for (final start in points.keys) {
      if (!visited.add(start)) continue;
      final queue = Queue<String>()..add(start);
      while (queue.isNotEmpty) {
        final current = queue.removeFirst();
        for (final neighbor in adjacency[current] ?? const <_Neighbor>[]) {
          if (visited.add(neighbor.nodeKey)) {
            treeEdges.add(neighbor.edgeKey);
            queue.add(neighbor.nodeKey);
          } else if (!treeEdges.contains(neighbor.edgeKey)) {
            cycleEdgeKeys.add(neighbor.edgeKey);
          }
        }
      }
    }
    return edges
        .where((edge) => cycleEdgeKeys.contains(edge.key))
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
