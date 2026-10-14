import 'dart:async';

import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Socket extends GameSocketService {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  Completer<void>? connection;
  Completer<TurnCredentialsResult?>? turn;
  int joins = 0;
  int syncs = 0;
  int turnRequests = 0;

  @override
  bool get isConnected => true;

  @override
  Stream<Map<String, dynamic>> get messages => events.stream;

  @override
  Future<void> connect({
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    await connection?.future;
  }

  @override
  void joinGame({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
  }) {
    joins++;
  }

  @override
  void requestGameSync() {
    syncs++;
  }

  @override
  Future<TurnCredentialsResult?> requestTurnCredentials({
    Duration timeout = const Duration(seconds: 8),
  }) {
    turnRequests++;
    return turn?.future ?? Future.value(null);
  }

  @override
  void dispose() {
    events.close();
    super.dispose();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const geolocator = MethodChannel('flutter.baseflow.com/geolocator');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const data = GameBootstrapData(
    lobby: LobbyBootstrapData(
      code: 'ABC123',
      serverUrl: 'http://localhost:3000',
      socketPath: '/socket.io',
      playerName: 'Agent',
    ),
    playerId: 'self',
    players: [
      LobbyPlayer(id: 'self', name: 'Agent', isHost: false, role: 'AGENT'),
    ],
  );

  setUp(() {
    SharedPreferences.setMockInitialValues({'voice.enabled': false});
    messenger.setMockMethodCallHandler(geolocator, (call) async {
      if (call.method == 'isLocationServiceEnabled') return false;
      if (call.method == 'getLastKnownPosition') return null;
      throw PlatformException(code: 'PositionUnavailable');
    });
  });

  tearDown(() => messenger.setMockMethodCallHandler(geolocator, null));

  test(
    'closing during connection never starts a game subscription or join',
    () async {
      final socket = _Socket()..connection = Completer<void>();
      final controller = GameController(socketService: socket);
      final pending = controller.initialize(data);
      await Future<void>.delayed(Duration.zero);
      controller.dispose();
      socket.connection!.complete();
      await expectLater(pending, completes);
      expect(socket.joins, 0);
      expect(socket.events.hasListener, isFalse);
    },
  );

  test(
    'game loading finishes without waiting for TURN or the microphone',
    () async {
      SharedPreferences.setMockInitialValues({'voice.enabled': true});
      final socket = _Socket()..turn = Completer<TurnCredentialsResult?>();
      final controller = GameController(socketService: socket);
      await controller.initialize(data);
      expect(controller.isLoading, isFalse);
      expect(socket.turnRequests, 1);
      controller.dispose();
      socket.turn!.complete(null);
      await Future<void>.delayed(Duration.zero);
    },
  );

  test('a burst of snapshots shares one pending TURN request', () async {
    SharedPreferences.setMockInitialValues({'voice.enabled': true});
    final socket = _Socket()..turn = Completer<TurnCredentialsResult?>();
    final controller = GameController(socketService: socket);
    await controller.initialize(data);
    for (var i = 0; i < 10; i++) {
      socket.events.add({'type': 'state:sync', 'payload': <String, dynamic>{}});
    }
    await Future<void>.delayed(Duration.zero);
    expect(socket.turnRequests, 1);
    controller.dispose();
    socket.turn!.complete(null);
    await Future<void>.delayed(Duration.zero);
  });

  testWidgets(
    'a joined game continues retrying session binding after disconnection',
    (tester) async {
      final socket = _Socket();
      final controller = GameController(socketService: socket);
      await controller.initialize(data);
      socket.events.add({
        'type': 'game:joined',
        'payload': {'playerId': 'self', 'hostId': 'other', 'code': 'ABC123'},
      });
      await tester.pump();
      expect(controller.connectionStatus, 'connected');
      expect(socket.joins, 1);
      socket.events.add({'type': 'socket:disconnected'});
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      expect(socket.joins, 2);
      controller.dispose();
      await tester.pump();
    },
  );

  test('resume requests fresh game state immediately', () async {
    final socket = _Socket();
    final controller = GameController(socketService: socket);
    addTearDown(controller.dispose);
    await controller.initialize(data);
    socket.events.add({
      'type': 'game:joined',
      'payload': {'playerId': 'self', 'hostId': 'other', 'code': 'ABC123'},
    });
    await Future<void>.delayed(Duration.zero);
    final before = socket.syncs;
    await controller.onAppResumed();
    expect(socket.syncs, before + 1);
  });

  test(
    'resume during a pending rejoin waits for acknowledgement before resync',
    () async {
      final socket = _Socket();
      final controller = GameController(socketService: socket);
      addTearDown(controller.dispose);
      await controller.initialize(data);
      socket.events.add({
        'type': 'game:joined',
        'payload': {'playerId': 'self', 'hostId': 'other', 'code': 'ABC123'},
      });
      await Future<void>.delayed(Duration.zero);
      socket.events.add({'type': 'socket:disconnected'});
      socket.events.add({'type': 'socket:connected'});
      await Future<void>.delayed(Duration.zero);
      expect(socket.joins, 2);
      final before = socket.syncs;
      await controller.onAppResumed();
      expect(socket.syncs, before);
    },
  );

  test(
    'overlapping resumes share a GPS request and are safe after disposal',
    () async {
      final gps = Completer<void>();
      var requests = 0;
      messenger.setMockMethodCallHandler(geolocator, (call) async {
        if (call.method == 'getLastKnownPosition') return null;
        if (call.method == 'getCurrentPosition') {
          requests++;
          await gps.future;
        }
        throw PlatformException(code: 'PositionUnavailable');
      });
      final controller = GameController(socketService: _Socket());
      final resumes = List.generate(3, (_) => controller.onAppResumed());
      await Future<void>.delayed(Duration.zero);
      expect(requests, 1);
      controller.dispose();
      gps.complete();
      await expectLater(Future.wait(resumes), completes);
      expect(controller.myPosition, isNull);
    },
  );
}
