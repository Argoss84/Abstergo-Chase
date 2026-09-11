import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/domain/objective_hint_zone.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const calculator = ObjectiveHintZoneCalculator();
  const objective = GeoPoint(latitude: 45, longitude: 4);

  test('encloses a nearby street loop and the capture point', () {
    final loop = <GeoPoint>[
      _offset(objective, x: -20, y: -15),
      _offset(objective, x: 30, y: -15),
      _offset(objective, x: 30, y: 25),
      _offset(objective, x: -20, y: 25),
    ];
    final zone = calculator.calculate(
      objective: objective,
      streets: <List<GeoPoint>>[
        <GeoPoint>[loop[0], loop[1]],
        <GeoPoint>[loop[1], loop[2]],
        <GeoPoint>[loop[2], loop[3]],
        <GeoPoint>[loop[3], loop[0]],
      ],
    );

    expect(_distance(zone.center, objective), lessThan(zone.radiusMeters));
    for (final point in loop) {
      expect(_distance(zone.center, point), lessThan(zone.radiusMeters));
    }
    expect(_distance(zone.center, objective), greaterThan(1));
  });

  test('keeps the capture point hidden inside the fallback zone', () {
    final zone = calculator.calculate(
      objective: objective,
      streets: <List<GeoPoint>>[
        <GeoPoint>[objective, _offset(objective, x: 30, y: 0)],
      ],
      fallbackRadiusMeters: 40,
    );

    expect(zone.radiusMeters, 40);
    expect(_distance(zone.center, objective), greaterThan(1));
    expect(_distance(zone.center, objective), lessThan(zone.radiusMeters));
  });

  test('prefers a local block in a street grid', () {
    final nodes = List.generate(
      4,
      (row) => List.generate(
        4,
        (column) => _offset(
          objective,
          x: column * 20,
          y: row * 20,
        ),
      ),
    );
    final streets = <List<GeoPoint>>[
      for (final row in nodes) row,
      for (var column = 0; column < 4; column++)
        <GeoPoint>[for (final row in nodes) row[column]],
    ];
    final localObjective = _offset(objective, x: 50, y: 50);

    final zone = calculator.calculate(
      objective: localObjective,
      streets: streets,
    );

    expect(zone.radiusMeters, lessThan(30));
    expect(_distance(zone.center, localObjective), lessThan(zone.radiusMeters));
  });
}

GeoPoint _offset(GeoPoint origin, {required double x, required double y}) {
  final lngScale = 111320 * cos(origin.latitude * pi / 180);
  return GeoPoint(
    latitude: origin.latitude + y / 111320,
    longitude: origin.longitude + x / lngScale,
  );
}

double _distance(GeoPoint a, GeoPoint b) {
  final latScale = 111320.0;
  final lngScale = latScale * cos(a.latitude * pi / 180);
  final x = (b.longitude - a.longitude) * lngScale;
  final y = (b.latitude - a.latitude) * latScale;
  return sqrt(x * x + y * y);
}
