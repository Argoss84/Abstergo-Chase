import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart'
    as game_socket;
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/application/lobby_controller.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart'
    as lobby_socket;
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/shared/services/voice_chat_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _VoiceGameSocketService extends game_socket.GameSocketService {
  @override
  Future<game_socket.TurnCredentialsResult?> requestTurnCredentials({
    Duration timeout = const Duration(seconds: 8),
  }) async => null;
}

class _VoiceLobbySocketService extends lobby_socket.LobbySocketService {
  @override
  bool get isConnected => true;

  @override
  Future<lobby_socket.JoinLobbyResult> joinLobby({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
    bool reconnectAsHost = false,
    Duration timeout = const Duration(seconds: 12),
  }) async => const lobby_socket.JoinLobbyResult(
    code: 'ABC123',
    playerId: 'self-z',
    hostId: 'self-z',
  );

  @override
  Future<lobby_socket.TurnCredentialsResult?> requestTurnCredentials({
    Duration timeout = const Duration(seconds: 8),
  }) async => null;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const channel = MethodChannel('FlutterWebRTC.Method');
  const events = MethodChannel('FlutterWebRTC.Event');
  final calls = <MethodCall>[];
  final peerEvents = <MethodChannel>[];
  final audioEnabledWhenAttached = <bool>[];
  var microphoneEnabled = true;

  Iterable<MethodCall> callsFor(String method) =>
      calls.where((call) => call.method == method);

  void expectConnectionRetained() {
    expect(callsFor('getUserMedia'), hasLength(1));
    expect(callsFor('createPeerConnection'), hasLength(1));
    expect(callsFor('peerConnectionClose'), isEmpty);
    expect(callsFor('trackDispose'), isEmpty);
    expect(callsFor('streamDispose'), isEmpty);
  }

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'voice.enabled': true,
    });
    calls.clear();
    peerEvents.clear();
    audioEnabledWhenAttached.clear();
    microphoneEnabled = true;
    messenger.setMockMethodCallHandler(events, (_) async => null);
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'getUserMedia':
          return <String, dynamic>{
            'streamId': 'local-stream',
            'audioTracks': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'microphone',
                'label': 'Microphone',
                'kind': 'audio',
                'enabled': true,
              },
            ],
            'videoTracks': <dynamic>[],
          };
        case 'createPeerConnection':
          final id = 'pc-${peerEvents.length}';
          final eventChannel = MethodChannel(
            'FlutterWebRTC/peerConnectionEvent$id',
          );
          peerEvents.add(eventChannel);
          messenger.setMockMethodCallHandler(eventChannel, (_) async => null);
          return <String, dynamic>{'peerConnectionId': id};
        case 'addTrack':
          audioEnabledWhenAttached.add(microphoneEnabled);
          return <String, dynamic>{
            'senderId': 'sender',
            'track': <String, dynamic>{},
            'ownsTrack': false,
            'rtpParameters': <String, dynamic>{
              'encodings': <dynamic>[],
              'headerExtensions': <dynamic>[],
              'codecs': <dynamic>[],
              'rtcp': <String, dynamic>{'reducedSize': false},
            },
          };
        case 'mediaStreamTrackSetEnable':
          expect(call.arguments['trackId'], 'microphone');
          microphoneEnabled = call.arguments['enabled'] as bool;
          return null;
        case 'createAnswer':
          return <String, dynamic>{'sdp': 'answer-sdp', 'type': 'answer'};
        default:
          return null;
      }
    });
  });

  tearDown(() async {
    await Future<void>.delayed(Duration.zero);
    messenger.setMockMethodCallHandler(channel, null);
    messenger.setMockMethodCallHandler(events, null);
    for (final eventChannel in peerEvents) {
      messenger.setMockMethodCallHandler(eventChannel, null);
    }
  });

  test('mute and unmute retain peers and continue handling signals', () async {
    final signals = <Map<String, dynamic>>[];
    final service = VoiceChatService(
      signalSender: (_, signal) async => signals.add(signal),
    );
    addTearDown(service.dispose);
    await service.enable(selfId: 'self-z', peerIds: <String>['peer-a']);

    for (var i = 0; i < 3; i++) {
      await service.setTransmissionActive(false);
      expect(microphoneEnabled, isFalse);
      await service.handleSignal(
        fromId: 'peer-a',
        signal: <String, dynamic>{'type': 'offer', 'sdp': 'offer-sdp'},
      );
      expect(signals.last['type'], 'answer');
      await service.setTransmissionActive(true);
      expect(microphoneEnabled, isTrue);
      expectConnectionRetained();
    }
    expect(signals, hasLength(3));
  });

  test('peer synchronization never reopens a muted microphone', () async {
    final service = VoiceChatService(signalSender: (_, _) async {});
    addTearDown(service.dispose);
    await service.setTransmissionActive(false);
    await service.enable(selfId: 'self-z', peerIds: <String>['peer-a']);
    await service.enable(
      selfId: 'self-z',
      peerIds: <String>['peer-a', 'peer-b'],
    );

    expect(microphoneEnabled, isFalse);
    expect(audioEnabledWhenAttached, <bool>[false, false]);
    expect(
      callsFor('mediaStreamTrackSetEnable').map(
        (call) => call.arguments['enabled'],
      ),
      everyElement(isFalse),
    );
    expect(callsFor('getUserMedia'), hasLength(1));
    expect(callsFor('createPeerConnection'), hasLength(2));
    expect(callsFor('peerConnectionClose'), isEmpty);
  });

  test(
    'disabled voice cannot reopen capture through transmission changes',
    () async {
      final service = VoiceChatService(signalSender: (_, _) async {});
      addTearDown(service.dispose);
      await service.enable(selfId: 'self-z', peerIds: <String>['peer-a']);
      await service.disable();
      await service.setTransmissionActive(true);

      expect(microphoneEnabled, isFalse);
      expect(callsFor('peerConnectionClose'), hasLength(1));
    },
  );

  group('game microphone', () {
    late GameController controller;
    const ally = GamePlayer(
      id: 'peer-a',
      name: 'Ally',
      isHost: false,
      role: 'AGENT',
      status: 'active',
    );

    setUp(() {
      controller = GameController(socketService: _VoiceGameSocketService())
        ..playerId = 'self-z'
        ..playerRole = 'AGENT'
        ..players.add(ally);
      addTearDown(controller.dispose);
    });

    test('mute keeps listening and unmute reuses the connection', () async {
      await controller.refreshVoiceSettings();
      for (var i = 0; i < 3; i++) {
        await controller.toggleVoiceChatEnabled();
        expect(controller.isVoiceChatEnabled, isTrue);
        expect(controller.isMicrophoneEnabled, isFalse);
        expect(controller.isPlayerAudibleForCurrentRole(ally), isTrue);
        expect(microphoneEnabled, isFalse);
        await controller.refreshVoiceSettings();
        expect(microphoneEnabled, isFalse);
        await controller.toggleVoiceChatEnabled();
        expect(controller.isMicrophoneEnabled, isTrue);
        expect(microphoneEnabled, isTrue);
        expectConnectionRetained();
      }
    });

    test('push-to-talk respects mute and stays closed after unmute', () async {
      await VoiceSettingsService().setMode(VoiceTransmissionMode.pushToTalk);
      await controller.refreshVoiceSettings();
      expect(audioEnabledWhenAttached, <bool>[false]);
      await controller.setPushToTalkPressed(true);
      expect(microphoneEnabled, isTrue);
      await controller.toggleVoiceChatEnabled();
      expect(microphoneEnabled, isFalse);
      await controller.setPushToTalkPressed(true);
      expect(microphoneEnabled, isFalse);
      await controller.toggleVoiceChatEnabled();
      expect(microphoneEnabled, isFalse);
      await controller.setPushToTalkPressed(true);
      expect(microphoneEnabled, isTrue);
      await controller.setPushToTalkPressed(false);
      expect(microphoneEnabled, isFalse);
      expectConnectionRetained();
    });

    test('global voice setting still disables and can reenable voice', () async {
      await controller.refreshVoiceSettings();
      await VoiceSettingsService().setEnabled(false);
      await controller.refreshVoiceSettings();
      await controller.toggleVoiceChatEnabled();
      expect(controller.isVoiceChatEnabled, isFalse);
      expect(controller.isMicrophoneEnabled, isFalse);
      expect(controller.isPlayerAudibleForCurrentRole(ally), isFalse);
      expect(microphoneEnabled, isFalse);
      expect(callsFor('peerConnectionClose'), hasLength(1));
      await VoiceSettingsService().setEnabled(true);
      await controller.refreshVoiceSettings();
      expect(controller.isMicrophoneEnabled, isTrue);
      expect(microphoneEnabled, isTrue);
      expect(callsFor('createPeerConnection'), hasLength(2));
    });

    test('microphone button can restart globally reenabled voice', () async {
      await VoiceSettingsService().setEnabled(false);
      await controller.refreshVoiceSettings();
      await VoiceSettingsService().setEnabled(true);
      await controller.toggleVoiceChatEnabled();

      expect(controller.isMicrophoneEnabled, isTrue);
      expect(microphoneEnabled, isTrue);
      expectConnectionRetained();
    });
  });

  test('lobby mute survives resync and unmute retains the connection', () async {
    final controller = LobbyController(socketService: _VoiceLobbySocketService())
      ..bootstrapData = const LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Self',
      )
      ..players.add(
        const LobbyPlayer(id: 'peer-a', name: 'Ally', isHost: false),
      );
    addTearDown(controller.dispose);
    await controller.recoverAfterResume();

    for (var i = 0; i < 3; i++) {
      await controller.toggleVoiceChat();
      expect(controller.isVoiceChatEnabled, isTrue);
      expect(controller.isMicrophoneEnabled, isFalse);
      expect(microphoneEnabled, isFalse);
      await controller.recoverAfterResume();
      expect(microphoneEnabled, isFalse);
      await controller.toggleVoiceChat();
      expect(controller.isMicrophoneEnabled, isTrue);
      expect(microphoneEnabled, isTrue);
      expectConnectionRetained();
    }
    await VoiceSettingsService().setEnabled(false);
    await controller.toggleVoiceChat();
    expect(controller.isVoiceChatEnabled, isFalse);
    expect(controller.isMicrophoneEnabled, isFalse);
    expect(microphoneEnabled, isFalse);
    expect(callsFor('peerConnectionClose'), hasLength(1));
    await VoiceSettingsService().setEnabled(true);
    await controller.toggleVoiceChat();
    expect(controller.isMicrophoneEnabled, isTrue);
    expect(microphoneEnabled, isTrue);
    expect(callsFor('createPeerConnection'), hasLength(2));
  });
}
