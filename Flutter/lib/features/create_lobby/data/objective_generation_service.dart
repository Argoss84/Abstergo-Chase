import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/data/street_snap_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/play_area.dart';
import 'package:geolocator/geolocator.dart';

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
    final area = PlayArea(
      center: center,
      radiusMeters: mapRadiusMeters.toDouble(),
      contour: finalZoneContour,
    );
    final candidates = <String, GeoPoint>{};
    final junctions = <String>{};
    for (final street in streets.where((street) => street.length >= 2)) {
      final seenOnStreet = <String>{};
      void add(GeoPoint point, {bool streetNode = false}) {
        if (!point.isValid || !area.contains(point)) return;
        final key =
            '${point.latitude.toStringAsFixed(6)},${point.longitude.toStringAsFixed(6)}';
        if (streetNode &&
            seenOnStreet.add(key) &&
            candidates.containsKey(key)) {
          junctions.add(key);
        }
        candidates[key] = point;
      }

      for (final node in street) {
        add(node, streetNode: true);
      }
      for (var i = 1; i < street.length; i++) {
        final a = street[i - 1];
        final b = street[i];
        if (!a.isValid || !b.isValid) continue;
        final steps = (_distance(a, b) / 8).ceil().clamp(1, 256);
        for (var j = 1; j < steps; j++) {
          final fraction = j / steps;
          add(
            GeoPoint(
              latitude: a.latitude + (b.latitude - a.latitude) * fraction,
              longitude: a.longitude + (b.longitude - a.longitude) * fraction,
            ),
          );
        }
      }
    }
    if (candidates.length < 2) {
      throw StateError(
        'Pas assez de rues dans la zone pour placer les départs.',
      );
    }

    final closestStreetPoint = const StreetSnapService().snapToNearestStreet(
      point: center,
      streets: streets,
    );
    final agentStart =
        closestStreetPoint != null && area.contains(closestStreetPoint)
        ? closestStreetPoint
        : candidates.values.reduce(
            (best, point) => _distance(center, point) < _distance(center, best)
                ? point
                : best,
          );
    final maxDistanceFromAgent = candidates.values
        .map((point) => _distance(agentStart, point))
        .reduce(max);
    final peripheralPoints = candidates.values.where(
      (point) => _distance(agentStart, point) >= maxDistanceFromAgent * 0.65,
    );
    double distanceToEdge(GeoPoint point) =>
        _distance(point, area.nearestBoundary(point));
    final rogueStart = peripheralPoints.reduce(
      (best, point) =>
          distanceToEdge(point) < distanceToEdge(best) ? point : best,
    );

    final intersections = junctions.map((key) => candidates[key]!).toList()
      ..shuffle(_random);
    final streetPoints =
        candidates.entries
            .where((entry) => !junctions.contains(entry.key))
            .map((entry) => entry.value)
            .toList()
          ..shuffle(_random);
    final pool = [...intersections, ...streetPoints];
    final preferredSpacing = max(2.0, _distance(agentStart, rogueStart) / 5);
    for (final spacing in [
      preferredSpacing,
      max(2.0, preferredSpacing / 2),
      2.0,
    ]) {
      final objectives = <GeoPoint>[];
      for (final candidate in pool) {
        if (objectives.length == objectiveCount) break;
        if (_distance(agentStart, candidate) >= spacing &&
            _distance(rogueStart, candidate) >= spacing &&
            objectives.every(
              (other) => _distance(other, candidate) >= spacing,
            )) {
          objectives.add(candidate);
        }
      }
      if (objectives.length == objectiveCount) {
        return ObjectiveGenerationResult(
          objectives: objectives,
          agentStartZone: agentStart,
          rogueStartZone: rogueStart,
        );
      }
    }
    throw StateError(
      'Pas assez de place pour générer $objectiveCount objectifs distincts.',
    );
  }

  double _distance(GeoPoint a, GeoPoint b) => Geolocator.distanceBetween(
    a.latitude,
    a.longitude,
    b.latitude,
    b.longitude,
  );
}
