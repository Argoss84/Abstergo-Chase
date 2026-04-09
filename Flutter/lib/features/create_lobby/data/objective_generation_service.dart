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
  }) {
    final objectives = <GeoPoint>[];
    for (var i = 0; i < objectiveCount; i++) {
      objectives.add(
        _randomPointAround(
          center: center,
          maxRadiusMeters: mapRadiusMeters * 0.9,
        ),
      );
    }

    final agentStart = _randomPointAround(
      center: center,
      maxRadiusMeters: mapRadiusMeters * 0.8,
    );

    var rogueStart = _randomPointAround(
      center: center,
      maxRadiusMeters: mapRadiusMeters * 0.8,
    );

    var guard = 0;
    while (_distanceMeters(agentStart, rogueStart) < 80 && guard < 30) {
      rogueStart = _randomPointAround(
        center: center,
        maxRadiusMeters: mapRadiusMeters * 0.8,
      );
      guard++;
    }

    return ObjectiveGenerationResult(
      objectives: objectives,
      agentStartZone: agentStart,
      rogueStartZone: rogueStart,
    );
  }

  GeoPoint _randomPointAround({
    required GeoPoint center,
    required double maxRadiusMeters,
  }) {
    final angle = _random.nextDouble() * 2 * pi;
    final radius = sqrt(_random.nextDouble()) * maxRadiusMeters;
    final dx = radius * cos(angle);
    final dy = radius * sin(angle);

    // Approximation locale suffisante pour ce cas d'usage.
    final deltaLat = dy / 111320.0;
    final deltaLng = dx / (111320.0 * cos(center.latitude * pi / 180));

    return GeoPoint(
      latitude: center.latitude + deltaLat,
      longitude: center.longitude + deltaLng,
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
