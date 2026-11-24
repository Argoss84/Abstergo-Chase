import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

/// Uses the street contour or the map circle, plus any included start zone.
class PlayArea {
  PlayArea({
    required this.center,
    required this.radiusMeters,
    List<GeoPoint> contour = const [],
    ({GeoPoint center, double radiusMeters})? includedCircle,
  }) : _longitudeScale = 111195 * max(1e-6, cos(center.latitude * pi / 180)) {
    final vertices = contour
        .where((point) => point.isValid)
        .map(_project)
        .toList();
    if (vertices.length > 1 && vertices.first == vertices.last) {
      vertices.removeLast();
    }
    _vertices = vertices.length >= 3 ? vertices : const [];
    _includedCircle = includedCircle == null
        ? null
        : (
            center: _project(includedCircle.center),
            radiusMeters: includedCircle.radiusMeters,
          );
  }

  final GeoPoint center;
  final double radiusMeters;
  final double _longitudeScale;
  late final List<Point<double>> _vertices;
  late final ({Point<double> center, double radiusMeters})? _includedCircle;
  static const _latitudeScale = 111195.0;

  bool contains(GeoPoint point) => _containsProjected(_project(point));

  bool _containsProjected(Point<double> p) {
    final included = _includedCircle;
    if (included != null &&
        p.distanceTo(included.center) <= included.radiusMeters) {
      return true;
    }
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

  /// Nearest point on the boundary of the main terrain.
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

  /// First exit along a GPS segment from an inside fix to an outside fix.
  GeoPoint crossing(GeoPoint from, GeoPoint to) {
    final start = _project(from);
    final delta = _project(to) - start;
    final included = _includedCircle;
    final crossings = [
      if (_vertices.isEmpty)
        ..._circleCrossings(start, delta, radiusMeters)
      else
        ..._contourCrossings(start, delta),
      if (included != null)
        ..._circleCrossings(
          start - included.center,
          delta,
          included.radiusMeters,
        ),
    ]..sort();
    for (var i = 0; i < crossings.length; i++) {
      final fraction = crossings[i];
      final next = i + 1 < crossings.length ? crossings[i + 1] : 1.0;
      if (i + 1 < crossings.length && fraction == next) continue;
      // An edge inside either part of the terrain is not an exit.
      final after = start + delta * ((fraction + next) / 2);
      if (!_containsProjected(after)) {
        return _unproject(start + delta * fraction);
      }
    }
    return nearestBoundary(to);
  }

  Iterable<double> _circleCrossings(
    Point<double> start,
    Point<double> delta,
    double radius,
  ) sync* {
    final a = _dot(delta, delta);
    final b = 2 * _dot(start, delta);
    final c = _dot(start, start) - radius * radius;
    final discriminant = b * b - 4 * a * c;
    if (a == 0 || discriminant < 0) return;
    final root = sqrt(discriminant);
    final first = (-b - root) / (2 * a);
    final second = (-b + root) / (2 * a);
    if (first >= 0 && first <= 1) yield first;
    if (second != first && second >= 0 && second <= 1) yield second;
  }

  Iterable<double> _contourCrossings(
    Point<double> start,
    Point<double> delta,
  ) sync* {
    for (var i = 0, j = _vertices.length - 1; i < _vertices.length; j = i++) {
      final a = _vertices[j];
      final edge = _vertices[i] - a;
      final determinant = _cross(delta, edge);
      if (determinant.abs() < 1e-9) continue;
      final offset = a - start;
      final t = _cross(offset, edge) / determinant;
      final u = _cross(offset, delta) / determinant;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        yield t;
      }
    }
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
