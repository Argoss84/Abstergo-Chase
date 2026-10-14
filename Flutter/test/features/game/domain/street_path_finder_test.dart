import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/domain/street_path_finder.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const start = GeoPoint(latitude: 45, longitude: 4);
  const middle = GeoPoint(latitude: 45, longitude: 4.001);
  const target = GeoPoint(latitude: 45, longitude: 4.002);
  const detour = GeoPoint(latitude: 45.002, longitude: 4);

  test('chooses the shortest connected street route, including cycles', () {
    final path = StreetPathFinder().findPath(
      start: start,
      target: target,
      streets: const [
        [start, detour, target],
        [start, middle, target],
        [middle, start],
      ],
    );
    expect(path, contains(middle));
    expect(path, isNot(contains(detour)));
    expect(path.first, start);
    expect(path.last, target);
  });

  test('does not invent a route between disconnected street components', () {
    final path = StreetPathFinder().findPath(
      start: start,
      target: target,
      streets: const [
        [start, middle],
        [target, detour],
      ],
    );
    expect(path, isEmpty);
  });

  test('recomputes the route after a move, a target change or new streets', () {
    final finder = StreetPathFinder();
    const streets = [
      [start, middle, target],
    ];
    final first = finder.findPath(
      start: start,
      target: target,
      streets: streets,
    );
    final repeated = finder.findPath(
      start: const GeoPoint(latitude: 45, longitude: 4),
      target: target,
      streets: streets,
    );
    expect(repeated, same(first));
    final moved = finder.findPath(
      start: middle,
      target: target,
      streets: streets,
    );
    expect(moved.first, middle);
    expect(moved, isNot(contains(start)));
    final reversed = finder.findPath(
      start: middle,
      target: start,
      streets: streets,
    );
    expect(reversed.last, start);
    final changed = finder.findPath(
      start: middle,
      target: target,
      streets: const [
        [start, middle],
        [target, detour],
      ],
    );
    expect(changed, isEmpty);
  });

  test('empty and one-node street networks have no route', () {
    final finder = StreetPathFinder();
    for (final streets in <List<List<GeoPoint>>>[
      [],
      [
        [start],
      ],
      [
        [start, start],
      ],
    ]) {
      expect(
        finder.findPath(start: start, target: target, streets: streets),
        isEmpty,
      );
    }
  });
}
