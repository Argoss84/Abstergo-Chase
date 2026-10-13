import 'dart:async';

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/shared/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Auth extends CognitoAuthController {
  _Auth() {
    username = 'momo';
    isInitializing = false;
  }

  @override
  Future<String?> getCurrentUserSub() async => 'test-user';
  @override
  Future<String?> getAccessToken() async => null;
}

class _Socket extends LobbySocketService {
  final completion = Completer<SessionDestination>();
  int lookups = 0;
  int disposals = 0;
  String? lookedUpCode;

  @override
  Future<void> connect({
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {}

  @override
  Future<SessionDestination> lookupSession({
    required String code,
    Duration timeout = const Duration(seconds: 12),
  }) {
    lookups++;
    lookedUpCode = code;
    return completion.future;
  }

  @override
  void dispose() => disposals++;
}

class _Routes {
  late GoRouter router;
  int lobbyVisits = 0;
  GameBootstrapData? game;
  LobbyBootstrapData? lobby;
}

Future<_Routes> _pump(
  WidgetTester tester,
  LobbySocketService Function() factory,
) async {
  SharedPreferences.setMockInitialValues({
    'last_player_id_by_code_ABC123': 'existing-player',
  });
  final auth = _Auth();
  final routes = _Routes();
  routes.router = GoRouter(
    initialLocation: JoinLobbyPage.routePath,
    routes: [
      GoRoute(
        path: JoinLobbyPage.routePath,
        builder: (_, _) =>
            JoinLobbyPage(initialCode: 'abc123', sessionSocketFactory: factory),
      ),
      GoRoute(
        path: '/lobby',
        builder: (_, state) {
          routes.lobbyVisits++;
          routes.lobby = state.extra! as LobbyBootstrapData;
          return const Scaffold(body: Text('Lobby sélectionné'));
        },
      ),
      GoRoute(
        path: '/game',
        builder: (_, state) {
          routes.game = state.extra! as GameBootstrapData;
          return const Scaffold(body: Text('Partie reprise'));
        },
      ),
      GoRoute(
        path: '/other',
        builder: (_, _) => const Scaffold(body: Text('Autre page')),
      ),
    ],
  );
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    routes.router.dispose();
    auth.dispose();
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [authControllerProvider.overrideWithValue(auth)],
      child: MaterialApp.router(
        theme: AppTheme.light(),
        routerConfig: routes.router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return routes;
}

Future<void> _join(WidgetTester tester) async {
  await tester.tap(find.text('Rejoindre la partie'));
  await tester.pump();
}

void main() {
  testWidgets('Running game resumes directly without building a lobby', (
    tester,
  ) async {
    final socket = _Socket();
    final routes = await _pump(tester, () => socket);
    await _join(tester);
    expect(find.text('Recherche de la partie…'), findsOneWidget);
    expect(find.byType(JoinLobbyPage), findsOneWidget);
    expect(routes.lobbyVisits, 0);
    expect(socket.lookups, 1);
    expect(socket.lookedUpCode, 'ABC123');
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    socket.completion.complete(SessionDestination.game);
    await tester.pumpAndSettle();
    expect(find.text('Partie reprise'), findsOneWidget);
    expect(routes.lobbyVisits, 0);
    expect(routes.game!.playerId, 'existing-player');
    expect(routes.game!.lobby.previousPlayerId, 'existing-player');
    expect(routes.game!.lobby.cognitoSub, 'test-user');
    expect(routes.game!.lobby.playerName, 'momo');
    expect(routes.game!.codeOverride, 'ABC123');
    expect(socket.disposals, 1);
  });

  testWidgets('Waiting session still opens the lobby with the saved identity', (
    tester,
  ) async {
    final socket = _Socket();
    final routes = await _pump(tester, () => socket);
    await _join(tester);
    socket.completion.complete(SessionDestination.lobby);
    await tester.pumpAndSettle();
    expect(find.text('Lobby sélectionné'), findsOneWidget);
    expect(routes.game, isNull);
    expect(routes.lobby!.previousPlayerId, 'existing-player');
    expect(routes.lobby!.cognitoSub, 'test-user');
    expect(socket.disposals, 1);
  });

  testWidgets('Unknown code stays on JoinLobby with a clear error', (
    tester,
  ) async {
    final socket = _Socket();
    final routes = await _pump(tester, () => socket);
    await _join(tester);
    socket.completion.complete(SessionDestination.notFound);
    await tester.pumpAndSettle();
    expect(find.byType(JoinLobbyPage), findsOneWidget);
    expect(
      find.text(
        'Aucune partie ne correspond à ce code. Vérifiez le code saisi.',
      ),
      findsOneWidget,
    );
    expect(routes.lobbyVisits, 0);
    expect(routes.game, isNull);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
    expect(socket.disposals, 1);
  });

  testWidgets('Timeout releases the connection and permits a fresh retry', (
    tester,
  ) async {
    final sockets = [_Socket(), _Socket()];
    var attempts = 0;
    final routes = await _pump(tester, () => sockets[attempts++]);
    await _join(tester);
    sockets.first.completion.completeError(TimeoutException('test'));
    await tester.pumpAndSettle();
    expect(
      find.text('Le serveur ne répond pas. Réessayez dans un instant.'),
      findsOneWidget,
    );
    expect(sockets.first.disposals, 1);
    expect(routes.lobbyVisits, 0);
    await _join(tester);
    sockets.last.completion.complete(SessionDestination.game);
    await tester.pumpAndSettle();
    expect(find.text('Partie reprise'), findsOneWidget);
    expect(attempts, 2);
    expect(sockets.last.disposals, 1);
  });

  testWidgets(
    'Leaving during lookup cancels navigation and closes the socket',
    (tester) async {
      final socket = _Socket();
      final routes = await _pump(tester, () => socket);
      await _join(tester);
      routes.router.go('/other');
      await tester.pumpAndSettle();
      expect(socket.disposals, 1);
      socket.completion.complete(SessionDestination.game);
      await tester.pumpAndSettle();
      expect(find.text('Autre page'), findsOneWidget);
      expect(routes.game, isNull);
      expect(routes.lobbyVisits, 0);
      expect(socket.disposals, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
