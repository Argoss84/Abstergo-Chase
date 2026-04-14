import 'dart:math';

import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';

class ObjectiveGenerationResult {
  const ObjectiveGenerationResult({
    required this.objectives,
    required this.agentStartZone,
    required this.rogueStartZone,
  });

  final List<GeoPoint> objectives;
  final GeoPoint agentStartZone;
  final GeoPoint rogueStartZone;
}

class ObjectiveGenerationService {
  ObjectiveGenerationService({Random? random}) : _random = random ?? Random();

  final Random _random;

  ObjectiveGenerationResult generate({
    required GeoPoint center,
    required int mapRadiusMeters,
    required int objectiveCount,
    required List<List<GeoPoint>> streets,
    List<GeoPoint> finalZoneContour = const <GeoPoint>[],
  }) {
    final sanitizedStreets = streets
        .map((street) => street.toList(growable: false))
        .where((street) => street.length >= 2)
        .toList(growable: false);
    if (sanitizedStreets.isEmpty) {
      throw Exception('Aucune rue disponible pour générer les objectifs.');
    }

    var objectives = _generateRandomPoints(
      center: center,
      radius: mapRadiusMeters.toDouble(),
      count: objectiveCount,
      streets: sanitizedStreets,
      finalZoneContour: finalZoneContour,
    );
    var agentStart = _generateAgentStartZone(
      center: center,
      radius: mapRadiusMeters.toDouble(),
      objectives: objectives,
      streets: sanitizedStreets,
    );
    var rogueStart = _generateRogueStartZone(
      center: center,
      radius: mapRadiusMeters.toDouble(),
      agentStartZone: agentStart,
      objectives: objectives,
      streets: sanitizedStreets,
    );

    objectives = _regenerateObjectivesAwayFromStartZones(
      currentObjectives: objectives,
      center: center,
      radius: mapRadiusMeters.toDouble(),
      count: objectiveCount,
      streets: sanitizedStreets,
      finalZoneContour: finalZoneContour,
      agentStartZone: agentStart,
      rogueStartZone: rogueStart,
      enforceObjectiveSpacing: true,
    );
    agentStart = _generateAgentStartZone(
      center: center,
      radius: mapRadiusMeters.toDouble(),
      objectives: objectives,
      streets: sanitizedStreets,
    );
    rogueStart = _generateRogueStartZone(
      center: center,
      radius: mapRadiusMeters.toDouble(),
      agentStartZone: agentStart,
      objectives: objectives,
      streets: sanitizedStreets,
    );
    objectives = _regenerateObjectivesAwayFromStartZones(
      currentObjectives: objectives,
      center: center,
      radius: mapRadiusMeters.toDouble(),
      count: objectiveCount,
      streets: sanitizedStreets,
      finalZoneContour: finalZoneContour,
      agentStartZone: agentStart,
      rogueStartZone: rogueStart,
      enforceObjectiveSpacing: true,
    );

    return ObjectiveGenerationResult(
      objectives: objectives,
      agentStartZone: agentStart,
      rogueStartZone: rogueStart,
    );
  }

  List<GeoPoint> _generateRandomPoints({
    required GeoPoint center,
    required double radius,
    required int count,
    required List<List<GeoPoint>> streets,
    required List<GeoPoint> finalZoneContour,
    List<GeoPoint> forbiddenStartZones = const <GeoPoint>[],
    double minForbiddenDistanceMeters = 0,
    double minObjectiveDistanceMeters = 0,
  }) {
    final contour = _sanitizeContour(finalZoneContour);
    final fromIntersections = _generatePointsFromStreetIntersections(
      streets: streets,
      contour: contour,
      center: center,
      radius: radius,
      count: count,
      forbiddenStartZones: forbiddenStartZones,
      minForbiddenDistanceMeters: minForbiddenDistanceMeters,
      minObjectiveDistanceMeters: minObjectiveDistanceMeters,
    );
    if (fromIntersections.length == count) {
      return fromIntersections;
    }

    final points = <GeoPoint>[];
    final minDistance = radius / 2.5;
    var attempts = 0;
    const maxAttempts = 1000;

    while (points.length < count && attempts < maxAttempts) {
      final angle = _random.nextDouble() * 2 * pi;
      final distance = _random.nextDouble() * radius;
      final newPoint = _projectFromCenter(
        center: center,
        distanceMeters: distance,
        angleRadians: angle,
      );

      final closestStreet = streets.firstWhere(
        (street) => street.any(
          (node) => _distanceMeters(node, newPoint) < minDistance,
        ),
        orElse: () => const <GeoPoint>[],
      );
      if (closestStreet.isEmpty) {
        attempts++;
        continue;
      }

      final closestNode = _closestPointToTarget(
        points: closestStreet,
        target: newPoint,
      );
      final farEnough = points.every(
        (existing) => _distanceMeters(existing, closestNode) >=
            max(minDistance, minObjectiveDistanceMeters),
      );
      if (_isPointInCircle(closestNode, center, radius) &&
          farEnough &&
          _respectsForbiddenStartZones(
            closestNode,
            forbiddenStartZones,
            minForbiddenDistanceMeters,
          )) {
        points.add(closestNode);
      }
      attempts++;
    }

    if (points.length < count) {
      throw Exception('Impossible de générer suffisamment de points éloignés.');
    }
    return points;
  }

  List<GeoPoint> _generatePointsFromStreetIntersections({
    required List<List<GeoPoint>> streets,
    required List<GeoPoint> contour,
    required GeoPoint center,
    required double radius,
    required int count,
    required List<GeoPoint> forbiddenStartZones,
    required double minForbiddenDistanceMeters,
    required double minObjectiveDistanceMeters,
  }) {
    final nodeCounts = <String, int>{};
    final nodeByKey = <String, GeoPoint>{};
    for (final street in streets) {
      for (final node in street) {
        final key =
            '${node.latitude.toStringAsFixed(6)},${node.longitude.toStringAsFixed(6)}';
        nodeCounts[key] = (nodeCounts[key] ?? 0) + 1;
        nodeByKey[key] = node;
      }
    }

    final intersections = <GeoPoint>[];
    for (final entry in nodeCounts.entries) {
      if (entry.value >= 2) {
        final point = nodeByKey[entry.key];
        if (point != null) {
          intersections.add(point);
        }
      }
    }

    bool isAllowed(GeoPoint p) {
      final inZone = contour.length >= 3
          ? _isPointInPolygon(p, contour)
          : _isPointInCircle(p, center, radius);
      if (!inZone) return false;
      return _respectsForbiddenStartZones(
        p,
        forbiddenStartZones,
        minForbiddenDistanceMeters,
      );
    }

    final pool = _dedupePoints(
      intersections.where(isAllowed).toList(growable: false),
      minDistanceMeters: 2,
    );
    if (pool.length < count) {
      final fallbackNodes = <GeoPoint>[];
      for (final street in streets) {
        for (final node in street) {
          if (isAllowed(node)) fallbackNodes.add(node);
        }
      }
      final dedupFallback = _dedupePoints(fallbackNodes, minDistanceMeters: 2);
      return _pickRandomUniqueWithMinDistance(
        dedupFallback,
        count: count,
        minDistanceMeters: minObjectiveDistanceMeters,
      );
    }
    return _pickRandomUniqueWithMinDistance(
      pool,
      count: count,
      minDistanceMeters: minObjectiveDistanceMeters,
    );
  }

  List<GeoPoint> _regenerateObjectivesAwayFromStartZones({
    required List<GeoPoint> currentObjectives,
    required GeoPoint center,
    required double radius,
    required int count,
    required List<List<GeoPoint>> streets,
    required List<GeoPoint> finalZoneContour,
    required GeoPoint agentStartZone,
    required GeoPoint rogueStartZone,
    required bool enforceObjectiveSpacing,
  }) {
    final minDistance = _distanceMeters(agentStartZone, rogueStartZone) / 5;
    if (minDistance <= 0) return currentObjectives;
    try {
      return _generateRandomPoints(
        center: center,
        radius: radius,
        count: count,
        streets: streets,
        finalZoneContour: finalZoneContour,
        forbiddenStartZones: <GeoPoint>[agentStartZone, rogueStartZone],
        minForbiddenDistanceMeters: minDistance,
        minObjectiveDistanceMeters: enforceObjectiveSpacing ? minDistance : 0,
      );
    } catch (_) {
      return currentObjectives;
    }
  }

  bool _respectsForbiddenStartZones(
    GeoPoint point,
    List<GeoPoint> forbiddenStartZones,
    double minForbiddenDistanceMeters,
  ) {
    if (forbiddenStartZones.isEmpty || minForbiddenDistanceMeters <= 0) {
      return true;
    }
    for (final zone in forbiddenStartZones) {
      if (_distanceMeters(point, zone) < minForbiddenDistanceMeters) {
        return false;
      }
    }
    return true;
  }

  List<GeoPoint> _pickRandomUniqueWithMinDistance(
    List<GeoPoint> points, {
    required int count,
    required double minDistanceMeters,
  }) {
    if (points.length < count) return const <GeoPoint>[];
    final pool = [...points]..shuffle(_random);
    if (minDistanceMeters <= 0) {
      return pool.take(count).toList(growable: false);
    }
    final selected = <GeoPoint>[];
    for (final candidate in pool) {
      final respects = selected.every(
        (existing) => _distanceMeters(existing, candidate) >= minDistanceMeters,
      );
      if (!respects) continue;
      selected.add(candidate);
      if (selected.length == count) return selected;
    }
    return const <GeoPoint>[];
  }

  List<GeoPoint> _sanitizeContour(List<GeoPoint> contour) {
    if (contour.length < 3) return const <GeoPoint>[];
    final open = <GeoPoint>[...contour];
    if (_distanceMeters(open.first, open.last) < 2) {
      open.removeLast();
    }
    return open.length >= 3 ? open : const <GeoPoint>[];
  }

  bool _isPointInPolygon(GeoPoint point, List<GeoPoint> polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      final xi = polygon[i].longitude;
      final yi = polygon[i].latitude;
      final xj = polygon[j].longitude;
      final yj = polygon[j].latitude;
      final intersects = ((yi > point.latitude) != (yj > point.latitude)) &&
          (point.longitude <
              (xj - xi) *
                      (point.latitude - yi) /
                      ((yj - yi).abs() < 1e-12 ? 1e-12 : (yj - yi)) +
                  xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  GeoPoint _generateAgentStartZone({
    required GeoPoint center,
    required double radius,
    required List<GeoPoint> objectives,
    required List<List<GeoPoint>> streets,
  }) {
    final intersectionPoints = _getCircleStreetIntersections(
      center: center,
      radiusMeters: radius,
      streets: streets,
    );
    if (intersectionPoints.isNotEmpty) {
      return intersectionPoints.reduce(
        (best, current) =>
            _minDistanceToObjectives(current, objectives) >
                    _minDistanceToObjectives(best, objectives)
                ? current
                : best,
      );
    }

    final pointsOnCircle = List<GeoPoint>.generate(
      360,
      (i) => _projectFromCenter(
        center: center,
        distanceMeters: radius,
        angleRadians: (i * 2 * pi) / 360,
      ),
      growable: false,
    );
    final farthestPoint = pointsOnCircle.reduce(
      (farthest, current) =>
          _minDistanceToObjectives(current, objectives) >
                  _minDistanceToObjectives(farthest, objectives)
              ? current
              : farthest,
    );
    return _closestStreetNode(streets: streets, target: farthestPoint);
  }

  GeoPoint _generateRogueStartZone({
    required GeoPoint center,
    required double radius,
    required GeoPoint agentStartZone,
    required List<GeoPoint> objectives,
    required List<List<GeoPoint>> streets,
  }) {
    final intersectionPoints = _getCircleStreetIntersections(
      center: center,
      radiusMeters: radius,
      streets: streets,
    );
    final minDistance = radius / 3;
    bool farEnough(GeoPoint point) => objectives.every(
          (objective) => _distanceMeters(point, objective) >= minDistance,
        );

    double normalizeAngle(double angle) => atan2(sin(angle), cos(angle));
    final agentAngle = atan2(
      agentStartZone.latitude - center.latitude,
      agentStartZone.longitude - center.longitude,
    );

    GeoPoint chooseOpposite(List<GeoPoint> points) {
      return points.reduce((best, current) {
        final currentAngle =
            atan2(current.latitude - center.latitude, current.longitude - center.longitude);
        final currentDelta =
            (pi - normalizeAngle(currentAngle - agentAngle).abs()).abs();
        final bestAngle =
            atan2(best.latitude - center.latitude, best.longitude - center.longitude);
        final bestDelta = (pi - normalizeAngle(bestAngle - agentAngle).abs()).abs();
        return currentDelta < bestDelta ? current : best;
      });
    }

    if (intersectionPoints.isNotEmpty) {
      final filtered = intersectionPoints.where(farEnough).toList(growable: false);
      final candidates = filtered.isNotEmpty ? filtered : intersectionPoints;
      return chooseOpposite(candidates);
    }

    final angle = atan2(
      agentStartZone.longitude - center.longitude,
      agentStartZone.latitude - center.latitude,
    );
    final randomOffset = _random.nextDouble() * (pi - pi / 2) + pi / 2;
    final rogueAngle = angle + randomOffset * (_random.nextBool() ? 1 : -1);
    final roguePoint = _projectFromCenter(
      center: center,
      distanceMeters: radius,
      angleRadians: rogueAngle,
    );

    GeoPoint closest = streets.first.first;
    var bestDistance = _distanceMeters(closest, roguePoint);
    for (final street in streets) {
      final pointOnStreet = _closestPointToTarget(points: street, target: roguePoint);
      final distance = _distanceMeters(pointOnStreet, roguePoint);
      if (distance < bestDistance && farEnough(pointOnStreet)) {
        closest = pointOnStreet;
        bestDistance = distance;
      }
    }
    return closest;
  }

  List<GeoPoint> _getCircleStreetIntersections({
    required GeoPoint center,
    required double radiusMeters,
    required List<List<GeoPoint>> streets,
  }) {
    final intersections = <GeoPoint>[];
    for (final street in streets) {
      for (var i = 0; i < street.length - 1; i++) {
        intersections.addAll(
          _segmentCircleIntersections(
            center: center,
            radiusMeters: radiusMeters,
            start: street[i],
            end: street[i + 1],
          ),
        );
      }
    }
    return _dedupePoints(intersections, minDistanceMeters: 2);
  }

  List<GeoPoint> _segmentCircleIntersections({
    required GeoPoint center,
    required double radiusMeters,
    required GeoPoint start,
    required GeoPoint end,
  }) {
    final startMeters = _toMeters(start, center);
    final endMeters = _toMeters(end, center);
    final dx = endMeters.x - startMeters.x;
    final dy = endMeters.y - startMeters.y;
    final a = dx * dx + dy * dy;
    if (a == 0) return const <GeoPoint>[];
    final b = 2 * (startMeters.x * dx + startMeters.y * dy);
    final c = startMeters.x * startMeters.x +
        startMeters.y * startMeters.y -
        radiusMeters * radiusMeters;
    final discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return const <GeoPoint>[];

    final sqrtDisc = sqrt(discriminant);
    final out = <GeoPoint>[];
    for (final t in <double>[
      (-b - sqrtDisc) / (2 * a),
      (-b + sqrtDisc) / (2 * a),
    ]) {
      if (t >= 0 && t <= 1) {
        out.add(
          _fromMeters(
            _XY(startMeters.x + t * dx, startMeters.y + t * dy),
            center,
          ),
        );
      }
    }
    return out;
  }

  GeoPoint _closestStreetNode({
    required List<List<GeoPoint>> streets,
    required GeoPoint target,
  }) {
    GeoPoint closest = streets.first.first;
    var bestDistance = _distanceMeters(closest, target);
    for (final street in streets) {
      final candidate = _closestPointToTarget(points: street, target: target);
      final distance = _distanceMeters(candidate, target);
      if (distance < bestDistance) {
        closest = candidate;
        bestDistance = distance;
      }
    }
    return closest;
  }

  GeoPoint _closestPointToTarget({
    required List<GeoPoint> points,
    required GeoPoint target,
  }) {
    return points.reduce(
      (prev, curr) =>
          _distanceMeters(curr, target) < _distanceMeters(prev, target)
              ? curr
              : prev,
    );
  }

  double _minDistanceToObjectives(GeoPoint point, List<GeoPoint> objectives) {
    if (objectives.isEmpty) return double.infinity;
    return objectives
        .map((objective) => _distanceMeters(point, objective))
        .reduce(min);
  }

  bool _isPointInCircle(GeoPoint point, GeoPoint center, double radiusMeters) {
    return _distanceMeters(point, center) <= radiusMeters;
  }

  List<GeoPoint> _dedupePoints(
    List<GeoPoint> points, {
    required double minDistanceMeters,
  }) {
    final out = <GeoPoint>[];
    for (final p in points) {
      final duplicate = out.any((q) => _distanceMeters(p, q) < minDistanceMeters);
      if (!duplicate) {
        out.add(p);
      }
    }
    return out;
  }

  GeoPoint _projectFromCenter({
    required GeoPoint center,
    required double distanceMeters,
    required double angleRadians,
  }) {
    final dx = distanceMeters * cos(angleRadians);
    final dy = distanceMeters * sin(angleRadians);
    final deltaLat = dy / 111320.0;
    final deltaLng = dx / (111320.0 * cos(center.latitude * pi / 180));
    return GeoPoint(
      latitude: center.latitude + deltaLat,
      longitude: center.longitude + deltaLng,
    );
  }

  _XY _toMeters(GeoPoint point, GeoPoint center) {
    final metersPerDegreeLng = 111320.0 * cos(center.latitude * pi / 180);
    return _XY(
      (point.longitude - center.longitude) * metersPerDegreeLng,
      (point.latitude - center.latitude) * 111320.0,
    );
  }

  GeoPoint _fromMeters(_XY point, GeoPoint center) {
    final metersPerDegreeLng = 111320.0 * cos(center.latitude * pi / 180);
    return GeoPoint(
      latitude: center.latitude + point.y / 111320.0,
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
