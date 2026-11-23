import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/play_area.dart';
import 'package:geolocator/geolocator.dart';

class PlayerZone {
  const PlayerZone({
    required this.position,
    required this.outside,
    this.reentryPoint,
  });

  final GeoPoint position;
  final bool outside;
  final GeoPoint? reentryPoint;

  bool get restricted => outside || reentryPoint != null;

  static PlayerZone update(
    PlayArea area,
    GeoPoint position, {
    required bool enforceReentry,
    PlayerZone? previous,
  }) {
    final outside = !area.contains(position);
    GeoPoint? reentryPoint;
    if (enforceReentry && previous != null) {
      reentryPoint = previous.reentryPoint;
      if (outside && !previous.outside) {
        reentryPoint ??= area.crossing(previous.position, position);
      } else if (!outside && previous.outside && reentryPoint != null) {
        final crossing = area.crossing(position, previous.position);
        final distance = Geolocator.distanceBetween(
          crossing.latitude,
          crossing.longitude,
          reentryPoint.latitude,
          reentryPoint.longitude,
        );
        if (distance <= 15) reentryPoint = null;
      }
    }
    return PlayerZone(
      position: position,
      outside: outside,
      reentryPoint: reentryPoint,
    );
  }
}
