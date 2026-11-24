import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ChatGameController extends GameController {
  int leaveCalls = 0;

  @override
  void leaveGame() => leaveCalls++;

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
      ..rallyPoint = const GeoPoint(latitude: 45.764043, longitude: 4.835659)
      ..globalChat.add(_message(99));
  }
  final router = GoRouter(
    initialLocation: '/game',
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const Scaffold(body: Text('Accueil test')),
      ),
      GoRoute(
        path: '/game',
        builder: (_, _) => TickerMode(
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
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
  await tester.pumpAndSettle();
  return controller;
}

Future<void> _openChat(WidgetTester tester, {bool finished = false}) async {
  await tester.tap(
    find.byTooltip(finished ? 'Chat de fin de partie' : 'Chat équipe'),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const compassChannel = MethodChannel('hemanthraj/flutter_compass');

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(compassChannel, (_) async => null);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(compassChannel, null);
  });

  testWidgets('Shows a selected player name and bearings relative to the map', (
    tester,
  ) async {
    final controller = await _pumpGame(tester);
    controller
      ..myPosition = const GeoPoint(latitude: 45.764, longitude: 4.835)
      ..playerRole = 'AGENT'
      ..players.addAll(const [
        GamePlayer(
          id: 'player-1',
          name: 'Camille',
          isHost: true,
          role: 'AGENT',
          latitude: 45.764,
          longitude: 4.835,
        ),
        GamePlayer(
          id: 'ally',
          name: 'Nora',
          isHost: false,
          role: 'AGENT',
          latitude: 45.764,
          longitude: 4.838,
          headingDegrees: 90,
        ),
        GamePlayer(
          id: 'opponent',
          name: 'Malo',
          isHost: false,
          role: 'ROGUE',
          latitude: 45.764,
          longitude: 4.841,
          headingDegrees: 270,
        ),
      ]);
    controller.notifyListeners();
    await tester.pumpAndSettle();

    final ownArrow = find.byKey(const ValueKey('player-heading-player-1'));
    final allyArrow = find.byKey(const ValueKey('player-heading-ally'));
    expect(ownArrow, findsNothing);
    expect(allyArrow, findsOneWidget);
    expect(find.byKey(const ValueKey('player-marker-opponent')), findsNothing);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      compassChannel.name,
      const StandardMethodCodec().encodeSuccessEnvelope([0.0, 0.0, 10.0]),
      null,
    );
    await tester.pump();
    expect(tester.widget<Transform>(ownArrow).transform.entry(0, 0), 1);
    expect(tester.widget<Transform>(allyArrow).transform.entry(1, 0), 1);

    await tester.tap(find.byKey(const ValueKey('player-marker-ally')));
    await tester.pump();
    expect(find.text('Nora'), findsOneWidget);
    expect(find.text('Camille'), findsNothing);

    final map = find.byType(LobbyMapPreview);
    final mapController = tester.widget<LobbyMapPreview>(map).mapController!;
    mapController.rotate(-90);
    await tester.pump();
    expect(tester.widget<Transform>(allyArrow).transform.entry(0, 0), 1);
    expect(tester.widget<Transform>(ownArrow).transform.entry(1, 0), -1);
    expect(find.text('Nora'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('player-marker-player-1')));
    await tester.pump();
    expect(find.text('Camille'), findsOneWidget);
    expect(find.text('Nora'), findsNothing);

    await tester.tapAt(tester.getCenter(map) + const Offset(135, 60));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Camille'), findsNothing);
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
        expect(
          find.text('Joueur: Message $index').hitTestable(),
          findsOneWidget,
        );
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

    expect(find.text('Point de rendez-vous'), findsOneWidget);
    expect(find.byTooltip('Centrer sur le rendez-vous'), findsOneWidget);

    await _openChat(tester, finished: true);

    expect(find.text('Chat de fin de partie'), findsOneWidget);
    expect(find.text('Joueur: Message 99'), findsOneWidget);
  });

  testWidgets('Leaves the finished game only after confirmation', (
    tester,
  ) async {
    final controller = await _pumpGame(tester, finished: true);
    final exit = find.widgetWithText(TextButton, 'Quitter la partie');

    await tester.tap(exit);
    await tester.pumpAndSettle();
    expect(find.text('Quitter la partie ?'), findsOneWidget);
    await tester.tap(find.text('Annuler'));
    await tester.pumpAndSettle();
    expect(controller.leaveCalls, 0);
    expect(find.text('Point de rendez-vous'), findsOneWidget);

    await tester.tap(exit);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Quitter'));
    await tester.pumpAndSettle();
    expect(controller.leaveCalls, 1);
    expect(find.text('Accueil test'), findsOneWidget);
  });

  testWidgets('Floating actions use the selected role and their own icons', (
    tester,
  ) async {
    final controller = await _pumpGame(tester);
    controller.playerRole = 'AGENT';
    controller.notifyListeners();
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.forum_outlined), findsOneWidget);
    expect(find.byIcon(Icons.headset_mic_outlined), findsOneWidget);
    await tester.tap(find.byTooltip('Ouvrir les actions'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Fermer les actions'), findsOneWidget);
    expect(find.byIcon(Icons.qr_code_2), findsOneWidget);
    expect(find.byIcon(Icons.my_location), findsOneWidget);
    expect(find.byIcon(Icons.center_focus_strong), findsOneWidget);

    controller.playerRole = 'ROGUE';
    controller.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.byTooltip('Pirater un objectif'), findsOneWidget);
    expect(find.byIcon(Icons.terminal), findsOneWidget);
  });
}
