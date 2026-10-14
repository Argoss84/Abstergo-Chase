import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/application/create_lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/create_lobby_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/street_contour_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/street_fetch_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';

class _PendingStreets extends StreetFetchService {
  final requests =
      <
        ({GeoPoint center, int radius, Completer<List<List<GeoPoint>>> result})
      >[];
  final cancellations = <StreetFetchCancellation?>[];

  @override
  Future<List<List<GeoPoint>>> fetchWalkableStreets({
    required GeoPoint center,
    required int mapRadiusMeters,
    StreetFetchCancellation? cancellation,
  }) {
    cancellations.add(cancellation);
    final result = Completer<List<List<GeoPoint>>>();
    requests.add((center: center, radius: mapRadiusMeters, result: result));
    return result.future;
  }
}

class _Contour extends StreetContourService {
  Completer<List<GeoPoint>>? pending;

  @override
  Future<List<GeoPoint>> computeOuterContourAsync({
    required GeoPoint center,
    required int radiusMeters,
    required List<List<GeoPoint>> streets,
  }) async => pending == null ? streets.first : await pending!.future;
}

class _PendingCreation extends CreateLobbyService {
  final result = Completer<CreatedLobbySession>();
  int calls = 0;

  @override
  Future<CreatedLobbySession> createLobby({
    required String playerName,
    required Uri serverUrl,
    required String socketPath,
    String? cognitoSub,
    Map<String, dynamic>? gameConfig,
    Duration timeout = const Duration(seconds: 12),
  }) {
    calls++;
    return result.future;
  }
}

void main() {
  const centerA = GeoPoint(latitude: 45, longitude: 4);
  const centerB = GeoPoint(latitude: 46, longitude: 5);
  const streetsA = [
    [centerA, GeoPoint(latitude: 45.001, longitude: 4)],
  ];
  const streetsB = [
    [centerB, GeoPoint(latitude: 46.001, longitude: 5)],
  ];
  late _PendingStreets fetch;
  late _Contour contour;
  late CreateLobbyController controller;

  setUp(() {
    fetch = _PendingStreets();
    contour = _Contour();
    controller = CreateLobbyController(
      streetFetchService: fetch,
      streetContourService: contour,
    );
  });

  for (final failOldRequest in [false, true]) {
    test(
      'obsolete street ${failOldRequest ? 'error' : 'result'} does not replace the current terrain',
      () async {
        addTearDown(controller.dispose);
        controller.selectedPosition = centerA;
        final oldRequest = controller.fetchStreets();
        controller.selectedPosition = centerB;
        final currentRequest = controller.fetchStreets();
        expect(fetch.cancellations.first!.isCancelled, isTrue);
        if (failOldRequest) {
          fetch.requests.first.result.completeError(StateError('old terrain'));
        } else {
          fetch.requests.first.result.complete(streetsA);
        }
        await oldRequest;
        expect(controller.isLoadingStreets, isTrue);
        expect(controller.streets, isEmpty);
        expect(controller.streetsLoadError, isNull);
        fetch.requests.last.result.complete(streetsB);
        await currentRequest;
        expect(controller.streets, streetsB);
        expect(controller.outerStreetContour, streetsB.first);
        expect(controller.isLoadingStreets, isFalse);
      },
    );
  }

  test(
    'late old streets cannot overwrite an already loaded new terrain',
    () async {
      addTearDown(controller.dispose);
      controller.selectedPosition = centerA;
      final old = controller.fetchStreets();
      controller.selectedPosition = centerB;
      final current = controller.fetchStreets();
      fetch.requests.last.result.complete(streetsB);
      await current;
      fetch.requests.first.result.complete(streetsA);
      await old;
      expect(controller.streets, streetsB);
      expect(controller.outerStreetContour, streetsB.first);
    },
  );

  test(
    'changing the radius restarts loading and invalidates the old result',
    () async {
      addTearDown(controller.dispose);
      controller.selectedPosition = centerA;
      final old = controller.fetchStreets();
      controller.updateForm(controller.form.copyWith(mapRadius: 400));
      expect(fetch.requests.last.radius, 400);
      fetch.requests.first.result.complete(streetsA);
      await old;
      expect(controller.isLoadingStreets, isTrue);
      fetch.requests.last.result.complete(streetsB);
      await Future<void>.delayed(Duration.zero);
      expect(controller.streets, streetsB);
      expect(controller.isLoadingStreets, isFalse);
    },
  );

  for (final duringContour in [false, true]) {
    test(
      'leaving during ${duringContour ? 'contour calculation' : 'street loading'} is safe',
      () async {
        controller.selectedPosition = centerA;
        final request = controller.fetchStreets();
        if (duringContour) {
          contour.pending = Completer<List<GeoPoint>>();
          fetch.requests.first.result.complete(streetsA);
          await Future<void>.delayed(Duration.zero);
        }
        controller.dispose();
        expect(fetch.cancellations.first!.isCancelled, isTrue);
        if (duringContour) {
          contour.pending!.complete(streetsA.first);
        } else {
          fetch.requests.first.result.complete(streetsA);
        }
        await expectLater(request, completes);
        expect(controller.streets, isEmpty);
        expect(controller.outerStreetContour, isEmpty);
      },
    );
  }

  test(
    'duplicate creation is ignored and a disposed screen does not publish its result',
    () async {
      controller.dispose();
      final creation = _PendingCreation();
      controller = CreateLobbyController(service: creation)
        ..selectedPosition = centerA
        ..displayName = 'Host'
        ..agentStartZone = centerA
        ..rogueStartZone = centerB;
      controller.objectives = List.filled(
        controller.form.objectiveNumber,
        centerA,
      );
      final first = controller.createLobby();
      await controller.createLobby();
      expect(creation.calls, 1);
      controller.dispose();
      creation.result.complete(
        const CreatedLobbySession(
          code: 'ABC123',
          playerId: 'host',
          hostId: 'host',
        ),
      );
      await expectLater(first, completes);
      expect(controller.createdLobbySession, isNull);
    },
  );

  test(
    'a background contour preserves the geometry computed synchronously',
    () async {
      addTearDown(controller.dispose);
      const service = StreetContourService();
      const streets = [
        [
          centerA,
          GeoPoint(latitude: 45, longitude: 4.001),
          GeoPoint(latitude: 45.001, longitude: 4.001),
          GeoPoint(latitude: 45.001, longitude: 4),
          centerA,
        ],
      ];
      final expected = service.computeOuterContour(
        center: centerA,
        radiusMeters: 200,
        streets: streets,
      );
      final actual = await service.computeOuterContourAsync(
        center: centerA,
        radiusMeters: 200,
        streets: streets,
      );
      expect(
        actual.map((p) => (p.latitude, p.longitude)),
        expected.map((p) => (p.latitude, p.longitude)),
      );
    },
  );
}
