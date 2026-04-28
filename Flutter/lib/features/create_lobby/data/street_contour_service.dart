import 'dart:math';

import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';

class StreetContourService {
  const StreetContourService();

  static const double _metersPerDegreeLat = 111320.0;

  List<GeoPoint> computeOuterContour({
    required GeoPoint center,
    required int radiusMeters,
    required List<List<GeoPoint>> streets,
  }) {
    final sanitizedStreets = streets
        .map((street) => street.toList(growable: false))
        .where((street) => street.length >= 2)
        .toList(growable: false);
    if (sanitizedStreets.isEmpty) return const <GeoPoint>[];

    final raw = _dedupePoints(
      <GeoPoint>[
        ..._collectStreetNodes(sanitizedStreets),
        ..._collectStreetCircleIntersections(
          center,
          radiusMeters.toDouble(),
          sanitizedStreets,
        ),
      ],
      minDistanceMeters: 2,
    );
    final reduced = _dedupeByGrid(
      raw,
      cellSizeMeters: max(8, radiusMeters * 0.01),
      center: center,
    );
    final graphBoundary = _buildGraphStreetBoundary(
      center: center,
      streets: sanitizedStreets,
      targetInsetMeters: 10,
      bins: 56,
    );
    if (graphBoundary.length >= 4) {
      final noInwardBoundary =
          _removeInwardDents(center: center, ring: graphBoundary);
      if (noInwardBoundary.length >= 4) {
        return _ensureAllStreetsCovered(
          center: center,
          ring: noInwardBoundary,
          streets: sanitizedStreets,
        );
      }
      return _ensureAllStreetsCovered(
        center: center,
        ring: graphBoundary,
        streets: sanitizedStreets,
      );
    }
    final streetHuggingRing = _buildStreetHuggingRing(
      center: center,
      candidates: raw,
      radiusMeters: radiusMeters.toDouble(),
      bins: 96,
    );
    if (streetHuggingRing.length >= 4) {
      return _ensureAllStreetsCovered(
        center: center,
        ring: streetHuggingRing,
        streets: sanitizedStreets,
      );
    }
    if (reduced.length < 3) {
      return reduced.isEmpty ? const <GeoPoint>[] : <GeoPoint>[...reduced, reduced.first];
    }

    final meters = reduced.map((p) => _toMeters(center, p)).toList(growable: false);
    final hullMeters = _concaveHullClosedMeters(
      meters,
      concavity: 2,
      lengthThreshold: max(25, radiusMeters * 0.03),
    );
    final ring = hullMeters.length >= 4
        ? hullMeters.map((p) => _fromMeters(center, p)).toList(growable: false)
        : _convexHullClosedMeters(meters)
            .map((p) => _fromMeters(center, p))
            .toList(growable: false);
    if (ring.length < 4) return const <GeoPoint>[];
    return _ensureAllStreetsCovered(
      center: center,
      ring: ring,
      streets: sanitizedStreets,
    );
  }

  List<GeoPoint> _ensureAllStreetsCovered({
    required GeoPoint center,
    required List<GeoPoint> ring,
    required List<List<GeoPoint>> streets,
  }) {
    if (ring.length < 4) return ring;
    final openRing = [...ring];
    if (_distanceMeters(openRing.first, openRing.last) < 2) {
      openRing.removeLast();
    }
    if (openRing.length < 3) return ring;

    const bins = 128;
    const marginMeters = 5.0;
    final distances = List<double>.filled(bins, 0);

    for (final p in openRing) {
      final m = _toMeters(center, p);
      final r = sqrt(m.x * m.x + m.y * m.y);
      final a = (atan2(m.y, m.x) + 2 * pi) % (2 * pi);
      final bin = (a / (2 * pi) * bins).floor() % bins;
      if (r > distances[bin]) {
        distances[bin] = r;
      }
    }

    for (var i = 0; i < bins; i++) {
      if (distances[i] > 0) continue;
      final prev = _findPrevKnownDistance(distances, i);
      final next = _findNextKnownDistance(distances, i);
      distances[i] = ((prev ?? 0) + (next ?? 0)) > 0
          ? ((prev ?? next ?? 0) + (next ?? prev ?? 0)) / 2
          : 10;
    }

    for (final street in streets) {
      for (final point in street) {
        final m = _toMeters(center, point);
        final r = sqrt(m.x * m.x + m.y * m.y) + marginMeters;
        final a = (atan2(m.y, m.x) + 2 * pi) % (2 * pi);
        final bin = (a / (2 * pi) * bins).floor() % bins;
        for (final offset in const [-1, 0, 1]) {
          final idx = (bin + offset + bins) % bins;
          if (r > distances[idx]) {
            distances[idx] = r;
          }
        }
      }
    }

    final smooth = _smoothCircularDistances(distances, passes: 1);
    final rebuilt = <GeoPoint>[];
    for (var i = 0; i < bins; i++) {
      final angle = (i / bins) * 2 * pi;
      final d = smooth[i];
      final p = _fromMeters(center, _XY(d * cos(angle), d * sin(angle)));
      if (rebuilt.isEmpty || _distanceMeters(rebuilt.last, p) >= 2.5) {
        rebuilt.add(p);
      }
    }
    if (rebuilt.length < 3) return ring;
    final cleaned = _removeInwardDents(
      center: center,
      ring: <GeoPoint>[...rebuilt, rebuilt.first],
    );
    return cleaned.length >= 4 ? cleaned : <GeoPoint>[...rebuilt, rebuilt.first];
  }

  List<GeoPoint> _buildGraphStreetBoundary({
    required GeoPoint center,
    required List<List<GeoPoint>> streets,
    required double targetInsetMeters,
    required int bins,
  }) {
    final graph = _buildStreetGraph(streets);
    if (graph.nodes.length < 3) {
      return const <GeoPoint>[];
    }

    final nodes = graph.nodes;
    final radii = List<double>.generate(
      nodes.length,
      (i) => _distanceMeters(center, nodes[i]),
      growable: false,
    );
    final maxRadius = radii.reduce(max);
    final targetRadius = max(10, maxRadius - targetInsetMeters);

    final anchorsByBin = List<int?>.filled(bins, null);
    for (var i = 0; i < nodes.length; i++) {
      final point = nodes[i];
      final xy = _toMeters(center, point);
      final angle = (atan2(xy.y, xy.x) + 2 * pi) % (2 * pi);
      final bin = (angle / (2 * pi) * bins).floor() % bins;
      final current = anchorsByBin[bin];
      if (current == null) {
        anchorsByBin[bin] = i;
        continue;
      }
      final curScore = (radii[current] - targetRadius).abs();
      final nextScore = (radii[i] - targetRadius).abs();
      if (nextScore < curScore) {
        anchorsByBin[bin] = i;
      }
    }

    final anchors = <int>[];
    for (final idx in anchorsByBin) {
      if (idx != null) {
        if (anchors.isEmpty || anchors.last != idx) {
          anchors.add(idx);
        }
      }
    }
    if (anchors.length < 6) {
      return const <GeoPoint>[];
    }

    final ring = <GeoPoint>[];
    for (var i = 0; i < anchors.length; i++) {
      final from = anchors[i];
      final to = anchors[(i + 1) % anchors.length];
      final path = _shortestStreetPath(
        graph: graph,
        center: center,
        radii: radii,
        from: from,
        to: to,
        minEnvelopeRadius:
            min(radii[from], radii[to]) - max(8.0, targetInsetMeters * 1.2),
      );
      if (path.isEmpty) {
        return const <GeoPoint>[];
      }
      final points = path.map((id) => nodes[id]).toList(growable: false);
      if (ring.isEmpty) {
        ring.addAll(points);
      } else {
        ring.addAll(points.skip(1));
      }
    }

    final deduped = _dedupePoints(ring, minDistanceMeters: 2.5);
    if (deduped.length < 4) {
      return const <GeoPoint>[];
    }
    if (_distanceMeters(deduped.first, deduped.last) < 3) {
      return deduped;
    }
    return <GeoPoint>[...deduped, deduped.first];
  }

  _StreetGraph _buildStreetGraph(List<List<GeoPoint>> streets) {
    final keyToId = <String, int>{};
    final nodes = <GeoPoint>[];
    final adjacency = <int, List<_GraphEdge>>{};

    int ensureNode(GeoPoint p) {
      final key = _nodeKey(p);
      final existing = keyToId[key];
      if (existing != null) return existing;
      final id = nodes.length;
      keyToId[key] = id;
      nodes.add(p);
      adjacency[id] = <_GraphEdge>[];
      return id;
    }

    for (final street in streets) {
      for (var i = 0; i < street.length - 1; i++) {
        final aId = ensureNode(street[i]);
        final bId = ensureNode(street[i + 1]);
        if (aId == bId) continue;
        final w = _distanceMeters(street[i], street[i + 1]);
        adjacency[aId]!.add(_GraphEdge(to: bId, weight: w));
        adjacency[bId]!.add(_GraphEdge(to: aId, weight: w));
      }
    }

    return _StreetGraph(nodes: nodes, adjacency: adjacency);
  }

  String _nodeKey(GeoPoint p) {
    final lat = p.latitude.toStringAsFixed(6);
    final lng = p.longitude.toStringAsFixed(6);
    return '$lat:$lng';
  }

  List<int> _shortestStreetPath({
    required _StreetGraph graph,
    required GeoPoint center,
    required List<double> radii,
    required int from,
    required int to,
    required double minEnvelopeRadius,
  }) {
    if (from == to) return <int>[from];
    final dist = <int, double>{from: 0};
    final prev = <int, int>{};
    final queue = <_QueueNode>[_QueueNode(id: from, cost: 0)];
    final visited = <int>{};

    while (queue.isNotEmpty) {
      queue.sort((a, b) => a.cost.compareTo(b.cost));
      final current = queue.removeAt(0);
      if (!visited.add(current.id)) continue;
      if (current.id == to) break;

      final edges = graph.adjacency[current.id] ?? const <_GraphEdge>[];
      for (final edge in edges) {
        if (visited.contains(edge.to)) continue;
        final fromRadius = radii[current.id];
        final toRadius = radii[edge.to];
        final inwardDelta = max(0.0, fromRadius - toRadius);
        if (inwardDelta > 7.5 && toRadius < minEnvelopeRadius) {
          // Hard rule: avoid returning to center when already on the outer belt.
          continue;
        }
        final inwardPenalty = inwardDelta > 0 ? inwardDelta * 4.0 : 0.0;
        final envelopeDeficit = max(0.0, minEnvelopeRadius - toRadius);
        final envelopePenalty =
            envelopeDeficit * envelopeDeficit * 2.0 + envelopeDeficit * 8.0;
        final candidateCost =
            current.cost + edge.weight + inwardPenalty + envelopePenalty;
        final best = dist[edge.to];
        if (best == null || candidateCost < best) {
          dist[edge.to] = candidateCost;
          prev[edge.to] = current.id;
          queue.add(_QueueNode(id: edge.to, cost: candidateCost));
        }
      }
    }

    if (!dist.containsKey(to)) return const <int>[];
    final path = <int>[to];
    var cursor = to;
    while (cursor != from) {
      final p = prev[cursor];
      if (p == null) return const <int>[];
      path.add(p);
      cursor = p;
    }
    return path.reversed.toList(growable: false);
  }

  List<GeoPoint> _removeInwardDents({
    required GeoPoint center,
    required List<GeoPoint> ring,
  }) {
    if (ring.length < 5) return ring;
    final open = [...ring];
    if (_distanceMeters(open.first, open.last) < 2) {
      open.removeLast();
    }
    if (open.length < 4) return ring;

    var changed = true;
    var guard = 0;
    while (changed && guard++ < 6) {
      changed = false;
      final out = <GeoPoint>[];
      for (var i = 0; i < open.length; i++) {
        final prev = open[(i - 1 + open.length) % open.length];
        final cur = open[i];
        final next = open[(i + 1) % open.length];
        final rp = _distanceMeters(center, prev);
        final rc = _distanceMeters(center, cur);
        final rn = _distanceMeters(center, next);
        final localFloor = min(rp, rn) - 4.0;
        final isDent = rc < localFloor;
        if (isDent) {
          changed = true;
          continue;
        }
        out.add(cur);
      }
      if (out.length < 4) {
        return ring;
      }
      open
        ..clear()
        ..addAll(out);
    }
    final cleaned = _dedupePoints(open, minDistanceMeters: 2.5);
    if (cleaned.length < 4) return ring;
    return <GeoPoint>[...cleaned, cleaned.first];
  }

  List<GeoPoint> _buildStreetHuggingRing({
    required GeoPoint center,
    required List<GeoPoint> candidates,
    required double radiusMeters,
    required int bins,
  }) {
    if (candidates.length < 3) return const <GeoPoint>[];
    const inwardOffsetMeters = 12.0;
    final farthestByBin = List<_PolarCandidate?>.filled(bins, null);
    final polar = <_PolarCandidate>[];
    for (final point in candidates) {
      final xy = _toMeters(center, point);
      final distance = sqrt(xy.x * xy.x + xy.y * xy.y);
      if (distance < 5) continue;
      final angle = atan2(xy.y, xy.x);
      final normalized = (angle + 2 * pi) % (2 * pi);
      final bin = (normalized / (2 * pi) * bins).floor() % bins;
      final p = _PolarCandidate(point: point, angle: normalized, distance: distance);
      polar.add(p);
      final existing = farthestByBin[bin];
      if (existing == null || p.distance > existing.distance) {
        farthestByBin[bin] = p;
      }
    }
    if (polar.length < 3) return const <GeoPoint>[];

    var filledBins = farthestByBin.whereType<_PolarCandidate>().length;
    if (filledBins < (bins * 0.55).round()) {
      return const <GeoPoint>[];
    }

    final knownDistances = farthestByBin
        .whereType<_PolarCandidate>()
        .map((p) => p.distance)
        .toList(growable: false);
    final sortedDistances = [...knownDistances]..sort();
    final percentileIdx = ((sortedDistances.length - 1) * 0.7).round();
    final maxKnownDistance = sortedDistances.last;
    final minHexRadius = min(radiusMeters * 0.55, maxKnownDistance);
    final baseHexRadius =
        sortedDistances[percentileIdx].clamp(minHexRadius, maxKnownDistance);
    final hexFloor = _buildHexFloorDistances(
      bins: bins,
      hexRadius: baseHexRadius,
    );

    for (var i = 0; i < bins; i++) {
      if (farthestByBin[i] != null) continue;
      final targetAngle = (i / bins) * 2 * pi;
      _PolarCandidate? best;
      var bestScore = double.infinity;
      for (final c in polar) {
        final da = _angleDistance(targetAngle, c.angle);
        if (da > (2 * pi / bins) * 1.8) continue;
        final score = da * 160 - c.distance;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      farthestByBin[i] = best;
    }

    final targetDistances = List<double>.filled(bins, 0);
    for (var i = 0; i < bins; i++) {
      final c = farthestByBin[i];
      if (c != null) {
        targetDistances[i] = c.distance;
      }
    }

    for (var i = 0; i < bins; i++) {
      if (targetDistances[i] > 0) continue;
      final prev = _findPrevKnownDistance(targetDistances, i);
      final next = _findNextKnownDistance(targetDistances, i);
      if (prev != null && next != null) {
        targetDistances[i] = (prev + next) / 2;
      } else {
        targetDistances[i] = baseHexRadius;
      }
    }

    final smoothed = _smoothCircularDistances(targetDistances, passes: 2);
    final adjusted = List<double>.filled(bins, 0);
    for (var i = 0; i < bins; i++) {
      final inward = (smoothed[i] - inwardOffsetMeters).clamp(5.0, maxKnownDistance);
      adjusted[i] = max(inward, hexFloor[i]);
    }

    final ordered = <GeoPoint>[];
    for (var i = 0; i < bins; i++) {
      final angle = (i / bins) * 2 * pi;
      final d = adjusted[i];
      final p = _fromMeters(center, _XY(d * cos(angle), d * sin(angle)));
      if (ordered.isEmpty || _distanceMeters(ordered.last, p) >= 3) {
        ordered.add(p);
      }
    }
    if (ordered.length < 3) return const <GeoPoint>[];
    return <GeoPoint>[...ordered, ordered.first];
  }

  List<double> _buildHexFloorDistances({
    required int bins,
    required double hexRadius,
  }) {
    final vertices = List<_XY>.generate(6, (i) {
      final angle = (i / 6) * 2 * pi;
      return _XY(hexRadius * cos(angle), hexRadius * sin(angle));
    }, growable: false);
    final floors = List<double>.filled(bins, hexRadius * 0.75);
    for (var i = 0; i < bins; i++) {
      final a = (i / bins) * 2 * pi;
      final dir = _XY(cos(a), sin(a));
      var rayDistance = 0.0;
      for (var j = 0; j < 6; j++) {
        final p1 = vertices[j];
        final p2 = vertices[(j + 1) % 6];
        final hit = _raySegmentIntersection(dir, p1, p2);
        if (hit != null) {
          rayDistance = max(rayDistance, hit);
        }
      }
      floors[i] = rayDistance > 0 ? rayDistance : floors[i];
    }
    return floors;
  }

  double? _raySegmentIntersection(_XY dir, _XY a, _XY b) {
    final vx = b.x - a.x;
    final vy = b.y - a.y;
    final det = (-dir.x * vy + dir.y * vx);
    if (det.abs() < 1e-9) return null;
    final s = (-vy * a.x + vx * a.y) / det;
    final t = (dir.x * a.y - dir.y * a.x) / det;
    if (s >= 0 && t >= 0 && t <= 1) return s;
    return null;
  }

  double? _findPrevKnownDistance(List<double> values, int index) {
    final n = values.length;
    for (var i = 1; i < n; i++) {
      final idx = (index - i + n) % n;
      if (values[idx] > 0) return values[idx];
    }
    return null;
  }

  double? _findNextKnownDistance(List<double> values, int index) {
    final n = values.length;
    for (var i = 1; i < n; i++) {
      final idx = (index + i) % n;
      if (values[idx] > 0) return values[idx];
    }
    return null;
  }

  List<double> _smoothCircularDistances(List<double> values, {required int passes}) {
    var current = [...values];
    for (var pass = 0; pass < passes; pass++) {
      final n = current.length;
      final next = List<double>.filled(n, 0);
      for (var i = 0; i < n; i++) {
        final a = current[(i - 1 + n) % n];
        final b = current[i];
        final c = current[(i + 1) % n];
        next[i] = (a + 2 * b + c) / 4;
      }
      current = next;
    }
    return current;
  }

  List<GeoPoint> _collectStreetNodes(List<List<GeoPoint>> streets) {
    final points = <GeoPoint>[];
    for (final street in streets) {
      points.addAll(street);
    }
    return points;
  }

  List<GeoPoint> _collectStreetCircleIntersections(
    GeoPoint center,
    double radiusMeters,
    List<List<GeoPoint>> streets,
  ) {
    final intersections = <GeoPoint>[];
    for (final street in streets) {
      if (street.length < 2) {
        continue;
      }
      for (var i = 0; i < street.length - 1; i++) {
        intersections.addAll(
          _segmentCircleIntersections(
              center, radiusMeters, street[i], street[i + 1]),
        );
      }
    }
    return intersections;
  }

  List<GeoPoint> _dedupePoints(
    List<GeoPoint> points, {
    required double minDistanceMeters,
  }) {
    final deduped = <GeoPoint>[];
    for (final p in points) {
      final duplicate = deduped.any(
        (d) => _distanceMeters(d, p) < minDistanceMeters,
      );
      if (!duplicate) {
        deduped.add(p);
      }
    }
    return deduped;
  }

  List<GeoPoint> _dedupeByGrid(
    List<GeoPoint> points, {
    required double cellSizeMeters,
    required GeoPoint center,
  }) {
    final seen = <String>{};
    final out = <GeoPoint>[];
    for (final p in points) {
      final m = _toMeters(center, p);
      final key =
          '${(m.x / cellSizeMeters).round()}:${(m.y / cellSizeMeters).round()}';
      if (seen.add(key)) {
        out.add(p);
      }
    }
    return out;
  }

  List<_XY> _concaveHullClosedMeters(
    List<_XY> points, {
    required double concavity,
    required double lengthThreshold,
  }) {
    if (points.length < 3) {
      return points.isEmpty ? const <_XY>[] : <_XY>[...points, points.first];
    }

    var k = max(3, (concavity * 3).round());
    final unique = _dedupeXY(points, epsilonMeters: 0.5);
    while (k <= min(30, unique.length - 1)) {
      final hull = _concaveHullKnnClosed(unique, k: k, maxEdgeMeters: lengthThreshold);
      if (hull.isNotEmpty && _allPointsInsideOrOnHull(unique, hull)) {
        return hull;
      }
      k += 2;
    }
    return const <_XY>[];
  }

  List<_XY> _concaveHullKnnClosed(
    List<_XY> points, {
    required int k,
    required double maxEdgeMeters,
  }) {
    if (points.length < 3) return const <_XY>[];

    final start = points.reduce((a, b) => a.y < b.y ? a : b);
    final hull = <_XY>[start];
    final used = <int>{points.indexOf(start)};
    var current = start;
    var previousAngle = 0.0;
    var guard = 0;

    while (guard++ < points.length * 4) {
      final neighbors = _kNearest(points, current, k, exclude: used.toSet());
      if (neighbors.isEmpty) break;

      _XY? next;
      var bestTurn = double.infinity;
      for (final candidate in neighbors) {
        if (candidate == start && hull.length < 3) {
          continue;
        }
        final edgeLen = _distanceXY(current, candidate);
        if (edgeLen > maxEdgeMeters * 6 && hull.length > 2) {
          continue;
        }
        final angle = atan2(candidate.y - current.y, candidate.x - current.x);
        final turn = _normalizedTurn(previousAngle, angle);
        if (_createsSelfIntersection(hull, current, candidate)) {
          continue;
        }
        if (turn < bestTurn) {
          bestTurn = turn;
          next = candidate;
        }
      }
      if (next == null) break;

      if (next == start) {
        hull.add(start);
        return hull;
      }
      hull.add(next);
      used.add(points.indexOf(next));
      previousAngle = atan2(next.y - current.y, next.x - current.x);
      current = next;

      if (hull.length > 3 && _distanceXY(current, start) <= maxEdgeMeters * 1.5) {
        hull.add(start);
        return hull;
      }
    }
    return const <_XY>[];
  }

  List<_XY> _kNearest(
    List<_XY> points,
    _XY current,
    int k, {
    required Set<int> exclude,
  }) {
    final indexed = <_RankedPoint>[];
    for (var i = 0; i < points.length; i++) {
      final point = points[i];
      if (point == current || exclude.contains(i)) continue;
      indexed.add(_RankedPoint(point: point, distance: _distanceXY(current, point)));
    }
    indexed.sort((a, b) => a.distance.compareTo(b.distance));
    return indexed.take(k).map((e) => e.point).toList(growable: false);
  }

  bool _allPointsInsideOrOnHull(List<_XY> points, List<_XY> closedHull) {
    if (closedHull.length < 4) return false;
    final polygon = closedHull.take(closedHull.length - 1).toList(growable: false);
    for (final p in points) {
      if (!_isPointInsidePolygonXY(p, polygon) && !_isPointOnPolygonEdge(p, polygon)) {
        return false;
      }
    }
    return true;
  }

  bool _createsSelfIntersection(List<_XY> hull, _XY a, _XY b) {
    if (hull.length < 2) return false;
    for (var i = 0; i < hull.length - 2; i++) {
      final c = hull[i];
      final d = hull[i + 1];
      if (_segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
    return false;
  }

  bool _segmentsIntersect(_XY a, _XY b, _XY c, _XY d) {
    double orient(_XY p, _XY q, _XY r) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    final o1 = orient(a, b, c);
    final o2 = orient(a, b, d);
    final o3 = orient(c, d, a);
    final o4 = orient(c, d, b);
    return (o1 > 0) != (o2 > 0) && (o3 > 0) != (o4 > 0);
  }

  bool _isPointInsidePolygonXY(_XY point, List<_XY> polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      final xi = polygon[i].x;
      final yi = polygon[i].y;
      final xj = polygon[j].x;
      final yj = polygon[j].y;
      final intersects =
          ((yi > point.y) != (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) == 0 ? 1e-12 : (yj - yi)) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  bool _isPointOnPolygonEdge(_XY point, List<_XY> polygon) {
    for (var i = 0; i < polygon.length; i++) {
      final a = polygon[i];
      final b = polygon[(i + 1) % polygon.length];
      if (_distancePointToSegment(point, a, b) <= 1.5) return true;
    }
    return false;
  }

  double _distancePointToSegment(_XY p, _XY a, _XY b) {
    final dx = b.x - a.x;
    final dy = b.y - a.y;
    if (dx == 0 && dy == 0) return _distanceXY(p, a);
    final t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    final proj = _XY(a.x + t * dx, a.y + t * dy);
    return _distanceXY(p, proj);
  }

  List<_XY> _convexHullClosedMeters(List<_XY> points) {
    if (points.length < 3) {
      return points.isEmpty ? const <_XY>[] : <_XY>[...points, points.first];
    }
    final sorted = [...points]
      ..sort((a, b) => a.x == b.x ? a.y.compareTo(b.y) : a.x.compareTo(b.x));

    double cross(_XY o, _XY a, _XY b) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    final lower = <_XY>[];
    for (final p in sorted) {
      while (lower.length >= 2 &&
          cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.removeLast();
      }
      lower.add(p);
    }

    final upper = <_XY>[];
    for (var i = sorted.length - 1; i >= 0; i--) {
      final p = sorted[i];
      while (upper.length >= 2 &&
          cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.removeLast();
      }
      upper.add(p);
    }

    upper.removeLast();
    lower.removeLast();
    final hull = <_XY>[...lower, ...upper];
    return hull.isEmpty ? const <_XY>[] : <_XY>[...hull, hull.first];
  }

  List<_XY> _dedupeXY(List<_XY> points, {required double epsilonMeters}) {
    final out = <_XY>[];
    for (final p in points) {
      final duplicate = out.any((d) => _distanceXY(d, p) < epsilonMeters);
      if (!duplicate) out.add(p);
    }
    return out;
  }

  double _distanceXY(_XY a, _XY b) {
    final dx = a.x - b.x;
    final dy = a.y - b.y;
    return sqrt(dx * dx + dy * dy);
  }

  double _normalizedTurn(double fromAngle, double toAngle) {
    final delta = atan2(sin(toAngle - fromAngle), cos(toAngle - fromAngle));
    return (2 * pi - delta) % (2 * pi);
  }

  double _angleDistance(double a, double b) {
    final d = (a - b).abs();
    return min(d, 2 * pi - d);
  }

  List<GeoPoint> _segmentCircleIntersections(
    GeoPoint center,
    double radiusMeters,
    GeoPoint a,
    GeoPoint b,
  ) {
    final aM = _toMeters(center, a);
    final bM = _toMeters(center, b);
    final dx = bM.x - aM.x;
    final dy = bM.y - aM.y;
    final qa = dx * dx + dy * dy;
    if (qa == 0) {
      return const <GeoPoint>[];
    }
    final qb = 2 * (aM.x * dx + aM.y * dy);
    final qc = aM.x * aM.x + aM.y * aM.y - radiusMeters * radiusMeters;
    final disc = qb * qb - 4 * qa * qc;
    if (disc < 0) {
      return const <GeoPoint>[];
    }

    final sqrtDisc = sqrt(disc);
    final out = <GeoPoint>[];
    for (final t in <double>[
      (-qb - sqrtDisc) / (2 * qa),
      (-qb + sqrtDisc) / (2 * qa),
    ]) {
      if (t >= 0 && t <= 1) {
        out.add(_fromMeters(center, _XY(aM.x + t * dx, aM.y + t * dy)));
      }
    }
    return out;
  }

  _XY _toMeters(GeoPoint center, GeoPoint point) {
    final metersPerDegreeLng =
        _metersPerDegreeLat * cos(center.latitude * pi / 180);
    return _XY(
      (point.longitude - center.longitude) * metersPerDegreeLng,
      (point.latitude - center.latitude) * _metersPerDegreeLat,
    );
  }

  GeoPoint _fromMeters(GeoPoint center, _XY point) {
    final metersPerDegreeLng =
        _metersPerDegreeLat * cos(center.latitude * pi / 180);
    return GeoPoint(
      latitude: center.latitude + point.y / _metersPerDegreeLat,
      longitude: center.longitude + point.x / metersPerDegreeLng,
    );
  }

  double _distanceMeters(GeoPoint a, GeoPoint b) {
    const earthRadius = 6371000.0;
    final dLat = _degToRad(b.latitude - a.latitude);
    final dLng = _degToRad(b.longitude - a.longitude);
    final la1 = _degToRad(a.latitude);
    final la2 = _degToRad(b.latitude);
    final h = sin(dLat / 2) * sin(dLat / 2) +
        cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2);
    final c = 2 * atan2(sqrt(h), sqrt(1 - h));
    return earthRadius * c;
  }

  double _degToRad(double deg) => deg * pi / 180;
}

class _XY {
  const _XY(this.x, this.y);
  final double x;
  final double y;
}

class _RankedPoint {
  const _RankedPoint({required this.point, required this.distance});
  final _XY point;
  final double distance;
}

class _PolarCandidate {
  const _PolarCandidate({
    required this.point,
    required this.angle,
    required this.distance,
  });

  final GeoPoint point;
  final double angle;
  final double distance;
}

class _StreetGraph {
  const _StreetGraph({
    required this.nodes,
    required this.adjacency,
  });

  final List<GeoPoint> nodes;
  final Map<int, List<_GraphEdge>> adjacency;
}

class _GraphEdge {
  const _GraphEdge({required this.to, required this.weight});
  final int to;
  final double weight;
}

class _QueueNode {
  const _QueueNode({required this.id, required this.cost});
  final int id;
  final double cost;
}
