import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
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
    'generate fallback objectives when bootstrap has none',
    () async {
      final controller = GameController(socketService: _NoopGameSocketService());

      await controller.initialize(
        GameBootstrapData(
          lobby: LobbyBootstrapData(
            code: 'ABC123',
            serverUrl: 'http://localhost:3000',
            socketPath: '/socket.io',
            playerName: 'Host',
            form: const CreateLobbyFormData(
              objectiveNumber: 3,
              duration: 900,
              victoryConditionObjectives: 1,
              hackDurationMs: 10000,
              objectiveZoneRadius: 25,
              startZoneRadius: 25,
              rogueRange: 10,
              agentRange: 80,
              mapCenterLatitude: '45.764043',
              mapCenterLongitude: '4.835659',
              mapRadius: 200,
            ),
          ),
          playerId: 'host-1',
          players: const <LobbyPlayer>[
            LobbyPlayer(id: 'host-1', name: 'Host', isHost: true, role: 'AGENT'),
          ],
          gameConfig: null,
          codeOverride: 'ABC123',
          fromCodeLookupFallback: false,
        ),
      );

      expect(controller.objectives.length, 3);
      expect(
        controller.objectives.map((objective) => objective.id).toSet().length,
        3,
      );

      controller.dispose();
    },
  );
}
