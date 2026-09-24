import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _ChatGameController extends GameController {
  @override
  Future<void> initialize(GameBootstrapData data) async {
    bootstrap = data;
    gameCode = data.lobby.code;
    playerId = data.playerId;
    isLoading = false;
    connectionStatus = 'connected';
    hasRealtimePosition = true;
  }

  void addMessage(int index) {
    roleChat.add(_message(index));
    notifyListeners();
  }
}

GameChatMessage _message(int index) => GameChatMessage(
  playerId: 'player-1',
  playerName: 'Joueur',
  text: 'Message $index',
  timestampMs: index,
);

Future<_ChatGameController> _pumpGame(
  WidgetTester tester, {
  int messageCount = 0,
  bool finished = false,
}) async {
  final controller = _ChatGameController()
    ..roleChat.addAll(List.generate(messageCount, _message));
  if (finished) {
    controller
      ..winnerType = 'AGENT'
      ..winnerReason = 'TIMEOUT'
      ..rallyPoint = const GeoPoint(
        latitude: 45.764043,
        longitude: 4.835659,
      )
      ..globalChat.add(_message(99));
  }
  await tester.pumpWidget(
    MaterialApp(
      home: TickerMode(
        // Disable the map's repeating pulse, but keep modal animations enabled.
        enabled: false,
        child: GamePage(
          bootstrap: const GameBootstrapData(
            lobby: LobbyBootstrapData(
              code: 'ABC123',
              serverUrl: 'http://localhost:3000',
              socketPath: '/socket.io',
              playerName: 'Joueur',
            ),
            playerId: 'player-1',
            players: <LobbyPlayer>[],
          ),
          controllerFactory: () => controller,
        ),
      ),
    ),
  );
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
  await tester.pumpAndSettle();
  return controller;
}

Future<void> _openChat(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.chat_bubble_outline));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const compassChannel = MethodChannel('hemanthraj/flutter_compass');

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(compassChannel, (_) async => null);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(compassChannel, null);
  });

  testWidgets('Opens and reopens team chat at the latest messages', (
    tester,
  ) async {
    await _pumpGame(tester, messageCount: 40);
    await _openChat(tester);

    expect(find.text('Joueur: Message 39').hitTestable(), findsOneWidget);
    expect(find.text('Joueur: Message 0').hitTestable(), findsNothing);
    expect(
      tester.getTopLeft(find.text('Joueur: Message 38')).dy,
      lessThan(tester.getTopLeft(find.text('Joueur: Message 39')).dy),
    );

    await tester.scrollUntilVisible(
      find.text('Joueur: Message 0'),
      200,
      scrollable: find.descendant(
        of: find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(ListView),
        ),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('Joueur: Message 0').hitTestable(), findsOneWidget);
    expect(find.text('Joueur: Message 39').hitTestable(), findsNothing);

    await tester.tap(find.byTooltip('Fermer'));
    await tester.pumpAndSettle();
    expect(find.text('Chat équipe'), findsNothing);

    await _openChat(tester);
    expect(find.text('Joueur: Message 39').hitTestable(), findsOneWidget);
    expect(find.text('Joueur: Message 0').hitTestable(), findsNothing);
  });

  testWidgets('Shows messages received while team chat was closed', (
    tester,
  ) async {
    final controller = await _pumpGame(tester, messageCount: 40);
    await _openChat(tester);
    await tester.tap(find.byTooltip('Fermer'));
    await tester.pumpAndSettle();

    controller.addMessage(40);
    await _openChat(tester);

    expect(find.text('Joueur: Message 40').hitTestable(), findsOneWidget);
    expect(find.text('Joueur: Message 0').hitTestable(), findsNothing);
    expect(
      tester.getTopLeft(find.text('Joueur: Message 39')).dy,
      lessThan(tester.getTopLeft(find.text('Joueur: Message 40')).dy),
    );
  });

  for (final messageCount in <int>[0, 1, 3]) {
    testWidgets('Displays team chat containing $messageCount messages', (
      tester,
    ) async {
      await _pumpGame(tester, messageCount: messageCount);
      await _openChat(tester);

      expect(find.text('Chat équipe'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Envoyer'), findsOneWidget);
      for (var index = 0; index < messageCount; index++) {
        expect(find.text('Joueur: Message $index').hitTestable(), findsOneWidget);
        if (index > 0) {
          expect(
            tester.getTopLeft(find.text('Joueur: Message ${index - 1}')).dy,
            lessThan(tester.getTopLeft(find.text('Joueur: Message $index')).dy),
          );
        }
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('Keeps map chat accessible after game end', (tester) async {
    await _pumpGame(tester, finished: true);

    expect(find.text('Fin de partie'), findsOneWidget);
    expect(
      find.text('Rejoignez le point de ralliement affiché sur la carte.'),
      findsOneWidget,
    );

    await _openChat(tester);

    expect(find.text('Chat de fin de partie'), findsOneWidget);
    expect(find.text('Joueur: Message 99'), findsOneWidget);
  });
}
