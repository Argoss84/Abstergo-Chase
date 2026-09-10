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
      controller.streets = const <List<GeoPoint>>[
        <GeoPoint>[
          GeoPoint(latitude: 45.75, longitude: 4.84),
          GeoPoint(latitude: 45.75, longitude: 4.86),
        ],
      ];
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

      expect(controller.agentStartZone?.latitude, 45.75);
      expect(controller.agentStartZone?.longitude, closeTo(4.851, 0.0000001));
      expect(controller.rogueStartZone?.latitude, 45.75);
      expect(controller.rogueStartZone?.longitude, closeTo(4.852, 0.0000001));
      expect(controller.objectives.single.latitude, 45.75);
      expect(
        controller.objectives.single.longitude,
        closeTo(4.853, 0.0000001),
      );
      expect(controller.objectivesGenerated, isFalse);
      expect(controller.canCreateLobby, isFalse);

      controller.handleMapTap(objectiveTwo);

      expect(controller.objectives, hasLength(2));
      expect(controller.objectives.last.latitude, 45.75);
      expect(
        controller.objectives.last.longitude,
        closeTo(4.854, 0.0000001),
      );
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

    test('requires accessible streets before starting manual placement', () {
      controller.streets = <List<GeoPoint>>[];

      controller.beginManualPlacement();

      expect(controller.isManualPlacement, isFalse);
      expect(
        controller.lastError,
        'Les rues doivent être chargées avant de placer les points.',
      );
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

      expect(service.gameConfig?['start_zone_latitude'], '45.75');
      expect(
        double.parse(service.gameConfig?['start_zone_longitude'] as String),
        closeTo(4.851, 0.0000001),
      );
      expect(service.gameConfig?['start_zone_rogue_latitude'], '45.75');
      expect(
        double.parse(
          service.gameConfig?['start_zone_rogue_longitude'] as String,
        ),
        closeTo(4.852, 0.0000001),
      );
      final objectives =
          service.gameConfig?['objective_points'] as List<List<double>>;
      expect(objectives, hasLength(2));
      expect(objectives[0][0], 45.75);
      expect(objectives[0][1], closeTo(4.853, 0.0000001));
      expect(objectives[1][0], 45.75);
      expect(objectives[1][1], closeTo(4.854, 0.0000001));
    });
  });
}
