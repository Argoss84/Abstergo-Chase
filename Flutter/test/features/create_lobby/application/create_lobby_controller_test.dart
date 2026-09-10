import 'package:broken_veil_protocol/features/create_lobby/application/create_lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/create_lobby_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';

class _RecordingCreateLobbyService extends CreateLobbyService {
  Map<String, dynamic>? gameConfig;

  @override
  Future<CreatedLobbySession> createLobby({
    required String playerName,
    required Uri serverUrl,
    required String socketPath,
    String? cognitoSub,
    Map<String, dynamic>? gameConfig,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    this.gameConfig = gameConfig;
    return const CreatedLobbySession(
      code: 'ABC123',
      playerId: 'host',
      hostId: 'host',
    );
  }
}

void main() {
  group('CreateLobbyController manual placement', () {
    late CreateLobbyController controller;
    late _RecordingCreateLobbyService service;

    setUp(() {
      service = _RecordingCreateLobbyService();
      controller = CreateLobbyController(service: service);
      controller.setDisplayName('Host');
      controller.selectedPosition = const GeoPoint(
        latitude: 45.75,
        longitude: 4.85,
      );
      controller.updateForm(
        controller.form.copyWith(objectiveNumber: 2),
      );
      controller.beginManualPlacement();
    });

    tearDown(() {
      controller.dispose();
    });

    test('places both starts then the configured number of objectives', () {
      const agentStart = GeoPoint(latitude: 45.751, longitude: 4.851);
      const rogueStart = GeoPoint(latitude: 45.752, longitude: 4.852);
      const objectiveOne = GeoPoint(latitude: 45.753, longitude: 4.853);
      const objectiveTwo = GeoPoint(latitude: 45.754, longitude: 4.854);

      controller.handleMapTap(agentStart);
      controller.handleMapTap(rogueStart);
      controller.handleMapTap(objectiveOne);

      expect(controller.agentStartZone, same(agentStart));
      expect(controller.rogueStartZone, same(rogueStart));
      expect(controller.objectives, <GeoPoint>[objectiveOne]);
      expect(controller.objectivesGenerated, isFalse);
      expect(controller.canCreateLobby, isFalse);

      controller.handleMapTap(objectiveTwo);

      expect(controller.objectives, <GeoPoint>[objectiveOne, objectiveTwo]);
      expect(controller.objectivesGenerated, isTrue);
      expect(controller.canCreateLobby, isTrue);
      expect(
        controller.manualPlacementInstruction,
        'Configuration manuelle complète.',
      );
    });

    test('does not place more objectives than configured', () {
      controller.handleMapTap(
        const GeoPoint(latitude: 45.751, longitude: 4.851),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.752, longitude: 4.852),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.753, longitude: 4.853),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.754, longitude: 4.854),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.755, longitude: 4.855),
      );

      expect(controller.objectives, hasLength(2));
    });

    test('invalidates placed points when the configured count changes', () {
      controller.handleMapTap(
        const GeoPoint(latitude: 45.751, longitude: 4.851),
      );

      controller.updateForm(
        controller.form.copyWith(objectiveNumber: 3),
      );

      expect(controller.agentStartZone, isNull);
      expect(controller.rogueStartZone, isNull);
      expect(controller.objectives, isEmpty);
      expect(controller.objectivesGenerated, isFalse);
      expect(controller.isManualPlacement, isFalse);
      expect(controller.canCreateLobby, isFalse);
    });

    test('persists manually placed points in the game configuration', () async {
      controller.handleMapTap(
        const GeoPoint(latitude: 45.751, longitude: 4.851),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.752, longitude: 4.852),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.753, longitude: 4.853),
      );
      controller.handleMapTap(
        const GeoPoint(latitude: 45.754, longitude: 4.854),
      );

      await controller.createLobby();

      expect(service.gameConfig?['start_zone_latitude'], '45.751');
      expect(service.gameConfig?['start_zone_longitude'], '4.851');
      expect(service.gameConfig?['start_zone_rogue_latitude'], '45.752');
      expect(service.gameConfig?['start_zone_rogue_longitude'], '4.852');
      expect(service.gameConfig?['objective_points'], <List<double>>[
        <double>[45.753, 4.853],
        <double>[45.754, 4.854],
      ]);
    });
  });
}
