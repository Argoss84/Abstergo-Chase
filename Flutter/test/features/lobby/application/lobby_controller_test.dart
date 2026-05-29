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

class _TestLobbySocketService extends LobbySocketService {
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
    return const JoinLobbyResult(code: 'ABC123', playerId: 'me', hostId: 'host');
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

  test('keeps existing role when player update payload does not include role', () async {
    final socket = _TestLobbySocketService();
    final controller = LobbyController(socketService: socket);

    await controller.initialize(
      bootstrap: const LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Player',
      ),
    );

    socket.emit(const <String, dynamic>{
      'type': 'lobby:joined',
      'payload': <String, dynamic>{
        'code': 'ABC123',
        'playerId': 'me',
        'hostId': 'host',
        'lobby': <String, dynamic>{
          'players': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'p1',
              'name': 'Alpha',
              'role': 'AGENT',
              'status': 'active',
              'isHost': false,
            },
          ],
        },
      },
    });
    await Future<void>.delayed(Duration.zero);

    socket.emit(const <String, dynamic>{
      'type': 'lobby:player-updated',
      'payload': <String, dynamic>{
        'playerId': 'p1',
        'changes': <String, dynamic>{'status': 'disconnected'},
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.players.single.role, 'AGENT');
    expect(controller.players.single.status, 'disconnected');
    controller.dispose();
  });

  test('stores role from peer-joined payload when available', () async {
    final socket = _TestLobbySocketService();
    final controller = LobbyController(socketService: socket);

    await controller.initialize(
      bootstrap: const LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Player',
      ),
    );

    socket.emit(const <String, dynamic>{
      'type': 'lobby:peer-joined',
      'payload': <String, dynamic>{
        'playerId': 'p2',
        'playerName': 'Bravo',
        'role': 'ROGUE',
        'status': 'active',
      },
    });

    await Future<void>.delayed(Duration.zero);

    final peer = controller.players.firstWhere((player) => player.id == 'p2');
    expect(peer.role, 'ROGUE');
    expect(peer.status, 'active');
    controller.dispose();
  });
}
