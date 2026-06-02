import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoopGameSocketService extends GameSocketService {
  final StreamController<Map<String, dynamic>> _messagesController =
      StreamController<Map<String, dynamic>>.broadcast();

  @override
  Stream<Map<String, dynamic>> get messages => _messagesController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect({
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {}

  @override
  void joinGame({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
  }) {}

  @override
  void requestGameSync() {}

  @override
  void dispose() {
    _messagesController.close();
    super.dispose();
  }
}

void main() {
  test(
    'reuses server objectives from game config when bootstrap has none',
    () async {
      final controller = GameController(socketService: _NoopGameSocketService());
      const persistedObjectives = <GeoPoint>[
        GeoPoint(latitude: 45.764043, longitude: 4.835659),
        GeoPoint(latitude: 45.7645, longitude: 4.8362),
        GeoPoint(latitude: 45.7636, longitude: 4.8352),
      ];

      await controller.initialize(
        GameBootstrapData(
          lobby: const LobbyBootstrapData(
            code: 'ABC123',
            serverUrl: 'http://localhost:3000',
            socketPath: '/socket.io',
            playerName: 'Host',
          ),
          playerId: 'host-1',
          players: const <LobbyPlayer>[
            LobbyPlayer(id: 'host-1', name: 'Host', isHost: true, role: 'AGENT'),
          ],
          gameConfig: const LobbyGameConfig(
            mapCenter: GeoPoint(latitude: 45.764043, longitude: 4.835659),
            mapRadius: 200,
            objectiveZoneRadius: 25,
            startZoneRadius: 25,
            durationSeconds: 900,
            hackDurationMs: 10000,
            rogueRange: 80,
            startZone: null,
            rogueStartZone: null,
            objectives: persistedObjectives,
            mapStreets: <GeoPoint>[],
          ),
          codeOverride: 'ABC123',
          fromCodeLookupFallback: false,
        ),
      );

      expect(controller.objectives.length, 3);
      expect(controller.objectives.first.point, persistedObjectives.first);
      expect(controller.objectives.last.point, persistedObjectives.last);

      controller.dispose();
    },
  );

  test(
    'uses persisted victory objective count when bootstrap form is missing',
    () async {
      final controller = GameController(socketService: _NoopGameSocketService());

      await controller.initialize(
        GameBootstrapData(
          lobby: const LobbyBootstrapData(
            code: 'ABC123',
            serverUrl: 'http://localhost:3000',
            socketPath: '/socket.io',
            playerName: 'Host',
          ),
          playerId: 'host-1',
          players: const <LobbyPlayer>[
            LobbyPlayer(id: 'host-1', name: 'Host', isHost: true, role: 'AGENT'),
          ],
          gameConfig: const LobbyGameConfig(
            mapCenter: GeoPoint(latitude: 45.764043, longitude: 4.835659),
            mapRadius: 200,
            objectiveZoneRadius: 25,
            startZoneRadius: 25,
            durationSeconds: 900,
            victoryConditionObjectives: 2,
            hackDurationMs: 10000,
            rogueRange: 80,
            startZone: null,
            rogueStartZone: null,
            objectives: <GeoPoint>[
              GeoPoint(latitude: 45.764043, longitude: 4.835659),
              GeoPoint(latitude: 45.7645, longitude: 4.8362),
              GeoPoint(latitude: 45.7636, longitude: 4.8352),
            ],
            mapStreets: <GeoPoint>[],
          ),
          codeOverride: 'ABC123',
          fromCodeLookupFallback: false,
        ),
      );

      expect(controller.victoryObjectivesRequired, 2);

      controller.dispose();
    },
  );
}
