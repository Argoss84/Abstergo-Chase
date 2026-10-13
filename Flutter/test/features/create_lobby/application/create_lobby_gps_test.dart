import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/application/create_lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/location_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';

class _PendingLocationService extends LocationService {
  Completer<GeoPoint> result = Completer<GeoPoint>();
  int requests = 0;

  @override
  Future<GeoPoint> getCurrentPosition() {
    requests++;
    return result.future;
  }
}

void main() {
  const position = GeoPoint(latitude: 45.76, longitude: 4.84);

  test('one GPS request stays pending while the UI can continue', () async {
    final location = _PendingLocationService();
    final controller = CreateLobbyController(locationService: location);
    addTearDown(controller.dispose);

    final request = controller.loadCurrentPosition();
    expect(controller.isLoadingGps, isTrue);
    await controller.loadCurrentPosition();
    expect(location.requests, 1);
    controller.setDisplayName('Organisateur');
    expect(controller.displayName, 'Organisateur');

    location.result.complete(position);
    await request;
    expect(controller.currentPosition, same(position));
    expect(controller.isLoadingGps, isFalse);
    expect(controller.lastError, isNull);
  });

  test('GPS timeout stops the spinner and permits a fresh retry', () async {
    final location = _PendingLocationService();
    final controller = CreateLobbyController(locationService: location);
    addTearDown(controller.dispose);

    final request = controller.loadCurrentPosition();
    location.result.completeError(TimeoutException('GPS'));
    await request;
    expect(controller.isLoadingGps, isFalse);
    expect(controller.currentPosition, isNull);
    expect(controller.lastError, contains('Aucune position GPS reçue'));

    location.result = Completer<GeoPoint>();
    final retry = controller.loadCurrentPosition();
    expect(controller.lastError, isNull);
    location.result.complete(position);
    await retry;
    expect(location.requests, 2);
    expect(controller.currentPosition, same(position));
    expect(controller.isLoadingGps, isFalse);
  });

  for (final fails in [false, true]) {
    test(
      'leaving during GPS ${fails ? 'failure' : 'success'} is safe',
      () async {
        final location = _PendingLocationService();
        final controller = CreateLobbyController(locationService: location);
        var notifications = 0;
        controller.addListener(() => notifications++);

        final request = controller.loadCurrentPosition();
        expect(notifications, 1);
        controller.dispose();
        if (fails) {
          location.result.completeError(TimeoutException('GPS'));
        } else {
          location.result.complete(position);
        }
        await expectLater(request, completes);
        expect(notifications, 1);
        expect(controller.currentPosition, isNull);
        expect(controller.lastError, isNull);
      },
    );
  }

  test('disposed creation screen cannot start another GPS request', () async {
    final location = _PendingLocationService();
    final controller = CreateLobbyController(locationService: location);
    controller.dispose();

    await controller.loadCurrentPosition();
    expect(location.requests, 0);
  });
}
