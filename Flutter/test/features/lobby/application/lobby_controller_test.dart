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

class _JoinedLobbyWithConfigSocketService extends LobbySocketService {
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
    _messagesController.add(<String, dynamic>{
      'type': 'lobby:joined',
      'payload': <String, dynamic>{
        'code': code,
        'playerId': 'player-2',
        'hostId': 'player-1',
        'lobby': <String, dynamic>{
          'config': <String, dynamic>{
            'objectif_number': 5,
            'duration': 1200,
            'victory_condition_nb_objectivs': 3,
            'hack_duration_ms': 9000,
            'objectiv_zone_radius': 30,
            'start_zone_radius': 35,
            'rogue_range': 150,
            'agent_range': 80,
            'map_center_latitude': '45.764043',
            'map_center_longitude': '4.835659',
            'map_radius': 350,
          },
        },
      },
    });
    return const JoinLobbyResult(
      code: 'ABC123',
      playerId: 'player-2',
      hostId: 'player-1',
    );
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

class _ReconnectingLobbySocketService extends LobbySocketService {
  final StreamController<Map<String, dynamic>> _messagesController =
      StreamController<Map<String, dynamic>>.broadcast();
  final List<String?> joinPreviousPlayerIds = <String?>[];
  int joinCalls = 0;

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
    joinCalls += 1;
    joinPreviousPlayerIds.add(previousPlayerId);
    return const JoinLobbyResult(
      code: 'ABC123',
      playerId: 'player-1',
      hostId: 'host-1',
    );
  }

  void emit(Map<String, dynamic> message) => _messagesController.add(message);

  @override
  void requestLatestState() {}

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

  test(
    'hydrates bootstrap form from server config when joining lobby',
    () async {
      final controller = LobbyController(
        socketService: _JoinedLobbyWithConfigSocketService(),
      );
      await controller.initialize(
        bootstrap: const LobbyBootstrapData(
          code: 'ABC123',
          serverUrl: 'http://localhost:3000',
          socketPath: '/socket.io',
          playerName: 'Player',
        ),
      );

      final form = controller.bootstrapData?.form;
      expect(form, isNotNull);
      expect(form?.objectiveNumber, 5);
      expect(form?.victoryConditionObjectives, 3);
      expect(form?.duration, 1200);
      expect(form?.hackDurationMs, 9000);
      expect(form?.objectiveZoneRadius, 30);
      expect(form?.startZoneRadius, 35);
      expect(form?.rogueRange, 150);
      expect(form?.agentRange, 80);
      expect(form?.mapCenterLatitude, '45.764043');
      expect(form?.mapCenterLongitude, '4.835659');
      expect(form?.mapRadius, 350);

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

  test('keeps existing role when player update payload does not include role', () async {
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

    socketService.emit(const <String, dynamic>{
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

    socketService.emit(const <String, dynamic>{
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

    socketService.emit(const <String, dynamic>{
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

  test('rejoins lobby after socket reconnect to recover peer updates', () async {
    final socketService = _ReconnectingLobbySocketService();
    final controller = LobbyController(socketService: socketService);

    await controller.initialize(
      bootstrap: const LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Player',
        previousPlayerId: 'stored-player-id',
      ),
    );

    expect(socketService.joinCalls, 1);
    expect(socketService.joinPreviousPlayerIds, <String?>['stored-player-id']);

    socketService.emit(const <String, dynamic>{
      'type': 'socket:reconnected',
      'payload': <String, dynamic>{},
    });
    await Future<void>.delayed(const Duration(milliseconds: 1));

    expect(socketService.joinCalls, 2);
    expect(
      socketService.joinPreviousPlayerIds,
      <String?>['stored-player-id', 'player-1'],
    );
    expect(controller.connectionStatus, 'connected');
    controller.dispose();
  });
}
