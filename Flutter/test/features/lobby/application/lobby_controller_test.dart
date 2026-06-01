import 'dart:async';

import 'package:broken_veil_protocol/features/lobby/application/lobby_controller.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';

class _FailingJoinLobbySocketService extends LobbySocketService {
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
  Future<JoinLobbyResult> joinLobby({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
    bool reconnectAsHost = false,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    _messagesController.add(const <String, dynamic>{
      'type': 'lobby:error',
      'payload': 'Lobby not found.',
    });
    throw Exception('Lobby not found.');
  }

  @override
  void dispose() {
    _messagesController.close();
  }
}

class _LobbyMessagesSocketService extends LobbySocketService {
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
  Future<JoinLobbyResult> joinLobby({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
    bool reconnectAsHost = false,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    return const JoinLobbyResult(
      code: 'ABC123',
      playerId: 'player-1',
      hostId: 'host-1',
    );
  }

  void emit(Map<String, dynamic> message) => _messagesController.add(message);

  @override
  void dispose() {
    _messagesController.close();
  }
}

void main() {
  test(
    'triggers game fallback route when lobby join returns lobby not found',
    () async {
      final controller = LobbyController(
        socketService: _FailingJoinLobbySocketService(),
      );
      await controller.initialize(
        bootstrap: const LobbyBootstrapData(
          code: 'ABC123',
          serverUrl: 'http://localhost:3000',
          socketPath: '/socket.io',
          playerName: 'Player',
        ),
      );

      expect(controller.connectionStatus, 'error');
      expect(controller.error, isNotNull);
      expect(controller.shouldOpenGameForCode, isTrue);

      controller.dispose();
    },
  );

  test('hydrates chat history from lobby snapshot on join/rejoin event', () async {
    final socketService = _LobbyMessagesSocketService();
    final controller = LobbyController(socketService: socketService);

    await controller.initialize(
      bootstrap: const LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Player',
      ),
    );

    socketService.emit({
      'type': 'lobby:joined',
      'payload': {
        'playerId': 'player-1',
        'hostId': 'host-1',
        'lobby': {
          'players': const [],
          'chatMessages': [
            {
              'playerId': 'player-2',
              'playerName': 'Alice',
              'text': 'Salut',
              'timestamp': 111,
            },
            {
              'playerId': 'player-3',
              'playerName': 'Bob',
              'text': 'Re',
              'timestamp': 222,
            },
          ],
        },
      },
    });

    await Future<void>.delayed(Duration.zero);

    expect(controller.chatMessages, hasLength(2));
    expect(controller.chatMessages.first.text, 'Salut');
    expect(controller.chatMessages.last.timestampMs, 222);

    controller.dispose();
  });
}
