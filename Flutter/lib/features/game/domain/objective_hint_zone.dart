import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

class ObjectiveHintZone {
  const ObjectiveHintZone({
    required this.center,
    required this.radiusMeters,
    this.contour = const <GeoPoint>[],
  });

  final GeoPoint center;
  final double radiusMeters;

  /// Closed polygon that follows the surrounding streets.
  /// Empty when the zone falls back to a circle.
  final List<GeoPoint> contour;

  bool get hugsStreets => contour.length >= 3;
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
    final cachedZones = _zoneCache[streets] ??= <String, ObjectiveHintZone>{};
    final cached = cachedZones[cacheKey];
    if (cached != null) return cached;

    final graph = _graphCache[streets] ??= _StreetGraph.fromStreets(streets);
    final loop = graph.loopAround(objective);
    if (loop != null) {
      final zone = _zoneFromRing(
        objective: objective,
        origin: graph.origin,
        ring: loop,
      );
      if (zone != null) return cachedZones[cacheKey] = zone;
    }

    final coveredStreets = _localStreetCover(
      objective: objective,
      origin: graph.origin,
      streets: streets,
    );
    if (coveredStreets != null) {
      final zone = _zoneFromRing(
        objective: objective,
        origin: graph.origin,
        ring: coveredStreets,
      );
      if (zone != null) return cachedZones[cacheKey] = zone;
    }

    return cachedZones[cacheKey] = _fallbackZone(
      objective,
      fallbackRadiusMeters,
    );
  }

  ObjectiveHintZone? _zoneFromRing({
    required GeoPoint objective,
    required GeoPoint origin,
    required List<_XY> ring,
  }) {
    final open = _dedupeRing(ring);
    if (open.length < 3) return null;
    final normalized = _signedArea(open) < 0 ? open.reversed.toList() : open;
    final objectiveMeters = _toMeters(objective, origin);
    final contourMeters = _coverObjective(normalized, objectiveMeters);
    if (contourMeters.length < 3 ||
        !_contains(contourMeters, objectiveMeters)) {
      return null;
    }

    final centerMeters = _areaCentroid(contourMeters);
    var radius = _distance(centerMeters, objectiveMeters);
    for (final point in contourMeters) {
      radius = max(radius, _distance(centerMeters, point));
    }

    final contour = contourMeters
        .map((point) => _fromMeters(point, origin))
        .toList(growable: true);
    contour.add(contour.first);
    return ObjectiveHintZone(
      center: _fromMeters(centerMeters, origin),
      radiusMeters: radius + 1,
      contour: List<GeoPoint>.unmodifiable(contour),
    );
  }

  List<_XY> _coverObjective(List<_XY> ring, _XY objective) {
    if (_contains(ring, objective) &&
        _distanceToRing(ring, objective) >= _comfortableInsetMeters) {
      return ring;
    }
    for (var margin = 4.0; margin <= 24; margin += 4) {
      final grown = _offsetOutward(ring, margin);
      if (grown.length >= 3 && _contains(grown, objective)) return grown;
    }
    return ring;
  }

  List<_XY>? _localStreetCover({
    required GeoPoint objective,
    required GeoPoint origin,
    required List<List<GeoPoint>> streets,
  }) {
    final objectiveMeters = _toMeters(objective, origin);
    for (final radius in const <double>[36, 52, 72, 100]) {
      final covered = <int>{};
      final points = <_XY>[];
      for (var index = 0; index < streets.length; index++) {
        final street = streets[index];
        if (street.length < 2) continue;
        final clipped = <_XY>[];
        for (var i = 0; i < street.length - 1; i++) {
          final start = _toMeters(street[i], origin);
          final end = _toMeters(street[i + 1], origin);
          clipped.addAll(
            _clipSegmentToCircle(start, end, objectiveMeters, radius),
          );
        }
        if (clipped.isEmpty) continue;
        covered.add(index);
        points.addAll(clipped);
      }
      if (covered.length < _minStreets) continue;
      final hull = _convexHull(points);
      if (hull.length < 3) continue;
      final scaled = _scaleToContain(hull, objectiveMeters);
      if (scaled != null) return scaled;
    }
    return null;
  }

  List<_XY>? _scaleToContain(List<_XY> hull, _XY objective) {
    if (_contains(hull, objective)) return hull;
    final centroid = _areaCentroid(hull);
    var scale = 1.0;
    var current = hull;
    while (scale < 3) {
      scale *= 1.25;
      current = [
        for (final point in hull) centroid + (point - centroid) * scale,
      ];
      if (_contains(current, objective)) return current;
    }
    return null;
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
}

const int _minStreets = 3;
const double _comfortableInsetMeters = 4;
const double _maxLoopSpanMeters = 150;
const double _minLoopAreaMeters = 25;

class _StreetGraph {
  _StreetGraph({
    required this.origin,
    required this.xy,
    required Map<String, List<String>> adjacency,
    required this.edgeStreets,
  }) : adjacency = {
         for (final entry in adjacency.entries)
           entry.key: _sortByAngle(entry.key, entry.value, xy),
       };

  factory _StreetGraph.fromStreets(List<List<GeoPoint>> streets) {
    final origin = streets
        .expand((street) => street)
        .firstWhere(
          (point) => point.latitude.isFinite && point.longitude.isFinite,
          orElse: () => const GeoPoint(latitude: 0, longitude: 0),
        );
    final xy = <String, _XY>{};
    final adjacency = <String, List<String>>{};
    final edgeStreets = <String, int>{};

    void link(GeoPoint start, GeoPoint end, int streetIndex) {
      final startKey = _pointKey(start);
      final endKey = _pointKey(end);
      if (startKey == endKey) return;
      xy[startKey] = _toMeters(start, origin);
      xy[endKey] = _toMeters(end, origin);
      final edgeKey = _edgeKey(startKey, endKey);
      if (edgeStreets.containsKey(edgeKey)) return;
      edgeStreets[edgeKey] = streetIndex;
      adjacency.putIfAbsent(startKey, () => <String>[]).add(endKey);
      adjacency.putIfAbsent(endKey, () => <String>[]).add(startKey);
    }

    for (var streetIndex = 0; streetIndex < streets.length; streetIndex++) {
      final street = streets[streetIndex];
      for (var index = 0; index < street.length - 1; index++) {
        link(street[index], street[index + 1], streetIndex);
      }
    }

    return _StreetGraph(
      origin: origin,
      xy: xy,
      adjacency: adjacency,
      edgeStreets: edgeStreets,
    );
  }

  final GeoPoint origin;
  final Map<String, _XY> xy;
  final Map<String, List<String>> adjacency;
  final Map<String, int> edgeStreets;
  late final List<_Loop> loops = _extractLoops();

  List<_XY>? loopAround(GeoPoint objective) {
    if (loops.isEmpty) return null;
    final point = _toMeters(objective, origin);
    final strict = <_Loop>[];
    final boundary = <_Loop>[];
    for (final loop in loops) {
      if (loop.streets.length < _minStreets) continue;
      if (loop.area < _minLoopAreaMeters) continue;
      if (_maxDistance(point, loop.ring) > _maxLoopSpanMeters) continue;
      final edgeDistance = _distanceToRing(loop.ring, point);
      final inside = _contains(loop.ring, point);
      if (!inside && edgeDistance > 1.5) continue;
      if (inside && edgeDistance >= 1.5) {
        strict.add(loop);
      } else {
        boundary.add(loop);
      }
    }

    if (strict.isNotEmpty) {
      strict.sort((a, b) => a.area.compareTo(b.area));
      return strict.first.ring;
    }
    if (boundary.isEmpty) return null;
    if (boundary.length == 1) return boundary.first.ring;

    boundary.sort((a, b) => a.area.compareTo(b.area));
    final selected = boundary.take(4).toList(growable: false);
    final union = _unionLoops(selected);
    if (union != null &&
        union.streets.length >= _minStreets &&
        union.area >= _minLoopAreaMeters &&
        _maxDistance(point, union.ring) <= _maxLoopSpanMeters &&
        _contains(union.ring, point)) {
      return union.ring;
    }
    return boundary.first.ring;
  }

  List<_Loop> _extractLoops() {
    final used = <String>{};
    final loops = <_Loop>[];
    final directedBudget = edgeStreets.length * 2 + 2;
    for (final from in adjacency.keys) {
      for (final to in adjacency[from]!) {
        final startKey = '$from>$to';
        if (used.contains(startKey)) continue;
        final nodes = <String>[];
        final streets = <int>{};
        var currentFrom = from;
        var currentTo = to;
        var closed = false;
        while (nodes.length <= directedBudget) {
          final directedKey = '$currentFrom>$currentTo';
          if (used.contains(directedKey)) break;
          used.add(directedKey);
          nodes.add(currentFrom);
          streets.add(edgeStreets[_edgeKey(currentFrom, currentTo)]!);
          final hop = _nextHop(currentFrom, currentTo);
          if (hop == null) break;
          if ('$currentTo>$hop' == startKey) {
            closed = true;
            break;
          }
          currentFrom = currentTo;
          currentTo = hop;
        }
        if (!closed || nodes.length < 3) continue;
        final ring = nodes.map((key) => xy[key]!).toList(growable: false);
        final area = _signedArea(ring);
        if (area <= _minLoopAreaMeters) continue;
        loops.add(
          _Loop(nodes: nodes, ring: ring, streets: streets, area: area),
        );
      }
    }
    return loops;
  }

  String? _nextHop(String from, String to) {
    final neighbors = adjacency[to];
    if (neighbors == null || neighbors.isEmpty) return null;
    final index = neighbors.indexOf(from);
    if (index < 0) return null;
    return neighbors[(index - 1 + neighbors.length) % neighbors.length];
  }

  _Loop? _unionLoops(List<_Loop> faces) {
    final counts = <String, int>{};
    final direction = <String, (String, String)>{};
    final streets = <int>{};
    for (final face in faces) {
      streets.addAll(face.streets);
      for (var index = 0; index < face.nodes.length; index++) {
        final from = face.nodes[index];
        final to = face.nodes[(index + 1) % face.nodes.length];
        final key = _edgeKey(from, to);
        counts[key] = (counts[key] ?? 0) + 1;
        direction[key] = (from, to);
      }
    }

    final next = <String, String>{};
    for (final entry in counts.entries) {
      if (entry.value != 1) continue;
      final edge = direction[entry.key];
      if (edge == null) continue;
      if (next.containsKey(edge.$1)) return null;
      next[edge.$1] = edge.$2;
    }
    if (next.length < 3) return null;

    final start = next.keys.first;
    final nodes = <String>[];
    var cursor = start;
    while (nodes.length <= next.length) {
      if (!next.containsKey(cursor)) return null;
      nodes.add(cursor);
      cursor = next[cursor]!;
      if (cursor == start) break;
    }
    if (cursor != start || nodes.length < 3) return null;
    final ring = nodes.map((key) => xy[key]!).toList(growable: false);
    final area = _signedArea(ring).abs();
    return _Loop(nodes: nodes, ring: ring, streets: streets, area: area);
  }
}

class _Loop {
  const _Loop({
    required this.nodes,
    required this.ring,
    required this.streets,
    required this.area,
  });

  final List<String> nodes;
  final List<_XY> ring;
  final Set<int> streets;
  final double area;
}

class _XY {
  const _XY(this.x, this.y);

  final double x;
  final double y;

  _XY operator +(_XY other) => _XY(x + other.x, y + other.y);
  _XY operator -(_XY other) => _XY(x - other.x, y - other.y);
  _XY operator *(double scale) => _XY(x * scale, y * scale);
  double dot(_XY other) => x * other.x + y * other.y;
  double get length => sqrt(x * x + y * y);
}

List<String> _sortByAngle(
  String origin,
  List<String> neighbors,
  Map<String, _XY> xy,
) {
  final originPoint = xy[origin]!;
  final unique = neighbors.toSet().toList(growable: false);
  final sorted = [...unique]
    ..sort((a, b) {
      final pa = xy[a]!;
      final pb = xy[b]!;
      return atan2(
        pa.y - originPoint.y,
        pa.x - originPoint.x,
      ).compareTo(atan2(pb.y - originPoint.y, pb.x - originPoint.x));
    });
  return sorted;
}

String _pointKey(GeoPoint point) =>
    '${point.latitude.toStringAsFixed(6)},${point.longitude.toStringAsFixed(6)}';

String _edgeKey(String a, String b) => a.compareTo(b) < 0 ? '$a|$b' : '$b|$a';

_XY _toMeters(GeoPoint point, GeoPoint origin) {
  final metersPerDegreeLng = 111320.0 * cos(origin.latitude * pi / 180).abs();
  return _XY(
    (point.longitude - origin.longitude) * metersPerDegreeLng,
    (point.latitude - origin.latitude) * 111320.0,
  );
}

GeoPoint _fromMeters(_XY point, GeoPoint origin) {
  final metersPerDegreeLng = 111320.0 * cos(origin.latitude * pi / 180).abs();
  return GeoPoint(
    latitude: origin.latitude + point.y / 111320.0,
    longitude: origin.longitude + point.x / max(metersPerDegreeLng, 0.000001),
  );
}

double _distance(_XY a, _XY b) {
  final dx = a.x - b.x;
  final dy = a.y - b.y;
  return sqrt(dx * dx + dy * dy);
}

double _maxDistance(_XY point, List<_XY> ring) {
  var maxDistance = 0.0;
  for (final vertex in ring) {
    maxDistance = max(maxDistance, _distance(point, vertex));
  }
  return maxDistance;
}

double _signedArea(List<_XY> ring) {
  var sum = 0.0;
  for (var index = 0; index < ring.length; index++) {
    final next = ring[(index + 1) % ring.length];
    sum += ring[index].x * next.y - next.x * ring[index].y;
  }
  return sum / 2;
}

_XY _areaCentroid(List<_XY> ring) {
  var twiceArea = 0.0;
  var cx = 0.0;
  var cy = 0.0;
  for (var index = 0; index < ring.length; index++) {
    final current = ring[index];
    final next = ring[(index + 1) % ring.length];
    final cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }
  if (twiceArea.abs() < 1e-6) {
    var x = 0.0;
    var y = 0.0;
    for (final point in ring) {
      x += point.x;
      y += point.y;
    }
    return _XY(x / ring.length, y / ring.length);
  }
  return _XY(cx / (3 * twiceArea), cy / (3 * twiceArea));
}

bool _contains(List<_XY> ring, _XY point) {
  if (_distanceToRing(ring, point) <= 1) return true;
  var inside = false;
  for (
    var index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    final current = ring[index];
    final prior = ring[previous];
    final crosses = (current.y > point.y) != (prior.y > point.y);
    if (!crosses) continue;
    final x =
        (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) +
        current.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

double _distanceToRing(List<_XY> ring, _XY point) {
  var best = double.infinity;
  for (var index = 0; index < ring.length; index++) {
    best = min(
      best,
      _distanceToSegment(point, ring[index], ring[(index + 1) % ring.length]),
    );
  }
  return best;
}

double _distanceToSegment(_XY point, _XY start, _XY end) {
  final delta = end - start;
  final lengthSquared = delta.dot(delta);
  if (lengthSquared == 0) return _distance(point, start);
  final t = ((point - start).dot(delta) / lengthSquared).clamp(0.0, 1.0);
  return _distance(point, start + delta * t);
}

List<_XY> _dedupeRing(List<_XY> ring) {
  final deduped = <_XY>[];
  for (final point in ring) {
    if (deduped.isEmpty || _distance(deduped.last, point) > 0.4) {
      deduped.add(point);
    }
  }
  if (deduped.length >= 2 && _distance(deduped.first, deduped.last) <= 0.4) {
    deduped.removeLast();
  }
  return deduped;
}

List<_XY> _offsetOutward(List<_XY> ring, double distance) {
  final count = ring.length;
  if (count < 3) return ring;
  final offset = <_XY>[];
  for (var index = 0; index < count; index++) {
    final previous = ring[(index - 1 + count) % count];
    final current = ring[index];
    final next = ring[(index + 1) % count];
    final incoming = current - previous;
    final outgoing = next - current;
    final incomingLength = incoming.length;
    final outgoingLength = outgoing.length;
    if (incomingLength < 1e-6 || outgoingLength < 1e-6) {
      offset.add(current);
      continue;
    }
    final n1 = _XY(incoming.y / incomingLength, -incoming.x / incomingLength);
    final n2 = _XY(outgoing.y / outgoingLength, -outgoing.x / outgoingLength);
    final hit = _lineIntersection(
      current + n1 * distance,
      incoming * (1 / incomingLength),
      current + n2 * distance,
      outgoing * (1 / outgoingLength),
    );
    final bisector = n1 + n2;
    final bisectorLength = bisector.length;
    final fallback = bisectorLength < 1e-6
        ? current + n1 * distance
        : current + bisector * (distance / bisectorLength);
    if (hit == null || _distance(hit, current) > distance * 4) {
      offset.add(fallback);
    } else {
      offset.add(hit);
    }
  }
  return offset;
}

_XY? _lineIntersection(
  _XY origin,
  _XY direction,
  _XY other,
  _XY otherDirection,
) {
  final det = direction.x * otherDirection.y - direction.y * otherDirection.x;
  if (det.abs() < 1e-8) return null;
  final delta = other - origin;
  final t = (delta.x * otherDirection.y - delta.y * otherDirection.x) / det;
  return origin + direction * t;
}

List<_XY> _clipSegmentToCircle(_XY start, _XY end, _XY center, double radius) {
  final points = <_XY>[];
  if (_distance(start, center) <= radius) points.add(start);
  if (_distance(end, center) <= radius) points.add(end);
  final delta = end - start;
  final relative = start - center;
  final a = delta.dot(delta);
  if (a < 1e-8) return points;
  final b = 2 * relative.dot(delta);
  final c = relative.dot(relative) - radius * radius;
  final discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return points;
  final root = sqrt(discriminant);
  for (final t in <double>[(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t >= 0 && t <= 1) points.add(start + delta * t);
  }
  return points;
}

List<_XY> _convexHull(List<_XY> points) {
  final sorted = [...points]
    ..sort((a, b) {
      final dx = a.x.compareTo(b.x);
      return dx != 0 ? dx : a.y.compareTo(b.y);
    });
  final unique = <_XY>[];
  for (final point in sorted) {
    if (unique.isEmpty || _distance(unique.last, point) > 0.2) {
      unique.add(point);
    }
  }
  if (unique.length < 3) return unique;

  double cross(_XY origin, _XY a, _XY b) =>
      (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

  final lower = <_XY>[];
  for (final point in unique) {
    while (lower.length >= 2 &&
        cross(lower[lower.length - 2], lower.last, point) <= 0) {
      lower.removeLast();
    }
    lower.add(point);
  }
  final upper = <_XY>[];
  for (final point in unique.reversed) {
    while (upper.length >= 2 &&
        cross(upper[upper.length - 2], upper.last, point) <= 0) {
      upper.removeLast();
    }
    upper.add(point);
  }
  lower.removeLast();
  upper.removeLast();
  return <_XY>[...lower, ...upper];
}
