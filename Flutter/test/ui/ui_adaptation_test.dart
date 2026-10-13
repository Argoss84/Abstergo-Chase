import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/auth/presentation/login_page.dart';
import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:broken_veil_protocol/features/create_lobby/application/create_lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_map.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/application/lobby_controller.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_player_row.dart';
import 'package:broken_veil_protocol/features/settings/presentation/vibration_settings_page.dart';
import 'package:broken_veil_protocol/shared/theme/app_theme.dart';
import 'package:broken_veil_protocol/shared/widgets/app_chat_sheet.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:go_router/go_router.dart';

const _savePreviews = bool.fromEnvironment('SAVE_UI_PREVIEWS');
const _position = GeoPoint(latitude: 45.764, longitude: 4.835);
const _startZone = GeoPoint(latitude: 45.765, longitude: 4.835);
final _previewKey = GlobalKey();

class _Auth extends CognitoAuthController {
  _Auth() {
    username = 'Echo-07';
    isInitializing = false;
  }
  @override
  Future<String?> getAccessToken() async => null;
  @override
  Future<String?> getCurrentUserSub() async => 'test-user';
}

class _Permissions implements BootstrapPermissionsService {
  @override
  Future<BootstrapPermissionsResult> ensureRequiredPermissions({
    bool forceRequest = false,
  }) async =>
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.granted);
  @override
  Future<void> openAppSettings() async {}
  @override
  Future<void> openLocationSettings() async {}
}

class _CreateController extends CreateLobbyController {
  int submissions = 0;
  final completion = Completer<void>();

  @override
  Future<void> loadCurrentPosition() async {
    currentPosition = _position;
    streets = [
      [_position, _startZone],
    ];
  }

  @override
  void handleMapTap(GeoPoint point) {
    selectedPosition = point;
    form = form.copyWith(
      mapCenterLatitude: point.latitude.toString(),
      mapCenterLongitude: point.longitude.toString(),
    );
    notifyListeners();
  }

  @override
  Future<void> fetchStreets() async {
    streets = [
      [_position, _startZone],
    ];
    notifyListeners();
  }

  @override
  void generateObjectives() {
    objectives = List.generate(form.objectiveNumber, (_) => _position);
    agentStartZone = _startZone;
    rogueStartZone = _position;
    objectivesGenerated = true;
    notifyListeners();
  }

  @override
  Future<void> createLobby() async {
    submissions++;
    isSubmitting = true;
    notifyListeners();
    await completion.future;
    createdLobbyCode = 'ABC123';
    isSubmitting = false;
    notifyListeners();
  }
}

class _GameController extends GameController {
  int zoneReads = 0;
  @override
  bool get isOutOfGameZone {
    zoneReads++;
    return false;
  }

  @override
  Future<void> initialize(GameBootstrapData data) async {
    bootstrap = data;
    isLoading = false;
    connectionStatus = 'connected';
    hasRealtimePosition = true;
    playerRole = 'AGENT';
    myPosition = _position;
    playerId = 'agent-1';
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget page, {
  bool dark = false,
  double textScale = 1,
  bool reduceMotion = true,
  bool withRouter = false,
  Size size = const Size(390, 844),
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  final auth = _Auth();
  GoRouter? router;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    router?.dispose();
    auth.dispose();
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
    tester.view.resetViewInsets();
  });
  Widget mediaBuilder(BuildContext context, Widget? child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(
      textScaler: TextScaler.linear(textScale),
      disableAnimations: reduceMotion,
    ),
    child: child!,
  );
  if (withRouter) {
    router = GoRouter(
      initialLocation: CreateLobbyPage.routePath,
      routes: [
        GoRoute(path: CreateLobbyPage.routePath, builder: (_, _) => page),
        GoRoute(
          path: '/lobby',
          builder: (_, state) {
            final data = state.extra! as LobbyBootstrapData;
            return Scaffold(
              body: Text(
                'Lobby créé : ${data.code} · ${data.objectives.length} objectifs',
              ),
            );
          },
        ),
      ],
    );
  }
  await tester.pumpWidget(
    RepaintBoundary(
      key: _previewKey,
      child: ProviderScope(
        overrides: [authControllerProvider.overrideWithValue(auth)],
        child: withRouter
            ? MaterialApp.router(
                debugShowCheckedModeBanner: false,
                theme: dark ? AppTheme.dark() : AppTheme.light(),
                builder: mediaBuilder,
                routerConfig: router,
              )
            : MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: dark ? AppTheme.dark() : AppTheme.light(),
                builder: mediaBuilder,
                home: page,
              ),
      ),
    ),
  );
  await tester.pump();
  if (reduceMotion) await tester.pumpAndSettle();
}

Future<void> _capture(WidgetTester tester, String name) async {
  if (!_savePreviews) return;
  await tester.runAsync(() async {
    await Future.wait([
      for (final element in find.byType(Image).evaluate())
        if ((element.widget as Image).image is AssetImage)
          precacheImage((element.widget as Image).image, element),
    ]);
  });
  await tester.pump();
  await tester.runAsync(() async {
    final boundary =
        _previewKey.currentContext!.findRenderObject()!
            as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('docs/ui/previews/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void _ignoreMapTap(GeoPoint point) {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final cache = BuiltInMapCachingProvider.getOrCreateInstance(
      cacheDirectory: Directory('build/ui-test-tiles').absolute.path,
      maxCacheSize: null,
      readOnly: true,
    );
    await cache.getTile('https://tile.openstreetmap.org/0/0/0.png');
    {
      final configFile = File('.dart_tool/package_config.json').absolute;
      final config =
          jsonDecode(await configFile.readAsString()) as Map<String, dynamic>;
      final flutter = (config['packages'] as List)
          .cast<Map<String, dynamic>>()
          .firstWhere((p) => p['name'] == 'flutter');
      final rootUri = flutter['rootUri'] as String;
      final root = configFile.uri.resolve(
        rootUri.endsWith('/') ? rootUri : '$rootUri/',
      );
      for (final (family, filename) in [
        ('Roboto', 'roboto-regular.ttf'),
        ('MaterialIcons', 'materialicons-regular.otf'),
      ]) {
        final bytes = await File.fromUri(
          root.resolve('../../bin/cache/artifacts/material_fonts/$filename'),
        ).readAsBytes();
        await (FontLoader(
          family,
        )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
      }
    }
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({'tts.enabled': false});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('hemanthraj/flutter_compass'),
          (_) async => null,
        );
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('hemanthraj/flutter_compass'),
          null,
        );
  });

  for (final dark in [false, true]) {
    final theme = dark ? 'dark' : 'light';
    testWidgets('Home portrait in $theme theme', (tester) async {
      await _pump(
        tester,
        BootstrapPage(permissionsService: _Permissions()),
        dark: dark,
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, 'home-$theme');
    });
    testWidgets('Home fits a small screen with enlarged text ($theme)', (
      tester,
    ) async {
      await _pump(
        tester,
        BootstrapPage(permissionsService: _Permissions()),
        dark: dark,
        size: const Size(320, 640),
        textScale: 1.5,
      );
      expect(find.text('Créer une partie'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'home-small-$theme');
    });

    testWidgets(
      'Guided creation preserves configuration and blocks duplicate submissions ($theme)',
      (tester) async {
        final controller = _CreateController();
        await _pump(
          tester,
          CreateLobbyPage(controllerFactory: () => controller),
          dark: dark,
          withRouter: true,
        );
        await _capture(tester, 'create-settings-$theme');
        await tester.ensureVisible(find.text('Modifier les paramètres'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Modifier les paramètres'));
        await tester.pumpAndSettle();
        await _capture(tester, 'create-details-$theme');
        await tester.tap(find.byTooltip('Fermer les paramètres'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Continuer'));
        await tester.pumpAndSettle();
        expect(find.text('Préparez le terrain'), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continuer'),
              )
              .onPressed,
          isNull,
        );
        await tester.tap(find.byType(FlutterMap));
        // flutter_map waits for the double-tap window before confirming a tap.
        await tester.pump(const Duration(milliseconds: 350));
        await tester.pumpAndSettle();
        expect(controller.selectedPosition, isNotNull);
        await tester.ensureVisible(find.text('Générer les objectifs'));
        await tester.tap(find.text('Générer les objectifs'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Continuer'));
        await tester.pumpAndSettle();
        expect(find.text('Tout est prêt ?'), findsOneWidget);
        await _capture(tester, 'create-review-$theme');
        final objectives = controller.objectives;
        if (dark) {
          await tester.tap(find.byTooltip('Étape précédente'));
        } else {
          await tester.binding.handlePopRoute();
        }
        await tester.pumpAndSettle();
        expect(controller.objectives, same(objectives));
        await tester.tap(find.text('Continuer'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Créer la partie'));
        await tester.pump();
        expect(controller.submissions, 1);
        expect(
          tester
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Connexion au serveur…'),
              )
              .onPressed,
          isNull,
        );
        controller.completion.complete();
        await tester.pumpAndSettle();
        expect(find.text('Lobby créé : ABC123 · 3 objectifs'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'Party rules stay aligned and controls remain reachable ($theme)',
      (tester) async {
        await _pump(
          tester,
          CreateLobbyPage(controllerFactory: _CreateController.new),
          dark: dark,
          withRouter: true,
          size: const Size(320, 640),
          textScale: 1.5,
        );
        final stepY = tester.getTopLeft(find.text('Réglages')).dy;
        expect(tester.getTopLeft(find.text('Terrain')).dy, closeTo(stepY, 1));
        expect(
          tester.getTopLeft(find.text('Validation')).dy,
          closeTo(stepY, 1),
        );
        final labels = [
          'Durée',
          'Objectifs',
          'Rayon du terrain',
          'Durée du hack',
        ];
        final labelX = tester.getTopLeft(find.text(labels.first)).dx;
        for (final label in labels) {
          expect(tester.getTopLeft(find.text(label)).dx, closeTo(labelX, 1));
        }
        await _capture(tester, 'create-settings-small-$theme');
        await tester.ensureVisible(find.text('Modifier les paramètres'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Modifier les paramètres'));
        await tester.pumpAndSettle();
        await _capture(tester, 'create-details-small-$theme');
        await tester.ensureVisible(find.text('Rôles et capture'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Rôles et capture'));
        await tester.pumpAndSettle();
        final hack = find.widgetWithText(TextFormField, 'Durée du hack');
        await tester.ensureVisible(hack);
        await tester.pumpAndSettle();
        await tester.enterText(hack, '1,25');
        tester.view.viewInsets = const FakeViewPadding(bottom: 250);
        await tester.pumpAndSettle();
        expect(find.text('Appliquer').hitTestable(), findsOneWidget);
        expect(tester.getBottomRight(find.text('Appliquer')).dy, lessThan(390));
        await _capture(tester, 'create-details-keyboard-$theme');
        await tester.tap(find.text('Appliquer'));
        tester.view.viewInsets = const FakeViewPadding();
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('1,25 s'));
        expect(find.text('1,25 s'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('Login supports keyboard and password visibility ($theme)', (
      tester,
    ) async {
      await _pump(
        tester,
        const LoginPage(),
        dark: dark,
        size: const Size(320, 640),
        textScale: 1.4,
      );
      await _capture(tester, 'login-small-$theme');
      await tester.enterText(find.byType(TextField).last, 'test-password');
      await tester.tap(find.byTooltip('Afficher le mot de passe'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).last).obscureText,
        isFalse,
      );
      tester.view.viewInsets = const FakeViewPadding(bottom: 260);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Se connecter'));
      expect(find.text('Se connecter').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Join and settings render in $theme theme', (tester) async {
      await _pump(
        tester,
        const JoinLobbyPage(initialCode: 'ABC123'),
        dark: dark,
      );
      await _capture(tester, 'join-$theme');
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Rejoindre la partie'),
            )
            .onPressed,
        isNotNull,
      );
      await _pump(
        tester,
        const SettingsPage(),
        dark: dark,
        size: const Size(320, 640),
        textScale: 1.5,
      );
      expect(find.text('Serveur de jeu'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'settings-small-$theme');
      await tester.ensureVisible(find.text('Vocal'));
      await tester.tap(find.text('Vocal'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byType(SegmentedButton<VoiceTransmissionMode>),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, 'settings-vocal-$theme');
    });

    testWidgets(
      'Lobby player identities and roles share aligned columns ($theme)',
      (tester) async {
        await _pump(
          tester,
          const LobbyPage(),
          dark: dark,
          size: const Size(411, 891),
        );
        final controller =
            tester
                    .widget<AnimatedBuilder>(
                      find.byWidgetPredicate(
                        (widget) =>
                            widget is AnimatedBuilder &&
                            widget.animation is LobbyController,
                      ),
                    )
                    .animation
                as LobbyController;
        controller
          ..error = null
          ..lobbyCode = 'ABC123'
          ..connectionStatus = 'connected'
          ..playerId = 'host-1'
          ..isHost = true;
        controller.players.addAll(const [
          LobbyPlayer(
            id: 'guest-1',
            name: 'adrien',
            isHost: false,
            role: 'AGENT',
          ),
          LobbyPlayer(id: 'host-1', name: 'momo', isHost: true, role: 'ROGUE'),
          LobbyPlayer(id: 'guest-2', name: 'Echo-07', isHost: false),
        ]);
        controller.notifyListeners();
        await tester.pumpAndSettle();
        final rows = find.byType(LobbyPlayerRow);
        await tester.ensureVisible(
          find.ancestor(of: rows.first, matching: find.byType(Card)).first,
        );
        await tester.pumpAndSettle();
        final nameX = tester.getTopLeft(find.text('adrien')).dx;
        final controls = find.byType(DropdownButton<String>);
        expect(controls, findsNWidgets(3));
        final controlX = tester.getTopLeft(controls.first).dx;
        final rowHeight = tester.getSize(rows.first).height;
        for (var i = 0; i < 3; i++) {
          final player = controller.players[i];
          expect(
            tester.getTopLeft(find.text(player.name)).dx,
            closeTo(nameX, 1),
          );
          expect(tester.getTopLeft(controls.at(i)).dx, closeTo(controlX, 1));
          expect(tester.getSize(rows.at(i)).height, closeTo(rowHeight, 1));
          expect(
            tester.getCenter(controls.at(i)).dy,
            closeTo(tester.getCenter(rows.at(i)).dy, 1),
          );
        }
        expect(find.text('Organisateur · Vous'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await _capture(tester, 'lobby-players-$theme');
        controller.isHost = false;
        controller.notifyListeners();
        await tester.pumpAndSettle();
        expect(find.byType(DropdownButton<String>), findsNothing);
        expect(find.text('Agent'), findsOneWidget);
        expect(find.text('Rogue'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await _capture(tester, 'lobby-players-guest-$theme');
      },
    );

    testWidgets(
      'Lobby prerequisites show missing conditions and readiness ($theme)',
      (tester) async {
        await _pump(
          tester,
          const LobbyPage(),
          dark: dark,
          size: const Size(411, 891),
        );
        final controller =
            tester
                    .widget<AnimatedBuilder>(
                      find.byWidgetPredicate(
                        (widget) =>
                            widget is AnimatedBuilder &&
                            widget.animation is LobbyController,
                      ),
                    )
                    .animation
                as LobbyController;
        controller
          ..error = null
          ..lobbyCode = 'ABC123'
          ..connectionStatus = 'connected'
          ..playerId = 'host-1'
          ..isHost = true;
        controller.players.addAll(const [
          LobbyPlayer(id: 'host-1', name: 'momo', isHost: true, role: 'AGENT'),
          LobbyPlayer(id: 'guest-1', name: 'adrien', isHost: false),
        ]);
        controller.notifyListeners();
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Prérequis pour démarrer'),
          250,
          scrollable: find
              .descendant(
                of: find.byType(ListView),
                matching: find.byType(Scrollable),
              )
              .first,
        );
        await tester.ensureVisible(
          find
              .ancestor(
                of: find.text('Prérequis pour démarrer'),
                matching: find.byType(Card),
              )
              .first,
        );
        await tester.pumpAndSettle();
        expect(find.text('1 / 3'), findsOneWidget);
        expect(find.text('1 sur 2 joueurs'), findsOneWidget);
        final start = find.widgetWithText(FilledButton, 'Démarrer la partie');
        expect(tester.widget<FilledButton>(start).onPressed, isNull);
        expect(tester.takeException(), isNull);
        await _capture(tester, 'lobby-start-pending-$theme');
        controller.players[1] = controller.players[1].copyWith(role: 'ROGUE');
        controller.notifyListeners();
        await tester.pumpAndSettle();
        expect(find.text('3 / 3'), findsOneWidget);
        expect(find.text('Tout est prêt pour jouer'), findsOneWidget);
        expect(tester.widget<FilledButton>(start).onPressed, isNotNull);
        await _capture(tester, 'lobby-start-ready-$theme');
        controller.players[1] = controller.players[1].copyWith(role: 'AGENT');
        controller.notifyListeners();
        await tester.pumpAndSettle();
        expect(find.text('2 / 3'), findsOneWidget);
        expect(tester.widget<FilledButton>(start).onPressed, isNull);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('Lobby code and host actions fit a small screen ($theme)', (
      tester,
    ) async {
      await _pump(
        tester,
        const LobbyPage(),
        dark: dark,
        size: const Size(320, 640),
        textScale: 1.5,
      );
      final builder = tester.widget<AnimatedBuilder>(
        find.byWidgetPredicate(
          (widget) =>
              widget is AnimatedBuilder && widget.animation is LobbyController,
        ),
      );
      final controller = builder.animation as LobbyController;
      controller
        ..error = null
        ..lobbyCode = 'ABC123'
        ..connectionStatus = 'connected'
        ..playerId = 'host-1'
        ..isHost = true;
      controller.players.addAll(const [
        LobbyPlayer(id: 'host-1', name: 'Echo-07', isHost: true, role: 'AGENT'),
        LobbyPlayer(
          id: 'guest-1',
          name: 'Un nom de joueur très long',
          isHost: false,
          role: 'ROGUE',
        ),
      ]);
      controller.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.text('ABC123').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'lobby-small-$theme');
      final rows = find.byType(LobbyPlayerRow);
      await tester.ensureVisible(
        find.ancestor(of: rows.first, matching: find.byType(Card)).first,
      );
      await tester.pumpAndSettle();
      final controls = find.byType(DropdownButton<String>);
      expect(controls, findsNWidgets(2));
      for (var i = 0; i < 2; i++) {
        final name = find.text(controller.players[i].name);
        expect(
          tester.getTopLeft(controls.at(i)).dx,
          closeTo(tester.getTopLeft(name).dx, 1),
        );
        expect(
          tester.getTopLeft(controls.at(i)).dy,
          greaterThan(tester.getBottomRight(name).dy),
        );
      }
      await _capture(tester, 'lobby-players-small-$theme');
      await tester.scrollUntilVisible(
        find.text('Démarrer la partie'),
        250,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.pumpAndSettle();
      expect(find.text('Démarrer la partie').hitTestable(), findsOneWidget);
      await _capture(tester, 'lobby-host-small-$theme');
      expect(tester.takeException(), isNull);
    });

    testWidgets('End of game remains scrollable with enlarged text ($theme)', (
      tester,
    ) async {
      final controller = _GameController();
      await _pump(
        tester,
        GamePage(
          controllerFactory: () => controller,
          bootstrap: const GameBootstrapData(
            lobby: LobbyBootstrapData(
              code: 'ABC123',
              serverUrl: 'http://localhost:3000',
              socketPath: '/socket.io',
              playerName: 'Echo-07',
            ),
            playerId: 'agent-1',
            players: [],
          ),
        ),
        dark: dark,
        size: const Size(320, 480),
        textScale: 1.5,
      );
      controller
        ..winnerType = 'AGENT'
        ..winnerReason = 'TIMEOUT';
      controller.notifyListeners();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Quitter'));
      expect(
        find.widgetWithText(FilledButton, 'Quitter').hitTestable(),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, 'game-finished-small-$theme');
    });

    testWidgets('Account form fits an enlarged small screen ($theme)', (
      tester,
    ) async {
      await _pump(
        tester,
        const AccountPage(),
        dark: dark,
        size: const Size(320, 640),
        textScale: 1.5,
      );
      await tester.scrollUntilVisible(
        find.text('Sauvegarder'),
        250,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.text('Sauvegarder').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'account-small-$theme');
    });
  }

  testWidgets('Creation map draws the configured objective radius', (
    tester,
  ) async {
    await _pump(
      tester,
      const Scaffold(
        body: CreateLobbyMap(
          currentPosition: _position,
          selectedPosition: null,
          mapRadiusMeters: 200,
          startZoneRadiusMeters: 25,
          objectiveZoneRadiusMeters: 80,
          streets: [],
          outerStreetContour: [],
          objectives: [_position],
          agentStartZone: null,
          rogueStartZone: null,
          onTap: _ignoreMapTap,
        ),
      ),
    );
    final circles = tester
        .widget<CircleLayer>(find.byType(CircleLayer))
        .circles;
    expect(circles, hasLength(1));
    expect(circles.single.radius, 80);
    expect(circles.single.useRadiusInMeter, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Changing the terrain radius resets placement before review', (
    tester,
  ) async {
    final controller = _CreateController();
    await _pump(
      tester,
      CreateLobbyPage(controllerFactory: () => controller),
      withRouter: true,
    );
    controller.handleMapTap(_position);
    controller.generateObjectives();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Modifier les paramètres'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Modifier les paramètres'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Terrain et distances'));
    await tester.tap(find.text('Terrain et distances'));
    await tester.pumpAndSettle();
    final radius = find.widgetWithText(TextFormField, 'Rayon du terrain');
    await tester.ensureVisible(radius);
    await tester.enterText(radius, '300');
    await tester.ensureVisible(find.text('Appliquer'));
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(controller.form.mapRadius, 300);
    expect(controller.objectives, isEmpty);
    expect(controller.canCreateLobby, isFalse);
    expect(controller.selectedPosition, _position);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Chat constructs long histories lazily and stays above the keyboard',
    (tester) async {
      final updates = ValueNotifier<int>(0);
      final controller = TextEditingController();
      final sent = <String>[];
      var built = 0;
      addTearDown(updates.dispose);
      addTearDown(controller.dispose);
      await _pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  useSafeArea: true,
                  builder: (_) => AppChatSheet(
                    title: 'Chat équipe',
                    animation: updates,
                    controller: controller,
                    messageCount: () => 600,
                    messageAt: (index) {
                      built++;
                      return AppChatEntry(
                        author: 'Echo-07',
                        text: 'Message $index',
                        isSelf: true,
                      );
                    },
                    onSend: sent.add,
                  ),
                ),
                child: const Text('Ouvrir le chat'),
              ),
            ),
          ),
        ),
        dark: true,
        size: const Size(320, 640),
        textScale: 1.4,
      );
      await tester.tap(find.text('Ouvrir le chat'));
      await tester.pumpAndSettle();
      expect(find.text('Message 599').hitTestable(), findsOneWidget);
      expect(built, lessThan(60));
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      await tester.pumpAndSettle();
      expect(tester.getBottomRight(find.text('Envoyer')).dy, lessThan(360));
      await tester.enterText(find.byType(TextField), '   Bonjour   ');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();
      expect(sent, ['Bonjour']);
      expect(controller.text, isEmpty);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'chat-keyboard-dark');
    },
  );

  testWidgets(
    'Map effects animate without reevaluating the whole game screen',
    (tester) async {
      final controller = _GameController();
      await _pump(
        tester,
        GamePage(
          controllerFactory: () => controller,
          bootstrap: const GameBootstrapData(
            lobby: LobbyBootstrapData(
              code: 'ABC123',
              serverUrl: 'http://localhost:3000',
              socketPath: '/socket.io',
              playerName: 'Echo-07',
              agentStartZone: _startZone,
            ),
            playerId: 'agent-1',
            players: [],
          ),
        ),
        dark: true,
        reduceMotion: false,
      );
      await tester.pump(const Duration(milliseconds: 100));
      final reads = controller.zoneReads;
      final path = find.byType(PolylineLayer);
      expect(path, findsOneWidget);
      final width = tester
          .widget<PolylineLayer>(path)
          .polylines
          .first
          .strokeWidth;
      await tester.pump(const Duration(milliseconds: 500));
      expect(
        tester.widget<PolylineLayer>(path).polylines.first.strokeWidth,
        isNot(width),
      );
      expect(controller.zoneReads, reads);
      expect(tester.takeException(), isNull);
      await _capture(tester, 'game-dark');
    },
  );
}
