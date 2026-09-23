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

    expect(zone.hugsStreets, isTrue);
    expect(_distance(zone.center, objective), lessThan(zone.radiusMeters));
    for (final point in loop) {
      expect(_distance(zone.center, point), lessThan(zone.radiusMeters));
      expect(_contains(zone.contour, point), isTrue);
    }
    expect(_contains(zone.contour, objective), isTrue);
    expect(_distance(zone.center, objective), greaterThan(1));
    final open = _openContour(zone.contour);
    expect(open.length, greaterThanOrEqualTo(4));
    for (final point in open) {
      expect(loop.any((corner) => _distance(point, corner) < 1.5), isTrue);
    }
  });

  test('keeps the capture point hidden inside the fallback zone', () {
    final zone = calculator.calculate(
      objective: objective,
      streets: <List<GeoPoint>>[
        <GeoPoint>[objective, _offset(objective, x: 30, y: 0)],
      ],
      fallbackRadiusMeters: 40,
    );

    expect(zone.hugsStreets, isFalse);
    expect(zone.radiusMeters, 40);
    expect(_distance(zone.center, objective), greaterThan(1));
    expect(_distance(zone.center, objective), lessThan(zone.radiusMeters));
  });

  test('prefers a local block in a street grid', () {
    final nodes = List.generate(
      4,
      (row) => List.generate(
        4,
        (column) => _offset(objective, x: column * 20, y: row * 20),
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

    expect(zone.hugsStreets, isTrue);
    expect(zone.radiusMeters, lessThan(30));
    expect(_contains(zone.contour, localObjective), isTrue);
    expect(_distance(zone.center, localObjective), lessThan(zone.radiusMeters));
    expect(_span(localObjective, zone.contour).x, inInclusiveRange(15, 28));
  });

  test('unions the blocks around a capture point that lies on a street', () {
    final nodes = List.generate(
      4,
      (row) => List.generate(
        4,
        (column) => _offset(objective, x: column * 20, y: row * 20),
      ),
    );
    final streets = <List<GeoPoint>>[
      for (final row in nodes) row,
      for (var column = 0; column < 4; column++)
        <GeoPoint>[for (final row in nodes) row[column]],
    ];
    final onStreet = _offset(objective, x: 40, y: 50);

    final zone = calculator.calculate(objective: onStreet, streets: streets);

    expect(zone.hugsStreets, isTrue);
    expect(_contains(zone.contour, onStreet), isTrue);
    final span = _span(onStreet, zone.contour);
    expect(span.x, inInclusiveRange(30, 50));
    expect(span.y, inInclusiveRange(15, 28));
    expect(_distanceToContour(onStreet, zone.contour), greaterThan(4));
  });

  test('covers at least three nearby streets when they do not loop', () {
    final zone = calculator.calculate(
      objective: objective,
      streets: <List<GeoPoint>>[
        <GeoPoint>[
          _offset(objective, x: -30, y: -12),
          _offset(objective, x: 30, y: -12),
        ],
        <GeoPoint>[
          _offset(objective, x: -30, y: 0),
          _offset(objective, x: 30, y: 0),
        ],
        <GeoPoint>[
          _offset(objective, x: -30, y: 14),
          _offset(objective, x: 30, y: 14),
        ],
      ],
    );

    expect(zone.hugsStreets, isTrue);
    expect(_contains(zone.contour, objective), isTrue);
    expect(_span(objective, zone.contour).y, greaterThan(20));
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
  final delta = _meters(a, b);
  return sqrt(delta.x * delta.x + delta.y * delta.y);
}

({double x, double y}) _meters(GeoPoint origin, GeoPoint point) {
  final lngScale = 111320 * cos(origin.latitude * pi / 180);
  return (
    x: (point.longitude - origin.longitude) * lngScale,
    y: (point.latitude - origin.latitude) * 111320,
  );
}

({double x, double y}) _span(GeoPoint origin, List<GeoPoint> contour) {
  final open = _openContour(contour);
  final xs = open.map((point) => _meters(origin, point).x);
  final ys = open.map((point) => _meters(origin, point).y);
  return (
    x: xs.reduce(max) - xs.reduce(min),
    y: ys.reduce(max) - ys.reduce(min),
  );
}

List<GeoPoint> _openContour(List<GeoPoint> contour) {
  if (contour.length >= 2 && _distance(contour.first, contour.last) < 1) {
    return contour.sublist(0, contour.length - 1);
  }
  return contour;
}

bool _contains(List<GeoPoint> contour, GeoPoint point) {
  final ring = _openContour(contour);
  if (_distanceToContour(point, contour) <= 1.5) return true;
  var inside = false;
  for (
    var index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    final current = _meters(point, ring[index]);
    final prior = _meters(point, ring[previous]);
    final crosses = (current.y > 0) != (prior.y > 0);
    if (!crosses) continue;
    final x =
        (prior.x - current.x) * (0 - current.y) / (prior.y - current.y) +
        current.x;
    if (x > 0) inside = !inside;
  }
  return inside;
}

double _distanceToContour(GeoPoint point, List<GeoPoint> contour) {
  final ring = _openContour(contour);
  var best = double.infinity;
  for (var index = 0; index < ring.length; index++) {
    best = min(
      best,
      _distanceToSegment(point, ring[index], ring[(index + 1) % ring.length]),
    );
  }
  return best;
}

double _distanceToSegment(GeoPoint point, GeoPoint start, GeoPoint end) {
  final a = _meters(point, start);
  final b = _meters(point, end);
  final dx = b.x - a.x;
  final dy = b.y - a.y;
  final lengthSquared = dx * dx + dy * dy;
  if (lengthSquared == 0) return sqrt(a.x * a.x + a.y * a.y);
  final t = (-(a.x * dx + a.y * dy) / lengthSquared).clamp(0.0, 1.0);
  final x = a.x + t * dx;
  final y = a.y + t * dy;
  return sqrt(x * x + y * y);
}
