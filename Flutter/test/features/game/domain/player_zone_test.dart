import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/play_area.dart';
import 'package:broken_veil_protocol/features/game/domain/player_zone.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'requires crossing back near the original exit even after a wrong reentry',
    () {
      const center = GeoPoint(latitude: 0, longitude: 0);
      final area = PlayArea(center: center, radiusMeters: 125);
      var state = PlayerZone.update(area, center, enforceReentry: true);

      void move(double latitude, double longitude) {
        state = PlayerZone.update(
          area,
          GeoPoint(latitude: latitude, longitude: longitude),
          enforceReentry: true,
          previous: state,
        );
      }

      move(0, 0.0015);
      final exit = state.reentryPoint;
      expect(exit?.longitude, closeTo(0.001124, 0.000002));
      expect(state.restricted, isTrue);
      move(0.0015, -0.0015);
      move(0, -0.0008);
      expect(state.outside, isFalse);
      expect(state.restricted, isTrue);
      expect(state.reentryPoint, same(exit));

      move(0.00004, 0.0015);
      move(0.00004, 0.0010);
      expect(state.restricted, isFalse);
      expect(state.reentryPoint, isNull);
    },
  );
}
