import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _NoopGameSocketService extends GameSocketService {
  final StreamController<Map<String, dynamic>> _messagesController =
      StreamController<Map<String, dynamic>>.broadcast();
  String? sentGlobalChat;
  String? sentRoleChat;

  void emit(Map<String, dynamic> event) {
    _messagesController.add(event);
  }

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
  void sendGameAction(Map<String, dynamic> action) {}

  @override
  void sendGlobalChat(String text) {
    sentGlobalChat = text;
  }

  @override
  void sendRoleChat({required String role, required String text}) {
    sentRoleChat = text;
  }

  @override
  void pushState({
    required Map<String, dynamic> state,
    String? targetId,
  }) {}

  @override
  void dispose() {
    _messagesController.close();
    super.dispose();
  }
}

class _VoiceAwareGameController extends GameController {
  _VoiceAwareGameController({required super.socketService});

  final Set<String> _activeVoicePlayerIds = <String>{};

  void setActiveVoicePlayers(Iterable<String> ids) {
    _activeVoicePlayerIds
      ..clear()
      ..addAll(ids);
  }

  @override
  bool isPlayerVoiceActive(String playerId) {
    return _activeVoicePlayerIds.contains(playerId);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

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
            agentRange: 80,
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
            agentRange: 80,
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

  test('activeSameRoleVoicePlayers returns only active same-role teammates', () {
    final controller = _VoiceAwareGameController(
      socketService: _NoopGameSocketService(),
    );
    controller.playerId = 'me';
    controller.playerRole = 'AGENT';
    controller.players
      ..clear()
      ..addAll(const <GamePlayer>[
        GamePlayer(
          id: 'me',
          name: 'Me',
          isHost: false,
          role: 'AGENT',
          status: 'active',
        ),
        GamePlayer(
          id: 'ally-active',
          name: 'Ally Active',
          isHost: false,
          role: 'AGENT',
          status: 'active',
        ),
        GamePlayer(
          id: 'ally-inactive',
          name: 'Ally Inactive',
          isHost: false,
          role: 'AGENT',
          status: 'active',
        ),
        GamePlayer(
          id: 'rogue-active',
          name: 'Rogue Active',
          isHost: false,
          role: 'ROGUE',
          status: 'active',
        ),
        GamePlayer(
          id: 'ally-disconnected',
          name: 'Ally Disconnected',
          isHost: false,
          role: 'AGENT',
          status: 'disconnected',
        ),
      ]);
    controller.setActiveVoicePlayers(<String>{
      'ally-active',
      'ally-inactive',
      'rogue-active',
      'ally-disconnected',
    });

    expect(
      controller.activeSameRoleVoicePlayers.map((p) => p.id).toList(),
      <String>['ally-active', 'ally-inactive'],
    );

    controller.setActiveVoicePlayers(<String>{
      'rogue-active',
      'ally-disconnected',
    });
    expect(controller.activeSameRoleVoicePlayers, isEmpty);

    controller.dispose();
  });

  test('does not keep a sticky banner for missing WebRTC recipients', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());
    controller.error = null;
    controller.connectionStatus = 'connected';

    socket.emit(<String, dynamic>{
      'type': 'game:error',
      'payload': <String, dynamic>{
        'message': 'Destinataire WebRTC introuvable.',
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.error, isNull);
    expect(controller.connectionStatus, isNot('error'));

    controller.dispose();
  });

  test('shows the game:error message field instead of the raw map', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());
    controller.error = null;
    controller.connectionStatus = 'connected';

    socket.emit(<String, dynamic>{
      'type': 'game:error',
      'payload': <String, dynamic>{'message': 'Partie introuvable.'},
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.error, 'Partie introuvable.');

    controller.dispose();
  });

  test('keeps last known markers after a join roster without coordinates', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());
    controller.error = null;
    controller.connectionStatus = 'connected';
    controller.playerId = 'host-1';
    controller.playerRole = 'AGENT';
    controller.myPosition = const GeoPoint(
      latitude: 45.764043,
      longitude: 4.835659,
    );
    controller.players
      ..clear()
      ..addAll(const <GamePlayer>[
        GamePlayer(
          id: 'host-1',
          name: 'Host',
          isHost: true,
          role: 'AGENT',
          latitude: 45.764043,
          longitude: 4.835659,
        ),
        GamePlayer(
          id: 'ally-1',
          name: 'Ally',
          isHost: false,
          role: 'AGENT',
          latitude: 45.7645,
          longitude: 4.8362,
        ),
      ]);

    socket.emit(<String, dynamic>{
      'type': 'game:joined',
      'payload': <String, dynamic>{
        'code': 'ABC123',
        'playerId': 'host-1',
        'hostId': 'host-1',
        'game': <String, dynamic>{
          'players': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'host-1',
              'name': 'Host',
              'isHost': true,
              'role': 'AGENT',
              'status': 'active',
            },
            <String, dynamic>{
              'id': 'ally-1',
              'name': 'Ally',
              'isHost': false,
              'role': 'AGENT',
              'status': 'disconnected',
            },
          ],
        },
      },
    });
    await Future<void>.delayed(Duration.zero);

    final host = controller.players.firstWhere((p) => p.id == 'host-1');
    final ally = controller.players.firstWhere((p) => p.id == 'ally-1');
    expect(host.latitude, 45.764043);
    expect(ally.latitude, 45.7645);
    expect(
      controller.mapMarkerPlayers.map((p) => p.id),
      containsAll(<String>['host-1', 'ally-1']),
    );

    controller.dispose();
  });

  test('keeps last known markers when rejoin assigns new player ids', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());
    controller.error = null;
    controller.connectionStatus = 'connected';
    controller.playerId = 'host-1';
    controller.playerRole = 'AGENT';
    controller.myPosition = const GeoPoint(
      latitude: 45.764043,
      longitude: 4.835659,
    );
    controller.players
      ..clear()
      ..addAll(const <GamePlayer>[
        GamePlayer(
          id: 'host-1',
          name: 'Host',
          isHost: true,
          role: 'AGENT',
          latitude: 45.764043,
          longitude: 4.835659,
        ),
        GamePlayer(
          id: 'ally-1',
          name: 'Ally',
          isHost: false,
          role: 'AGENT',
          latitude: 45.7645,
          longitude: 4.8362,
        ),
      ]);

    socket.emit(<String, dynamic>{
      'type': 'game:joined',
      'payload': <String, dynamic>{
        'code': 'ABC123',
        'playerId': 'host-2',
        'hostId': 'host-2',
        'game': <String, dynamic>{
          'players': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'host-2',
              'name': 'Host',
              'isHost': true,
              'role': 'AGENT',
              'status': 'active',
            },
            <String, dynamic>{
              'id': 'ally-2',
              'name': 'Ally',
              'isHost': false,
              'role': 'AGENT',
              'status': 'disconnected',
            },
          ],
        },
      },
    });
    await Future<void>.delayed(Duration.zero);

    final host = controller.players.firstWhere((p) => p.id == 'host-2');
    final ally = controller.players.firstWhere((p) => p.id == 'ally-2');
    expect(host.latitude, 45.764043);
    expect(ally.latitude, 45.7645);
    expect(ally.longitude, 4.8362);
    expect(
      controller.mapMarkerPlayers.map((p) => p.id),
      containsAll(<String>['host-2', 'ally-2']),
    );

    controller.dispose();
  });

  test('keeps last known coords when a peer reconnects with a new id', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());
    controller.error = null;
    controller.connectionStatus = 'connected';
    controller.playerId = 'host-1';
    controller.playerRole = 'AGENT';
    controller.players
      ..clear()
      ..addAll(const <GamePlayer>[
        GamePlayer(
          id: 'host-1',
          name: 'Host',
          isHost: true,
          role: 'AGENT',
          latitude: 45.764043,
          longitude: 4.835659,
        ),
        GamePlayer(
          id: 'ally-1',
          name: 'Ally',
          isHost: false,
          role: 'AGENT',
          latitude: 45.7645,
          longitude: 4.8362,
        ),
      ]);

    socket.emit(<String, dynamic>{
      'type': 'game:peer-reconnected',
      'payload': <String, dynamic>{
        'playerId': 'ally-2',
        'oldPlayerId': 'ally-1',
        'playerName': 'Ally',
        'role': 'AGENT',
        'status': 'active',
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.players.where((p) => p.id == 'ally-1'), isEmpty);
    final ally = controller.players.firstWhere((p) => p.id == 'ally-2');
    expect(ally.latitude, 45.7645);
    expect(ally.longitude, 4.8362);
    expect(
      controller.mapMarkerPlayers.map((p) => p.id),
      contains('ally-2'),
    );

    controller.dispose();
  });

  test('uses the server rally point and global chat after game end', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());

    socket.emit(<String, dynamic>{
      'type': 'state:sync',
      'payload': <String, dynamic>{
        'gameDetails': <String, dynamic>{
          'winner_type': 'AGENT',
          'winner_reason': 'TIMEOUT',
          'rally_point': <String, dynamic>{
            'latitude': 45.7642,
            'longitude': 4.8358,
          },
        },
      },
    });
    socket.emit(<String, dynamic>{
      'type': 'game:chat-global-message',
      'payload': <String, dynamic>{
        'playerId': 'rogue-1',
        'playerName': 'Rogue',
        'text': 'On se retrouve au point.',
        'timestamp': 42,
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.rallyPoint?.latitude, 45.7642);
    expect(controller.rallyPoint?.longitude, 4.8358);
    expect(controller.visibleChat.single.text, 'On se retrouve au point.');

    controller.sendChat(' J’arrive ');
    expect(socket.sentGlobalChat, 'J’arrive');
    expect(socket.sentRoleChat, isNull);

    controller.dispose();
  });

  test('restores final state and global chat when rejoining', () async {
    final socket = _NoopGameSocketService();
    final controller = GameController(socketService: socket);
    await controller.initialize(_minimalGameBootstrap());

    socket.emit(<String, dynamic>{
      'type': 'game:joined',
      'payload': <String, dynamic>{
        'code': 'ABC123',
        'playerId': 'host-1',
        'hostId': 'host-1',
        'game': <String, dynamic>{
          'winnerType': 'ROGUE',
          'winnerReason': 'OBJECTIVES_CAPTURED',
          'rallyPoint': <String, dynamic>{
            'latitude': 45.7642,
            'longitude': 4.8358,
          },
          'players': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'host-1',
              'name': 'Host',
              'isHost': true,
              'role': 'AGENT',
              'status': 'active',
            },
          ],
          'globalChatMessages': <Map<String, dynamic>>[
            <String, dynamic>{
              'playerId': 'rogue-1',
              'playerName': 'Rogue',
              'text': 'Ralliement',
              'timestamp': 42,
            },
          ],
        },
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(controller.isGameFinished, isTrue);
    expect(controller.winnerReason, 'OBJECTIVES_CAPTURED');
    expect(controller.visibleChat.single.text, 'Ralliement');
    expect(controller.rallyPoint?.latitude, 45.7642);

    controller.dispose();
  });
}

GameBootstrapData _minimalGameBootstrap() {
  return GameBootstrapData(
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
      agentRange: 80,
      rogueRange: 80,
      startZone: null,
      rogueStartZone: null,
      objectives: <GeoPoint>[
        GeoPoint(latitude: 45.764043, longitude: 4.835659),
      ],
      mapStreets: <GeoPoint>[],
    ),
    codeOverride: 'ABC123',
    fromCodeLookupFallback: false,
  );
}
