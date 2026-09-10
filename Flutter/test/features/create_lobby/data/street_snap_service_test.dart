import 'package:broken_veil_protocol/features/create_lobby/data/street_snap_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const service = StreetSnapService();

  test('projects a point onto the nearest accessible street segment', () {
    final snapped = service.snapToNearestStreet(
      point: const GeoPoint(latitude: 45.001, longitude: 4.005),
      streets: const <List<GeoPoint>>[
        <GeoPoint>[
          GeoPoint(latitude: 45, longitude: 4),
          GeoPoint(latitude: 45, longitude: 4.01),
        ],
        <GeoPoint>[
          GeoPoint(latitude: 45.01, longitude: 4),
          GeoPoint(latitude: 45.01, longitude: 4.01),
        ],
      ],
    );

    expect(snapped, isNotNull);
    expect(snapped!.latitude, closeTo(45, 0.0000001));
    expect(snapped.longitude, closeTo(4.005, 0.0000001));
  });

  test('returns null when no street segment is available', () {
    final snapped = service.snapToNearestStreet(
      point: const GeoPoint(latitude: 45, longitude: 4),
      streets: const <List<GeoPoint>>[
        <GeoPoint>[GeoPoint(latitude: 45, longitude: 4)],
      ],
    );

    expect(snapped, isNull);
  });

  test('uses the nearest endpoint when projection is outside a segment', () {
    final snapped = service.snapToNearestStreet(
      point: const GeoPoint(latitude: 45.001, longitude: 4.02),
      streets: const <List<GeoPoint>>[
        <GeoPoint>[
          GeoPoint(latitude: 45, longitude: 4),
          GeoPoint(latitude: 45, longitude: 4.01),
        ],
      ],
    );

    expect(snapped, isNotNull);
    expect(snapped!.latitude, 45);
    expect(snapped.longitude, 4.01);
  });
}
