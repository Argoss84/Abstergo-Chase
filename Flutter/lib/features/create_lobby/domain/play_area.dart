import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

/// Uses the same street contour as the map, or the circle when there is none.
class PlayArea {
  PlayArea({
    required this.center,
    required this.radiusMeters,
    List<GeoPoint> contour = const [],
  }) : _longitudeScale = 111195 * max(1e-6, cos(center.latitude * pi / 180)) {
    final vertices = contour
        .where((point) => point.isValid)
        .map(_project)
        .toList();
    if (vertices.length > 1 && vertices.first == vertices.last) {
      vertices.removeLast();
    }
    _vertices = vertices.length >= 3 ? vertices : const [];
  }

  final GeoPoint center;
  final double radiusMeters;
  final double _longitudeScale;
  late final List<Point<double>> _vertices;
  static const _latitudeScale = 111195.0;

  bool contains(GeoPoint point) {
    final p = _project(point);
    if (_vertices.isEmpty) return p.magnitude <= radiusMeters;
    var inside = false;
    for (var i = 0, j = _vertices.length - 1; i < _vertices.length; j = i++) {
      final a = _vertices[j];
      final b = _vertices[i];
      if ((a.y > p.y) != (b.y > p.y) &&
          p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y)) {
        inside = !inside;
      }
    }
    return inside;
  }

  GeoPoint nearestBoundary(GeoPoint point) {
    final p = _project(point);
    if (_vertices.isEmpty) {
      final angle = atan2(p.y, p.x);
      return _unproject(
        Point(radiusMeters * cos(angle), radiusMeters * sin(angle)),
      );
    }
    var closest = _vertices.first;
    var distance = double.infinity;
    for (var i = 0, j = _vertices.length - 1; i < _vertices.length; j = i++) {
      final a = _vertices[j];
      final edge = _vertices[i] - a;
      final lengthSquared = _dot(edge, edge);
      if (lengthSquared == 0) continue;
      final fraction = (_dot(p - a, edge) / lengthSquared).clamp(0.0, 1.0);
      final candidate = a + edge * fraction;
      final candidateDistance = p.distanceTo(candidate);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        closest = candidate;
      }
    }
    return _unproject(closest);
  }

  /// First border crossing along the GPS segment, measured from [from].
  GeoPoint crossing(GeoPoint from, GeoPoint to) {
    final start = _project(from);
    final delta = _project(to) - start;
    double? first;
    if (_vertices.isEmpty) {
      final a = _dot(delta, delta);
      final b = 2 * _dot(start, delta);
      final c = _dot(start, start) - radiusMeters * radiusMeters;
      final discriminant = b * b - 4 * a * c;
      if (a > 0 && discriminant >= 0) {
        final root = sqrt(discriminant);
        final near = (-b - root) / (2 * a);
        final far = (-b + root) / (2 * a);
        if (near >= 0 && near <= 1) {
          first = near;
        } else if (far >= 0 && far <= 1) {
          first = far;
        }
      }
    } else {
      for (var i = 0, j = _vertices.length - 1; i < _vertices.length; j = i++) {
        final a = _vertices[j];
        final edge = _vertices[i] - a;
        final determinant = _cross(delta, edge);
        if (determinant.abs() < 1e-9) continue;
        final offset = a - start;
        final t = _cross(offset, edge) / determinant;
        final u = _cross(offset, delta) / determinant;
        if (t >= 0 &&
            t <= 1 &&
            u >= 0 &&
            u <= 1 &&
            (first == null || t < first)) {
          first = t;
        }
      }
    }
    return first == null
        ? nearestBoundary(to)
        : _unproject(start + delta * first);
  }

  Point<double> _project(GeoPoint point) => Point(
    (point.longitude - center.longitude) * _longitudeScale,
    (point.latitude - center.latitude) * _latitudeScale,
  );

  GeoPoint _unproject(Point<double> point) => GeoPoint(
    latitude: center.latitude + point.y / _latitudeScale,
    longitude: center.longitude + point.x / _longitudeScale,
  );

  double _dot(Point<double> a, Point<double> b) => a.x * b.x + a.y * b.y;
  double _cross(Point<double> a, Point<double> b) => a.x * b.y - a.y * b.x;
}
