import 'dart:convert';
import 'dart:io';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeGameController extends GameController {
  final List<String> sentMessages = <String>[];

  @override
  Future<void> initialize(GameBootstrapData data) async {
    bootstrap = data;
    isLoading = false;
    connectionStatus = 'connected';
    hasRealtimePosition = true;
    myPosition = data.initialPlayerPosition;
    gameStarted = true;
    playerRole = 'AGENT';
  }

  @override
  void sendRoleChat(String text) => sentMessages.add(text);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final wheel = find.byKey(const ValueKey('ping-wheel'));
  const holdDelay = Duration(milliseconds: 600);
  const firstPosition = Offset(300, 300);
  const secondPosition = Offset(420, 300);
  const mapCenter = GeoPoint(latitude: 45.764043, longitude: 4.835659);
  late Directory tileCacheDirectory;
  late BuiltInMapCachingProvider tileCache;

  setUpAll(() async {
    tileCacheDirectory = await Directory.systemTemp.createTemp('ping_test_');
    tileCache = BuiltInMapCachingProvider.getOrCreateInstance(
      cacheDirectory: tileCacheDirectory.path,
      maxCacheSize: null,
      readOnly: true,
    );
    await tileCache.getTile('https://tile.openstreetmap.org/0/0/0.png');
  });

  tearDownAll(() async {
    await tileCache.destroy();
    await tileCacheDirectory.delete(recursive: true);
  });

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'tts.enabled': false,
    });
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

  Future<_FakeGameController> pumpGame(WidgetTester tester) async {
    final controller = _FakeGameController();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    });
    await tester.pumpWidget(
      MaterialApp(
        home: GamePage(
          controller: controller,
          bootstrap: const GameBootstrapData(
            lobby: LobbyBootstrapData(
              code: 'ABC123',
              serverUrl: 'http://localhost:3000',
              socketPath: '/socket.io',
              playerName: 'Agent',
              agentStartZone: mapCenter,
            ),
            playerId: 'agent-1',
            players: <LobbyPlayer>[],
            initialPlayerPosition: mapCenter,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(FlutterMap), findsOneWidget);
    return controller;
  }

  testWidgets('A short single-finger press does not open or send a ping', (
    tester,
  ) async {
    final controller = await pumpGame(tester);
    final finger = await tester.startGesture(firstPosition, pointer: 1);
    await tester.pump(const Duration(milliseconds: 200));
    await finger.up();
    await tester.pump(holdDelay);

    expect(wheel, findsNothing);
    expect(controller.sentMessages, isEmpty);
  });

  testWidgets('A single-finger long press still selects and sends a ping', (
    tester,
  ) async {
    final controller = await pumpGame(tester);
    final finger = await tester.startGesture(firstPosition, pointer: 1);
    await tester.pump(const Duration(milliseconds: 499));
    expect(wheel, findsNothing);
    await tester.pump(const Duration(milliseconds: 1));
    expect(wheel, findsOneWidget);

    await finger.moveBy(const Offset(60, 0));
    await finger.up();
    await tester.pump();

    expect(wheel, findsNothing);
    expect(controller.sentMessages, hasLength(1));
    expect(controller.sentMessages.single, startsWith('[PING]'));
    final payload = jsonDecode(
      controller.sentMessages.single.substring('[PING]'.length),
    ) as Map<String, dynamic>;
    expect(payload['id'], 'go_here');
  });

  testWidgets('Holding two fingers on the map never opens the wheel', (
    tester,
  ) async {
    final controller = await pumpGame(tester);
    final first = await tester.startGesture(firstPosition, pointer: 1);
    final second = await tester.startGesture(secondPosition, pointer: 2);
    await tester.pump(holdDelay);

    expect(wheel, findsNothing);
    await first.up();
    await second.up();
    await tester.pump();
    expect(controller.sentMessages, isEmpty);
  });

  testWidgets('Pinch zoom changes the map zoom without opening the wheel', (
    tester,
  ) async {
    final controller = await pumpGame(tester);
    final mapController = tester
        .widget<FlutterMap>(find.byType(FlutterMap))
        .mapController!;
    final initialZoom = mapController.camera.zoom;
    final first = await tester.startGesture(firstPosition, pointer: 1);
    final second = await tester.startGesture(secondPosition, pointer: 2);
    await first.moveBy(const Offset(-60, 0));
    await second.moveBy(const Offset(60, 0));
    await tester.pump(holdDelay);

    expect(mapController.camera.zoom, greaterThan(initialZoom));
    expect(wheel, findsNothing);
    await second.up();
    await first.up();
    await tester.pump();
    expect(controller.sentMessages, isEmpty);
  });

  for (final releaseFirst in <bool>[false, true]) {
    testWidgets(
      'A second finger cancels the pending press when '
      '${releaseFirst ? 'the first' : 'the second'} finger is lifted first',
      (tester) async {
        final controller = await pumpGame(tester);
        final first = await tester.startGesture(firstPosition, pointer: 1);
        await tester.pump(const Duration(milliseconds: 400));
        final second = await tester.startGesture(secondPosition, pointer: 2);
        await tester.pump(const Duration(milliseconds: 50));
        await (releaseFirst ? first : second).up();
        await tester.pump(holdDelay);
        expect(wheel, findsNothing);

        await (releaseFirst ? second : first).up();
        await tester.pump();
        expect(controller.sentMessages, isEmpty);
      },
    );
  }

  testWidgets('A second finger closes an open wheel without sending a ping', (
    tester,
  ) async {
    final controller = await pumpGame(tester);
    final first = await tester.startGesture(firstPosition, pointer: 1);
    await tester.pump(holdDelay);
    await first.moveBy(const Offset(60, 0));
    await tester.pump();
    expect(wheel, findsOneWidget);

    final second = await tester.startGesture(secondPosition, pointer: 2);
    await tester.pump();
    expect(wheel, findsNothing);
    await tester.pump(holdDelay);
    expect(wheel, findsNothing);
    await first.up();
    await second.up();
    await tester.pump();
    expect(controller.sentMessages, isEmpty);
  });

  for (final cancel in <bool>[false, true]) {
    testWidgets(
      'Tracks all fingers until ${cancel ? 'cancelled' : 'released'} '
      'and allows a fresh single-finger press',
      (tester) async {
        final controller = await pumpGame(tester);
        final first = await tester.startGesture(firstPosition, pointer: 1);
        final second = await tester.startGesture(secondPosition, pointer: 2);
        final third = await tester.startGesture(
          const Offset(500, 300),
          pointer: 3,
        );
        await tester.pump(holdDelay);
        expect(wheel, findsNothing);

        await (cancel ? first.cancel() : first.up());
        await (cancel ? second.cancel() : second.up());
        final fourth = await tester.startGesture(firstPosition, pointer: 4);
        await tester.pump(holdDelay);
        expect(wheel, findsNothing);
        await (cancel ? third.cancel() : third.up());
        await (cancel ? fourth.cancel() : fourth.up());
        await tester.pump();

        final fresh = await tester.startGesture(firstPosition, pointer: 5);
        await tester.pump(holdDelay);
        expect(wheel, findsOneWidget);
        await fresh.cancel();
        await tester.pump();
        expect(wheel, findsNothing);
        expect(controller.sentMessages, isEmpty);
      },
    );
  }
}
