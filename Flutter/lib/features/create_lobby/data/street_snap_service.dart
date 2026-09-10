import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

class StreetSnapService {
  const StreetSnapService();

  GeoPoint? snapToNearestStreet({
    required GeoPoint point,
    required List<List<GeoPoint>> streets,
  }) {
    GeoPoint? closest;
    var closestDistanceSquared = double.infinity;

    for (final street in streets) {
      for (var i = 0; i < street.length - 1; i++) {
        final candidate = _closestPointOnSegment(
          point: point,
          start: street[i],
          end: street[i + 1],
        );
        final distanceSquared = _distanceSquared(point, candidate);
        if (distanceSquared < closestDistanceSquared) {
          closest = candidate;
          closestDistanceSquared = distanceSquared;
        }
      }
    }

    return closest;
  }

  GeoPoint _closestPointOnSegment({
    required GeoPoint point,
    required GeoPoint start,
    required GeoPoint end,
  }) {
    final longitudeScale = cos(point.latitude * pi / 180);
    final startX = (start.longitude - point.longitude) * longitudeScale;
    final startY = start.latitude - point.latitude;
    final endX = (end.longitude - point.longitude) * longitudeScale;
    final endY = end.latitude - point.latitude;
    final segmentX = endX - startX;
    final segmentY = endY - startY;
    final segmentLengthSquared =
        segmentX * segmentX + segmentY * segmentY;

    if (segmentLengthSquared == 0) {
      return start;
    }

    final projection = (-(startX * segmentX + startY * segmentY) /
            segmentLengthSquared)
        .clamp(0.0, 1.0)
        .toDouble();
    return GeoPoint(
      latitude: start.latitude + (end.latitude - start.latitude) * projection,
      longitude:
          start.longitude + (end.longitude - start.longitude) * projection,
    );
  }

  double _distanceSquared(GeoPoint a, GeoPoint b) {
    final longitudeScale = cos(a.latitude * pi / 180);
    final latitudeDelta = b.latitude - a.latitude;
    final longitudeDelta = (b.longitude - a.longitude) * longitudeScale;
    return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
  }
}
