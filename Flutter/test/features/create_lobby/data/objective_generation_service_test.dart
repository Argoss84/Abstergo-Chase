import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/data/objective_generation_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'places Agent near center and Rogue near the edge of a small terrain',
    () {
      const center = GeoPoint(latitude: 45, longitude: 4);
      final layout = ObjectiveGenerationService(random: Random(1)).generate(
        center: center,
        mapRadiusMeters: 125,
        objectiveCount: 3,
        streets: const [
          [
            GeoPoint(latitude: 44.99895, longitude: 4),
            GeoPoint(latitude: 45.00105, longitude: 4),
          ],
        ],
      );
      expect(layout.agentStartZone.latitude, closeTo(45, 0.000001));
      expect((layout.rogueStartZone.latitude - 45).abs(), greaterThan(0.001));
      expect(layout.objectives, hasLength(3));
      for (final point in layout.objectives) {
        expect(point.longitude, 4);
        expect(point.latitude, inInclusiveRange(44.99895, 45.00105));
        expect((point.latitude - 45).abs(), greaterThan(0.00001));
        expect(
          (point.latitude - layout.rogueStartZone.latitude).abs(),
          greaterThan(0.00001),
        );
      }
    },
  );
}
