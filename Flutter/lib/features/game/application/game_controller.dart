import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/play_area.dart';
import 'package:broken_veil_protocol/features/game/data/game_background_service.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/domain/objective_hint_zone.dart';
import 'package:broken_veil_protocol/features/game/domain/player_zone.dart';
import 'package:broken_veil_protocol/features/game/domain/street_path_finder.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/shared/services/voice_chat_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:broken_veil_protocol/shared/utils/signaling_error_message.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

class GameChatMessage {
  const GameChatMessage({
    required this.playerId,
    required this.playerName,
    required this.text,
    required this.timestampMs,
  });

  final String playerId;
  final String playerName;
  final String text;
  final int timestampMs;
}

class RogueTargetingResult {
  const RogueTargetingResult({
    required this.isValid,
    this.targetPlayerId,
    this.targetPlayerName,
    this.distanceMeters,
    this.angularDeltaDeg,
    this.reason,
  });

  final bool isValid;
  final String? targetPlayerId;
  final String? targetPlayerName;
  final double? distanceMeters;
  final double? angularDeltaDeg;
  final String? reason;
}

class GameController extends ChangeNotifier {
  GameController({GameSocketService? socketService})
    : _socketService = socketService ?? GameSocketService() {
    _voiceChatService = VoiceChatService(
      signalSender: (targetId, signal) {
        return _socketService.sendGameSignal(
          targetId: targetId,
          signal: signal,
        );
      },
      onVoiceActivity: _handleVoiceActivitySignal,
      onConnectionChanged: notifyListeners,
    );
  }

  final GameSocketService _socketService;
  final _backgroundService = const GameBackgroundService();
  final StreetPathFinder _streetPathFinder = StreetPathFinder();
  bool _disposed = false;
  Future<void>? _voiceSyncFuture;
  bool _voiceSyncRequested = false;
  Future<void>? _positionRefreshFuture;
  bool _forcePositionPublish = false;
  Position? _latestDevicePosition;
  Completer<Position?>? _positionFixCompleter;
  late final VoiceChatService _voiceChatService;
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  final VoiceSettingsService _voiceSettingsService = VoiceSettingsService();
  StreamSubscription<Map<String, dynamic>>? _messagesSub;
  StreamSubscription<Position>? _positionSub;
  Timer? _countdownTimer;
  Timer? _joinWatchdogTimer;
  Timer? _voiceActivityTimer;
  Timer? _rogueCaptureInterruptedTimer;
  bool _backgroundVoiceActive = false;
  bool _alertPermissionRequested = false;

  bool isLoading = true;
  String? error;
  String connectionStatus = 'idle';
  GameBootstrapData? bootstrap;
  String? gameCode;
  String? playerId;
  String? playerRole;
  bool isHost = false;
  bool gameStarted = false;
  bool isVoiceChatEnabled = true;
  bool _voiceAllowedBySettings = true;
  bool isReconnectingVoice = false;
  bool hasVoiceError = false;
  bool _isMicrophoneMuted = false;
  bool get isMicrophoneEnabled => isVoiceChatEnabled && !_isMicrophoneMuted;
  bool canListenOtherRoles = false;
  VoiceTransmissionMode voiceMode = VoiceTransmissionMode.voiceActivation;
  double voiceActivationThreshold = 0.55;
  bool _pushToTalkPressed = false;
  bool convergingPhase = true;
  int? remainingSeconds;
  int? _gameEndsAtMs;
  String? winnerType;
  String? winnerReason;
  GeoPoint? rallyPoint;
  int? victoryObjectivesRequired;
  int? startCountdownEndAtMs;
  Timer? _startCountdownTimer;
  bool isOutOfGameZone = false;
  PlayArea? _playArea;
  PlayerZone? _myZone;
  final _playerZones = <String, PlayerZone>{};
  GeoPoint? get reentryPoint => _myZone?.reentryPoint;
  final _agentMapPositions = <String, GeoPoint>{};
  DateTime? _agentMapUpdatedAt;
  Set<String> _objectiveIntrusions = {};
  Set<String> get objectiveIntrusions => Set.unmodifiable(_objectiveIntrusions);
  bool hasRealtimePosition = false;
  final List<GamePlayer> players = <GamePlayer>[];
  final List<GameObjective> objectives = <GameObjective>[];
  final List<GameChatMessage> roleChat = <GameChatMessage>[];
  final List<GameChatMessage> globalChat = <GameChatMessage>[];
  LobbyGameConfig? liveGameConfig;
  GeoPoint? myPosition;
  final int realtimeRefreshIntervalMs =
      AppRuntimeConfig.gameRealtimeRefreshIntervalMs;
  int _lastPositionPublishMs = 0;
  int _lastSnapshotPushMs = 0;
  bool _hasJoinedGame = false;
  bool _needsRejoin = false;
  bool _joinInFlight = false;
  bool _requestedInitialSync = false;
  int _lastJoinAttemptMs = 0;
  final Map<String, int> _objectiveCaptureEndAtMs = <String, int>{};
  final Map<String, int> _objectiveCaptureSeenAtMs = <String, int>{};
  final Map<String, String> _objectiveCaptureRogueByObjectiveId =
      <String, String>{};
  final Map<String, int> _voiceActiveSeenAtMs = <String, int>{};
  final Map<String, GeoPoint> _lastKnownPositionByPlayerId =
      <String, GeoPoint>{};
  final _lastKnownPositionByIdentity =
      <String, ({String id, GeoPoint point})>{};
  int _turnExpiresAtMs = 0;
  static const double _kRogueTargetingHalfConeDeg = 20.0;
  static const int _maxGameChatMessages = 150;

  bool get isGameFinished => winnerType != null;
  List<GameChatMessage> get visibleChat =>
      isGameFinished ? globalChat : roleChat;
  int? _rogueCaptureInterruptedAtMs;

  bool _samePoint(GeoPoint? a, GeoPoint? b, {double eps = 0.000001}) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return (a.latitude - b.latitude).abs() < eps &&
        (a.longitude - b.longitude).abs() < eps;
  }

  LobbyGameConfig? get _effectiveGameConfig =>
      liveGameConfig ?? bootstrap?.gameConfig;

  int _configuredDurationSeconds() {
    final fromForm = bootstrap?.lobby.form?.duration;
    if (fromForm != null && fromForm > 0) return fromForm;
    final fromConfig = _effectiveGameConfig?.durationSeconds;
    if (fromConfig != null && fromConfig > 0) return fromConfig;
    return CreateLobbyDefaults.durationSeconds;
  }

  int _configuredHackDurationMs() {
    final fromForm = bootstrap?.lobby.form?.hackDurationMs;
    if (fromForm != null && fromForm > 0) return fromForm;
    final fromConfig = _effectiveGameConfig?.hackDurationMs;
    if (fromConfig != null && fromConfig > 0) return fromConfig;
    return 10000;
  }

  double _configuredRogueRangeMeters() {
    final fromForm = bootstrap?.lobby.form?.rogueRange;
    if (fromForm != null && fromForm > 0) return fromForm.toDouble();
    final fromConfig = _effectiveGameConfig?.rogueRange;
    if (fromConfig != null && fromConfig > 0) return fromConfig.toDouble();
    return 120;
  }

  double _configuredAgentTargetingRangeMeters() {
    final fromForm = bootstrap?.lobby.form?.agentRange;
    if (fromForm != null && fromForm > 0) return fromForm.toDouble();
    final fromConfig = _effectiveGameConfig?.agentRange;
    if (fromConfig != null && fromConfig > 0) return fromConfig.toDouble();
    return CreateLobbyDefaults.agentRange.toDouble();
  }

  int _configuredVictoryObjectivesRequired() {
    final fromLive = victoryObjectivesRequired;
    if (fromLive != null && fromLive > 0) return fromLive;
    final fromForm = bootstrap?.lobby.form?.victoryConditionObjectives;
    if (fromForm != null && fromForm > 0) return fromForm;
    final fromConfig = _effectiveGameConfig?.victoryConditionObjectives;
    if (fromConfig != null && fromConfig > 0) return fromConfig;
    return objectives.length;
  }

  Future<void> initialize(GameBootstrapData data) async {
    if (_disposed) return;
    bootstrap = data;
    gameCode = data.codeOverride ?? data.lobby.code;
    playerId = data.playerId;
    final initialPosition = data.initialPlayerPosition;
    myPosition = initialPosition?.isValid == true ? initialPosition : null;
    _latestDevicePosition = null;
    hasRealtimePosition = false;
    remainingSeconds = _configuredDurationSeconds();
    _gameEndsAtMs = null;
    winnerType = null;
    winnerReason = null;
    final required =
        data.lobby.form?.victoryConditionObjectives ??
        data.gameConfig?.victoryConditionObjectives;
    victoryObjectivesRequired = (required != null && required > 0)
        ? required
        : null;
    startCountdownEndAtMs = null;
    isOutOfGameZone = false;
    players
      ..clear()
      ..addAll(
        data.players.map((p) {
          return GamePlayer(
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            role: p.role,
            status: p.status,
            latitude: p.id == data.playerId ? myPosition?.latitude : null,
            longitude: p.id == data.playerId ? myPosition?.longitude : null,
          );
        }),
      );
    playerRole = players.where((p) => p.id == playerId).isNotEmpty
        ? players.firstWhere((p) => p.id == playerId).role
        : null;
    isHost = players.any((p) => p.id == playerId && p.isHost);
    _bootstrapObjectives(data);
    _configurePlayArea();
    _trackMyZone();
    _syncSelfMarkerFromMyPosition();
    _rememberKnownPlayers();

    isLoading = true;
    error = null;
    connectionStatus = 'connecting';
    notifyListeners();

    try {
      final voiceSettings = await _voiceSettingsService.load();
      if (_disposed) return;
      isVoiceChatEnabled = voiceSettings.enabled;
      _voiceAllowedBySettings = voiceSettings.enabled;
      voiceMode = voiceSettings.mode;
      voiceActivationThreshold = voiceSettings.activationThreshold;
      _syncBackgroundVoice();
      await _messagesSub?.cancel();
      if (_disposed) return;
      _messagesSub = _socketService.messages.listen(_onMessage);
      _startJoinWatchdog();
      _startVoiceActivityTimer();
      final positionTracking = _ensurePositionTracking();
      await _socketService.connect(
        serverUrl: Uri.parse(data.lobby.serverUrl),
        socketPath: data.lobby.socketPath,
      );
      if (_disposed) return;
      if (!_hasJoinedGame && !_joinInFlight) _sendJoinGame();
      await positionTracking;
      if (_disposed) return;
      connectionStatus = _hasJoinedGame ? 'connected' : 'connecting';
      isLoading = false;
      notifyListeners();
      // Microphone and TURN initialization must not hold the game loading UI.
      unawaited(_syncVoiceState());
    } catch (e) {
      if (_disposed) return;
      error = e.toString();
      connectionStatus = 'error';
      isLoading = false;
      notifyListeners();
    }
  }

  void _bootstrapObjectives(GameBootstrapData data) {
    final sourceObjectives = data.lobby.objectives.isNotEmpty
        ? data.lobby.objectives
        : data.gameConfig?.objectives ?? const <GeoPoint>[];
    objectives
      ..clear()
      ..addAll(
        sourceObjectives
            .asMap()
            .entries
            .where((entry) => entry.value.isValid)
            .map((entry) {
              return GameObjective(
                id: 'obj-${entry.key + 1}',
                point: entry.value,
                name: 'Objectif ${entry.key + 1}',
              );
            }),
      );
  }

  Future<void> _startPositionTracking() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (_disposed || !serviceEnabled) return;
    var permission = await Geolocator.checkPermission();
    if (_disposed) return;
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (_disposed) return;
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return;
    }
    await _positionSub?.cancel();
    if (_disposed) return;
    final locationSettings = switch (kIsWeb ? null : defaultTargetPlatform) {
      TargetPlatform.android => AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 3,
        intervalDuration: const Duration(seconds: 1),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Partie en cours',
          notificationText: 'Le terrain et votre équipe restent synchronisés.',
          notificationChannelName: 'Position en partie',
          enableWakeLock: true,
          enableWifiLock: true,
          setOngoing: true,
        ),
      ),
      TargetPlatform.iOS => AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 3,
        activityType: ActivityType.fitness,
        showBackgroundLocationIndicator: true,
      ),
      _ => const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
      ),
    };
    _positionSub =
        Geolocator.getPositionStream(locationSettings: locationSettings).listen(
          _onDevicePosition,
          onError: (Object error, StackTrace stackTrace) {
            if (_disposed) return;
            AppLogger.error(
              'Suivi GPS interrompu',
              error: error,
              stackTrace: stackTrace,
            );
            hasRealtimePosition = false;
            _positionSub?.cancel();
            _positionSub = null;
            notifyListeners();
          },
        );
    // Start continuous tracking before acquiring a fix. A cold GPS must not
    // block game initialization, and a streamed fix can satisfy the refresh.
    unawaited(_refreshPositionFromDevice(forcePublish: false));
  }

  Future<void> _ensurePositionTracking() async {
    try {
      await _startPositionTracking();
    } catch (error, stackTrace) {
      if (_disposed) return;
      AppLogger.error(
        'Suivi GPS indisponible',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> onAppResumed() async {
    if (_disposed) return;
    if (isVoiceChatEnabled) {
      _backgroundVoiceActive = false;
      _syncBackgroundVoice();
    }
    _tickGameClock();
    if (_socketService.isConnected) {
      if (_needsRejoin) {
        if (!_joinInFlight) _sendJoinGame();
      } else if (_hasJoinedGame) {
        _socketService.requestGameSync();
      }
    } else {
      _socketService.reconnect();
    }
    if (bootstrap != null && _positionSub == null) {
      await _ensurePositionTracking();
    }
    await _refreshPositionFromDevice(forcePublish: true);
  }

  Future<void> _refreshPositionFromDevice({required bool forcePublish}) {
    if (_disposed) return Future<void>.value();
    _forcePositionPublish = _forcePositionPublish || forcePublish;
    return _positionRefreshFuture ??= _readDevicePosition().whenComplete(() {
      _positionRefreshFuture = null;
      _forcePositionPublish = false;
    });
  }

  Future<void> _readDevicePosition() async {
    final streamFix = Completer<Position?>();
    _positionFixCompleter = streamFix;
    try {
      final latest = _latestDevicePosition;
      if (latest != null && _isRecentDevicePosition(latest)) {
        _applyDevicePosition(latest, forcePublish: _forcePositionPublish);
        return;
      }
      final lastKnown = await Future.any<Position?>([
        Geolocator.getLastKnownPosition(),
        streamFix.future,
      ]);
      if (_disposed) return;
      if (lastKnown != null) {
        _applyDevicePosition(lastKnown, forcePublish: _forcePositionPublish);
      }
      final available = _latestDevicePosition;
      if (streamFix.isCompleted ||
          (available != null && _isRecentDevicePosition(available))) {
        return;
      }
      final current = await Future.any<Position?>([
        Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 20),
          ),
        ),
        streamFix.future,
      ]);
      if (_disposed || current == null) return;
      _applyDevicePosition(current, forcePublish: _forcePositionPublish);
    } catch (caughtError, caughtStackTrace) {
      if (_disposed) return;
      AppLogger.error(
        'Erreur interceptée : game_controller._readDevicePosition',
        error: caughtError,
        stackTrace: caughtStackTrace,
      );
      _syncSelfMarkerFromMyPosition();
      notifyListeners();
    } finally {
      if (identical(_positionFixCompleter, streamFix)) {
        _positionFixCompleter = null;
      }
    }
  }

  bool _isRecentDevicePosition(Position position) {
    final age = DateTime.now().difference(position.timestamp);
    return !age.isNegative && age <= const Duration(seconds: 30);
  }

  void _onDevicePosition(Position position) {
    if (_disposed) return;
    _applyDevicePosition(position, forcePublish: _forcePositionPublish);
    final pending = _positionFixCompleter;
    if (pending != null && !pending.isCompleted) {
      pending.complete(_latestDevicePosition);
    }
  }

  void _applyDevicePosition(Position position, {required bool forcePublish}) {
    if (_disposed) return;
    final latest = _latestDevicePosition;
    if (latest != null && position.timestamp.isBefore(latest.timestamp)) return;
    final previousPosition = myPosition;
    final previousOutOfZone = isOutOfGameZone;
    final previousOutside = _myZone?.outside;
    final hadRealtimePosition = hasRealtimePosition;
    final nextPosition = GeoPoint(
      latitude: position.latitude,
      longitude: position.longitude,
    );
    if (!nextPosition.isValid) return;
    _latestDevicePosition = position;
    myPosition = nextPosition;
    hasRealtimePosition = true;
    _trackMyZone();
    final playerPositionChanged = _syncSelfMarkerFromMyPosition();
    _publishPositionIfDue(
      position.latitude,
      position.longitude,
      force: forcePublish || previousOutside != _myZone?.outside,
    );
    if (isHost) _tickObjectiveCapturesIfHost();
    _syncObjectiveIntrusions();
    if (!hadRealtimePosition ||
        !_samePoint(previousPosition, nextPosition) ||
        previousOutOfZone != isOutOfGameZone ||
        playerPositionChanged ||
        forcePublish) {
      notifyListeners();
    }
  }

  bool _syncSelfMarkerFromMyPosition() {
    final pos = myPosition;
    final id = playerId;
    if (pos == null || id == null || id.isEmpty) return false;
    final idx = players.indexWhere((p) => p.id == id);
    if (idx == -1) return false;
    final changed =
        players[idx].latitude != pos.latitude ||
        players[idx].longitude != pos.longitude;
    if (!changed) return false;
    players[idx] = players[idx].copyWith(
      latitude: pos.latitude,
      longitude: pos.longitude,
    );
    _rememberKnownPosition(players[idx]);
    return true;
  }

  String _playerIdentityKey(String name, String? role) {
    final trimmed = name.trim().toLowerCase();
    if (trimmed.isEmpty) return '';
    return '$trimmed|${(role ?? '').toUpperCase()}';
  }

  void _rememberKnownPosition(GamePlayer player) {
    if (player.latitude == null || player.longitude == null) return;
    final point = GeoPoint(
      latitude: player.latitude!,
      longitude: player.longitude!,
    );
    if (!point.isValid) return;
    if (player.id.isNotEmpty) {
      _lastKnownPositionByPlayerId[player.id] = point;
    }
    final identity = _playerIdentityKey(player.name, player.role);
    if (identity.isNotEmpty) {
      _lastKnownPositionByIdentity[identity] = (id: player.id, point: point);
    }
  }

  void _rememberKnownPlayers([Iterable<GamePlayer>? source]) {
    for (final player in source ?? players) {
      _rememberKnownPosition(player);
    }
  }

  void _aliasLastKnownPlayerId(String? fromId, String? toId) {
    if (fromId == null || toId == null) return;
    if (fromId.isEmpty || toId.isEmpty || fromId == toId) return;
    final zone = _playerZones.remove(fromId);
    if (zone != null) _playerZones[toId] = zone;
    final displayed = _agentMapPositions.remove(fromId);
    if (displayed != null) _agentMapPositions[toId] = displayed;
    for (final entry in _objectiveCaptureRogueByObjectiveId.entries.toList()) {
      if (entry.value == fromId) {
        _objectiveCaptureRogueByObjectiveId[entry.key] = toId;
      }
    }
    final known = _lastKnownPositionByPlayerId[fromId];
    if (known == null) return;
    _lastKnownPositionByPlayerId.putIfAbsent(toId, () => known);
  }

  GeoPoint? _lookupLastKnownPosition({
    required String id,
    required String name,
    String? role,
  }) {
    if (id.isNotEmpty) {
      final byId = _lastKnownPositionByPlayerId[id];
      if (byId != null) return byId;
    }
    if (id == playerId) return null;
    final identity = _playerIdentityKey(name, role);
    if (identity.isEmpty) return null;
    final cached = _lastKnownPositionByIdentity[identity];
    if (cached == null ||
        players.any(
          (p) =>
              p.id == cached.id &&
              p.id != id &&
              p.status.toUpperCase() != 'DISCONNECTED',
        )) {
      return null;
    }
    return cached.point;
  }

  GamePlayer _withLastKnownPosition(GamePlayer player) {
    var next = player;
    if (next.latitude == null || next.longitude == null) {
      if (player.id == playerId && myPosition != null) {
        next = next.copyWith(
          latitude: myPosition!.latitude,
          longitude: myPosition!.longitude,
        );
      } else {
        final known = _lookupLastKnownPosition(
          id: player.id,
          name: player.name,
          role: player.role,
        );
        if (known != null) {
          next = next.copyWith(
            latitude: known.latitude,
            longitude: known.longitude,
          );
        }
      }
    }
    _rememberKnownPosition(next);
    return next;
  }

  GamePlayer? _findPlayerByNameRole(
    String name,
    String? role, {
    Iterable<GamePlayer>? source,
  }) {
    final identity = _playerIdentityKey(name, role);
    if (identity.isEmpty) return null;
    for (final player in source ?? players) {
      if (_playerIdentityKey(player.name, player.role) == identity) {
        return player;
      }
    }
    return null;
  }

  void _hydratePlayersFromLastKnown() {
    for (var i = 0; i < players.length; i++) {
      final next = _withLastKnownPosition(players[i]);
      if (next.latitude != players[i].latitude ||
          next.longitude != players[i].longitude) {
        players[i] = next;
      }
    }
    _rememberKnownPlayers();
  }

  void _configurePlayArea() {
    final config = _effectiveGameConfig;
    final lobby = bootstrap?.lobby;
    final form = lobby?.form;
    final center =
        config?.mapCenter ??
        GeoPoint.tryParse(form?.mapCenterLatitude, form?.mapCenterLongitude);
    if (center == null || !center.isValid) return;
    _playArea = PlayArea(
      center: center,
      radiusMeters:
          (config?.mapRadius ??
                  form?.mapRadius ??
                  CreateLobbyDefaults.mapRadius)
              .toDouble(),
      contour: config?.mapStreets.isNotEmpty == true
          ? config!.mapStreets
          : lobby?.outerStreetContour ?? const [],
    );
  }

  void _trackMyZone() {
    final position = myPosition;
    final area = _playArea;
    if (position == null || area == null) return;
    _myZone = PlayerZone.update(
      area,
      position,
      enforceReentry: gameStarted && !isGameFinished,
      previous: _myZone,
    );
    isOutOfGameZone = _myZone!.restricted;
  }

  bool _isPlayerRestricted(GamePlayer player) {
    if (player.id == playerId) return isOutOfGameZone;
    final zone = _playerZones[player.id];
    if (zone != null) return zone.restricted;
    final area = _playArea;
    final position = GeoPoint.tryParse(player.latitude, player.longitude);
    return area != null && position != null && !area.contains(position);
  }

  void _syncObjectiveIntrusions() {
    final enabled =
        _effectiveGameConfig?.objectiveIntrusionAlertsEnabled ??
        bootstrap?.lobby.form?.objectiveIntrusionAlertsEnabled ??
        CreateLobbyDefaults.objectiveIntrusionAlertsEnabled;
    final myPoint = myPosition;
    final active = <String>{};
    if (enabled &&
        gameStarted &&
        !isGameFinished &&
        !isOutOfGameZone &&
        (playerRole ?? '').toUpperCase() == 'AGENT' &&
        myPoint != null) {
      final rogues = players
          .where(
            (p) =>
                (p.role ?? '').toUpperCase() == 'ROGUE' &&
                p.status.toUpperCase() != 'CAPTURED' &&
                p.status.toUpperCase() != 'DISCONNECTED',
          )
          .map((p) => GeoPoint.tryParse(p.latitude, p.longitude))
          .whereType<GeoPoint>()
          .toList();
      final streets =
          _effectiveGameConfig?.mapStreetNetwork ?? const <List<GeoPoint>>[];
      final radius =
          _effectiveGameConfig?.objectiveZoneRadius ??
          bootstrap?.lobby.form?.objectiveZoneRadius ??
          CreateLobbyDefaults.objectiveZoneRadius;
      for (final objective in objectives.where(
        (objective) => !objective.captured,
      )) {
        final zone = const ObjectiveHintZoneCalculator().calculate(
          objective: objective.point,
          streets: streets,
          fallbackRadiusMeters: radius.toDouble(),
        );
        final area = PlayArea(
          center: zone.center,
          radiusMeters: zone.radiusMeters,
          contour: zone.contour,
        );
        if (area.contains(myPoint) && rogues.any(area.contains)) {
          active.add(objective.name ?? objective.id);
        }
      }
    }
    for (final name in active.difference(_objectiveIntrusions)) {
      unawaited(_backgroundService.notifyObjectiveIntrusion(name));
    }
    _objectiveIntrusions = active;
  }

  void _publishPositionIfDue(
    double latitude,
    double longitude, {
    bool force = false,
  }) {
    if (!_hasJoinedGame || connectionStatus != 'connected') return;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (!force && now - _lastPositionPublishMs < realtimeRefreshIntervalMs) {
      return;
    }
    _lastPositionPublishMs = now;
    if (isHost) {
      if (force) {
        _pushSnapshot();
      } else {
        _pushSnapshotThrottled();
      }
      return;
    }
    _socketService.sendGameAction(<String, dynamic>{
      'type': 'position-update',
      'latitude': latitude,
      'longitude': longitude,
      'timestamp': now,
    });
  }

  void startGameFromHost() {
    if (!isHost || gameStarted) return;
    // Start a 3s synchronized countdown before the actual game starts.
    final now = DateTime.now().millisecondsSinceEpoch;
    startCountdownEndAtMs = now + 3000;
    gameStarted = false;
    convergingPhase = false;
    _startCountdownTimer?.cancel();
    _startCountdownTimer = Timer.periodic(const Duration(milliseconds: 200), (
      _,
    ) {
      final endAt = startCountdownEndAtMs;
      if (endAt == null) return;
      final remainingMs = endAt - DateTime.now().millisecondsSinceEpoch;
      if (remainingMs <= 0) {
        _startCountdownTimer?.cancel();
        _startCountdownTimer = null;
        startCountdownEndAtMs = null;
        _beginGameNow();
        return;
      }
      // Keep re-broadcasting pre-start countdown for clients that missed
      // the first snapshot (e.g. transient network hiccup).
      _pushSnapshotThrottled();
      notifyListeners();
    });
    _pushSnapshot();
    notifyListeners();
  }

  void _beginGameNow() {
    if (!isHost) return;
    gameStarted = true;
    convergingPhase = false;
    remainingSeconds = _configuredDurationSeconds();
    _gameEndsAtMs =
        DateTime.now().millisecondsSinceEpoch + remainingSeconds! * 1000;
    _socketService.updateRemainingTime(
      remaining: remainingSeconds!,
      countdownStarted: true,
    );
    _startTimer();
    _syncObjectiveIntrusions();
    _pushSnapshot();
    notifyListeners();
  }

  void _startTimer() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _tickGameClock(),
    );
  }

  void _tickGameClock() {
    if (!isHost || !gameStarted || isGameFinished) return;
    _tickObjectiveCapturesIfHost();
    if (isGameFinished) return;
    final end = _gameEndsAtMs;
    if (end == null) return;
    final remaining = ((end - DateTime.now().millisecondsSinceEpoch) / 1000)
        .ceil()
        .clamp(0, 1 << 31);
    if (remaining == remainingSeconds) return;
    remainingSeconds = remaining;
    _evaluateWinConditionsIfHost();
    if (!isGameFinished) {
      if (connectionStatus == 'connected') {
        _socketService.updateRemainingTime(
          remaining: remaining,
          countdownStarted: true,
        );
      }
      if (remaining.isEven) _pushSnapshot();
    }
    _refreshAgentMapPositions();
    notifyListeners();
  }

  void _onMessage(Map<String, dynamic> event) {
    if (_disposed) return;
    final type = event['type']?.toString();
    final payload = event['payload'];
    switch (type) {
      case 'game:joined':
      case 'game:created':
        if (payload is Map) {
          _applyJoinedPayload(payload);
          _syncVoiceState();
          notifyListeners();
        }
        return;
      case 'socket:connected':
        connectionStatus = _hasJoinedGame ? 'connected' : 'connecting';
        if (_needsRejoin && !_joinInFlight) {
          _sendJoinGame();
        }
        if (!_hasJoinedGame && !_joinInFlight) {
          _sendJoinGame();
        }
        notifyListeners();
        return;
      case 'socket:disconnected':
        _needsRejoin = true;
        _joinInFlight = false;
        _lastJoinAttemptMs = 0;
        _requestedInitialSync = false;
        connectionStatus = 'connecting';
        notifyListeners();
        return;
      case 'socket:connect_error':
        if (_socketService.isConnected) {
          return;
        }
        _joinInFlight = false;
        connectionStatus = 'connecting';
        notifyListeners();
        return;
      case 'game:host-reconnected':
      case 'game:host-transferred':
        if (payload is Map) {
          final newHost = payload['newHostId']?.toString();
          if (newHost != null) {
            for (var i = 0; i < players.length; i++) {
              players[i] = players[i].copyWith(
                isHost: players[i].id == newHost,
              );
            }
            final wasHost = isHost;
            isHost = playerId == newHost;
            if (isHost && !wasHost && gameStarted && !isGameFinished) {
              _gameEndsAtMs ??=
                  DateTime.now().millisecondsSinceEpoch +
                  (remainingSeconds ?? _configuredDurationSeconds()) * 1000;
              _startTimer();
              _tickGameClock();
            } else if (!isHost && wasHost) {
              _countdownTimer?.cancel();
            }
            _syncVoiceState();
            notifyListeners();
          }
        }
        return;
      case 'game:peer-left':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null) {
            players.removeWhere((p) => p.id == id);
            _syncObjectiveIntrusions();
            _syncVoiceState();
            notifyListeners();
          }
        }
        return;
      case 'game:peer-joined':
      case 'game:peer-reconnected':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null && id.isNotEmpty) {
            final oldId = payload['oldPlayerId']?.toString();
            GamePlayer? previous;
            if (oldId != null && oldId.isNotEmpty && oldId != id) {
              final oldIdx = players.indexWhere((p) => p.id == oldId);
              if (oldIdx != -1) {
                previous = players[oldIdx];
                _rememberKnownPosition(previous);
              }
              _aliasLastKnownPlayerId(oldId, id);
              players.removeWhere((p) => p.id == oldId);
            }
            var idx = players.indexWhere((p) => p.id == id);
            final role = payload['role']?.toString();
            final status = payload['status']?.toString() ?? 'active';
            final name = payload['playerName']?.toString() ?? 'Joueur';
            previous ??= idx == -1 ? null : players[idx];
            if (type == 'game:peer-reconnected') {
              previous ??= _findPlayerByNameRole(name, role);
            }
            if (previous != null) {
              _rememberKnownPosition(previous);
            }
            // Defensive dedupe for transient reconnect states:
            // keep newest socket id and remove stale same-name entries.
            players.removeWhere(
              (p) =>
                  p.id != id &&
                  p.name.toLowerCase() == name.toLowerCase() &&
                  (p.status.toLowerCase() == 'disconnected' ||
                      p.role == null ||
                      p.role!.isEmpty),
            );
            idx = players.indexWhere((p) => p.id == id);
            final restored = GamePlayer(
              id: id,
              name: name,
              isHost: previous?.isHost ?? false,
              role: role ?? previous?.role,
              status: status,
              latitude: previous?.latitude,
              longitude: previous?.longitude,
            );
            if (idx == -1) {
              players.add(_withLastKnownPosition(restored));
            } else {
              players[idx] = _withLastKnownPosition(
                players[idx].copyWith(
                  name: name,
                  role: role ?? players[idx].role,
                  status: status,
                ),
              );
            }
            _dedupePlayers();
            _hydratePlayersFromLastKnown();
            _refreshAgentMapPositions();
            _syncObjectiveIntrusions();
            _syncVoiceState();
            notifyListeners();
          }
        }
        return;
      case 'game:player-updated':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          final changes = payload['changes'];
          if (id != null && changes is Map) {
            final idx = players.indexWhere((p) => p.id == id);
            if (idx != -1) {
              players[idx] = players[idx].copyWith(
                status: changes['status']?.toString() ?? players[idx].status,
              );
              _syncVoiceState();
              _evaluateWinConditionsIfHost();
              _syncObjectiveIntrusions();
              notifyListeners();
            }
          }
        }
        return;
      case 'game:signal':
        if (payload is Map) {
          final fromId = payload['fromId']?.toString();
          final signal = payload['signal'];
          if (fromId != null && signal is Map) {
            _voiceChatService.handleSignal(
              fromId: fromId,
              signal: Map<String, dynamic>.from(signal),
            );
          }
        }
        return;
      case 'game:action-relay':
        if (isHost && payload is Map) {
          _handleGameActionRelay(payload);
        }
        return;
      case 'game:remaining-time-updated':
        if (!isHost && payload is Map) {
          final rem = int.tryParse(payload['remaining_time']?.toString() ?? '');
          if (rem != null) {
            remainingSeconds = rem;
            final started = payload['countdown_started'] == true;
            gameStarted = started && rem > 0;
            convergingPhase = false;
            notifyListeners();
          }
        }
        return;
      case 'state:sync':
        if (payload is Map) {
          _applyStateSync(payload);
          _dedupePlayers();
          _refreshAgentMapPositions();
          _syncObjectiveIntrusions();
          _syncVoiceState();
          notifyListeners();
        }
        return;
      case 'game:request-resync':
        if (isHost && payload is Map) {
          _pushSnapshot(targetId: payload['playerId']?.toString());
        }
        return;
      case 'game:chat-agent-message':
      case 'game:chat-rogue-message':
        if (payload is Map) {
          roleChat.add(
            GameChatMessage(
              playerId: payload['playerId']?.toString() ?? '',
              playerName: payload['playerName']?.toString() ?? 'Joueur',
              text: payload['text']?.toString() ?? '',
              timestampMs:
                  int.tryParse(payload['timestamp']?.toString() ?? '') ??
                  DateTime.now().millisecondsSinceEpoch,
            ),
          );
          if (roleChat.length > _maxGameChatMessages) {
            roleChat.removeRange(0, roleChat.length - _maxGameChatMessages);
          }
          notifyListeners();
        }
        return;
      case 'game:chat-global-message':
        if (payload is Map) {
          _appendChatMessage(globalChat, payload);
          notifyListeners();
        }
        return;
      case 'game:finished':
        if (payload is Map) {
          winnerType = payload['winnerType']?.toString() ?? winnerType;
          winnerReason = payload['winnerReason']?.toString() ?? winnerReason;
          rallyPoint = _parseGeoPoint(payload['rallyPoint']) ?? rallyPoint;
          _syncObjectiveIntrusions();
          _syncVoiceState();
          notifyListeners();
        }
        return;
      case 'game:error':
      case 'game:action-rejected':
        _joinInFlight = false;
        final msg = signalingErrorMessage(payload, fallback: 'Erreur game');
        if (isTransientVoiceSignalingError(msg)) {
          return;
        }
        error = msg;
        connectionStatus = _hasJoinedGame ? 'connected' : 'error';
        notifyListeners();
        return;
      case 'game:closed':
        _joinWatchdogTimer?.cancel();
        error = 'Partie fermée.';
        connectionStatus = 'closed';
        notifyListeners();
        return;
      default:
        return;
    }
  }

  void _applyJoinedPayload(Map payload) {
    final host = payload['hostId']?.toString();
    final joinedPlayerId = payload['playerId']?.toString();
    final game = payload['game'];
    final previousSelfId = playerId;
    _rememberKnownPlayers();
    if (joinedPlayerId != null && joinedPlayerId.isNotEmpty) {
      _aliasLastKnownPlayerId(previousSelfId, joinedPlayerId);
      playerId = joinedPlayerId;
    }
    if (host != null) {
      isHost = host == playerId;
    }
    if (game is Map && game['players'] is List) {
      final roster = (game['players'] as List).whereType<Map>();
      final rosterIds = {
        for (final raw in roster)
          raw['id']?.toString() ?? raw['id_player']?.toString(),
      };
      final previousById = <String, GamePlayer>{
        for (final player in players)
          if (player.id.isNotEmpty) player.id: player,
      };
      players
        ..clear()
        ..addAll(
          roster.map((raw) {
            return _playerFromRosterMap(raw, previousById, rosterIds);
          }),
        );
      _hydratePlayersFromLastKnown();
      _syncSelfMarkerFromMyPosition();
    }
    if (game is Map) {
      String? ownRole;
      for (final player in players) {
        if (player.id == playerId) {
          ownRole = player.role;
          break;
        }
      }
      final roleChatMessages = (ownRole ?? '').toUpperCase() == 'ROGUE'
          ? game['rogueChatMessages']
          : game['agentChatMessages'];
      roleChat
        ..clear()
        ..addAll(
          roleChatMessages is List
              ? _parseGameChatMessages(roleChatMessages)
              : const <GameChatMessage>[],
        );
      final globalChatMessages = game['globalChatMessages'];
      globalChat
        ..clear()
        ..addAll(
          globalChatMessages is List
              ? _parseGameChatMessages(globalChatMessages)
              : const <GameChatMessage>[],
        );
      rallyPoint = _parseGeoPoint(game['rallyPoint']) ?? rallyPoint;
      winnerType = game['winnerType']?.toString() ?? winnerType;
      winnerReason = game['winnerReason']?.toString() ?? winnerReason;
    }
    if (game is Map) {
      final serverRemaining = int.tryParse(
        game['remainingTimeSeconds']?.toString() ?? '',
      );
      if (serverRemaining != null) {
        final countdownActive = game['remainingTimeCountdownActive'] == true;
        if (countdownActive || serverRemaining > 0) {
          remainingSeconds = serverRemaining;
        }
      }
    }
    final gameConfigRaw = game is Map ? game['config'] : null;
    if (gameConfigRaw is Map) {
      liveGameConfig = LobbyGameConfig.fromMap(
        Map<String, dynamic>.from(gameConfigRaw),
      );
      _configurePlayArea();
    }
    _refreshObjectiveCaptureTrackingFromStates();
    final selfPlayer = players.where((p) => p.id == playerId);
    playerRole = selfPlayer.isEmpty ? null : selfPlayer.first.role;
    if (host != null) {
      isHost = host == playerId;
    } else {
      isHost = players.any((p) => p.id == playerId && p.isHost);
    }
    gameCode = payload['code']?.toString() ?? gameCode;
    final code = gameCode;
    final selfId = playerId;
    if (code != null && selfId != null && selfId.isNotEmpty) {
      _playerSessionStore.savePlayerIdForCode(code: code, playerId: selfId);
    }
    _hasJoinedGame = true;
    _needsRejoin = false;
    _joinInFlight = false;
    _lastJoinAttemptMs = 0;
    connectionStatus = 'connected';
    error = null;
    _trackMyZone();
    _refreshAgentMapPositions();
    _syncObjectiveIntrusions();
    _syncSelfMarkerFromMyPosition();
    final pos = myPosition;
    if (pos != null) {
      _publishPositionIfDue(pos.latitude, pos.longitude, force: true);
    }
    if (!_requestedInitialSync) {
      _requestedInitialSync = true;
      _socketService.requestGameSync();
    }
    if (isHost && gameStarted && !isGameFinished) {
      _gameEndsAtMs ??=
          DateTime.now().millisecondsSinceEpoch +
          (remainingSeconds ?? _configuredDurationSeconds()) * 1000;
      _startTimer();
    }
    if (!_alertPermissionRequested &&
        (playerRole ?? '').toUpperCase() == 'AGENT' &&
        (_effectiveGameConfig?.objectiveIntrusionAlertsEnabled ??
            bootstrap?.lobby.form?.objectiveIntrusionAlertsEnabled ??
            true)) {
      _alertPermissionRequested = true;
      unawaited(_backgroundService.prepareAlerts());
    }
  }

  void _applyStateSync(Map payload) {
    final previousObjectives = objectives
        .map(
          (o) => GameObjective(
            id: o.id,
            point: o.point,
            name: o.name,
            state: o.state,
          ),
        )
        .toList(growable: false);
    gameStarted =
        payload['started'] == true || payload['countdown_started'] == true;
    convergingPhase = payload['is_converging_phase'] == true;
    final details = payload['gameDetails'];
    if (details is Map) {
      final winner = details['winner_type']?.toString();
      winnerType = (winner == null || winner.isEmpty) ? winnerType : winner;
      final reason = details['winner_reason']?.toString();
      winnerReason = (reason == null || reason.isEmpty) ? winnerReason : reason;
      rallyPoint = _parseGeoPoint(details['rally_point']) ?? rallyPoint;
      final required = int.tryParse(
        details['victory_objectives_required']?.toString() ?? '',
      );
      if (required != null && required > 0) {
        victoryObjectivesRequired = required;
      }
      final endAt = int.tryParse(
        details['start_countdown_end_at_ms']?.toString() ?? '',
      );
      startCountdownEndAtMs = endAt;
      _gameEndsAtMs =
          int.tryParse(details['ends_at_ms']?.toString() ?? '') ??
          _gameEndsAtMs;
    }
    final syncedRemaining = int.tryParse(
      payload['remaining_time']?.toString() ?? '',
    );
    if (syncedRemaining != null) {
      // Avoid clobbering host duration with pre-start zero snapshots.
      if (gameStarted || syncedRemaining > 0) {
        remainingSeconds = syncedRemaining;
      }
    }
    final props = payload['props'];
    if (props is List && props.isNotEmpty) {
      final next = <GameObjective>[];
      for (var i = 0; i < props.length; i++) {
        final raw = props[i];
        if (raw is! Map) continue;
        final point = GeoPoint.tryParse(raw['latitude'], raw['longitude']);
        if (point == null) continue;
        final id = raw['id_prop']?.toString() ?? 'obj-${i + 1}';
        final captureEnd = int.tryParse(
          raw['capture_end_at_ms']?.toString() ?? '',
        );
        final capturingPlayer = raw['capturing_player_id']?.toString();
        if (captureEnd != null && capturingPlayer != null) {
          _objectiveCaptureEndAtMs[id] = captureEnd;
          _objectiveCaptureRogueByObjectiveId[id] = capturingPlayer;
        }
        next.add(
          GameObjective(
            id: id,
            point: point,
            name: raw['name']?.toString(),
            state: raw['state']?.toString() ?? 'VISIBLE',
          ),
        );
      }
      if (next.isNotEmpty) {
        objectives
          ..clear()
          ..addAll(next);
        _detectRogueCaptureInterruptionFromSync(previousObjectives);
      }
      _refreshObjectiveCaptureTrackingFromStates();
    }
    final playersRaw = payload['players'];
    if (playersRaw is List) {
      for (final raw in playersRaw.whereType<Map>()) {
        final id = raw['id_player']?.toString();
        if (id == null || id.isEmpty) continue;
        final idx = players.indexWhere((p) => p.id == id);
        final point = GeoPoint.tryParse(raw['latitude'], raw['longitude']);
        final lat = point?.latitude;
        final lng = point?.longitude;
        final outside = raw['zone_outside'];
        if (point != null && outside is bool) {
          final zone = PlayerZone(
            position: point,
            outside: outside,
            reentryPoint: _parseGeoPoint(raw['reentry_point']),
          );
          if (id == playerId) {
            _myZone ??= zone;
          } else {
            _playerZones[id] = zone;
          }
        }
        final status = raw['status']?.toString();
        final role = raw.containsKey('role') ? raw['role']?.toString() : null;
        final name =
            raw['displayName']?.toString() ??
            raw['name']?.toString() ??
            (idx == -1 ? 'Joueur' : players[idx].name);
        if (idx != -1) {
          players[idx] = players[idx].copyWith(
            name: name,
            role: role ?? players[idx].role,
            latitude: lat,
            longitude: lng,
            status: status,
          );
          continue;
        }
        players.add(
          GamePlayer(
            id: id,
            name: name,
            isHost: false,
            role: role,
            status: status ?? 'active',
            latitude: lat,
            longitude: lng,
          ),
        );
      }
      final me = players.where((p) => p.id == playerId);
      playerRole = me.isEmpty ? playerRole : me.first.role;
      _hydratePlayersFromLastKnown();
      _syncSelfMarkerFromMyPosition();
    }
    _trackMyZone();
  }

  GamePlayer _playerFromRosterMap(
    Map raw,
    Map<String, GamePlayer> previousById,
    Set<String?> rosterIds,
  ) {
    final id = raw['id']?.toString() ?? raw['id_player']?.toString() ?? '';
    final name =
        raw['displayName']?.toString() ??
        raw['name']?.toString() ??
        previousById[id]?.name ??
        'Joueur';
    final role = raw['role']?.toString() ?? previousById[id]?.role;
    var previous = id.isEmpty ? null : previousById[id];
    previous ??= _findPlayerByNameRole(
      name,
      role,
      source: previousById.values.where((p) => !rosterIds.contains(p.id)),
    );
    final position = GeoPoint.tryParse(raw['latitude'], raw['longitude']);
    return GamePlayer(
      id: id,
      name: name,
      isHost: raw['isHost'] == true || (previous?.isHost ?? false),
      role: role ?? previous?.role,
      status: raw['status']?.toString() ?? previous?.status ?? 'active',
      latitude: position?.latitude ?? previous?.latitude,
      longitude: position?.longitude ?? previous?.longitude,
    );
  }

  void _dedupePlayers() {
    final byId = <String, GamePlayer>{
      for (final player in players)
        if (player.id.isNotEmpty) player.id: player,
    };
    players
      ..clear()
      ..addAll(byId.values);
  }

  void _pushSnapshot({String? targetId}) {
    if (!isHost || connectionStatus != 'connected') return;
    final payload = <String, dynamic>{
      'started': gameStarted,
      'countdown_started': gameStarted,
      'is_converging_phase': convergingPhase,
      'remaining_time': remainingSeconds ?? 0,
      'props': objectives.map((o) {
        return <String, dynamic>{
          'id_prop': o.id,
          'latitude': o.point.latitude,
          'longitude': o.point.longitude,
          'state': o.state,
          'visible': !o.captured,
          'name': o.name ?? o.id,
          'capture_end_at_ms': ?_objectiveCaptureEndAtMs[o.id],
          'capturing_player_id': ?_objectiveCaptureRogueByObjectiveId[o.id],
        };
      }).toList(),
      'players': players.map((p) {
        final zone = p.id == playerId ? _myZone : _playerZones[p.id];
        final reentry = zone?.reentryPoint;
        return <String, dynamic>{
          'id_player': p.id,
          'role': p.role,
          'status': p.status,
          'latitude': p.latitude,
          'longitude': p.longitude,
          'displayName': p.name,
          'zone_outside': ?zone?.outside,
          if (reentry != null)
            'reentry_point': {
              'latitude': reentry.latitude,
              'longitude': reentry.longitude,
            },
        };
      }).toList(),
      'gameDetails': <String, dynamic>{
        'winner_type': winnerType,
        'winner_reason': winnerReason,
        'remaining_time': remainingSeconds ?? 0,
        'countdown_started': gameStarted,
        'victory_objectives_required': _configuredVictoryObjectivesRequired(),
        'start_countdown_end_at_ms': startCountdownEndAtMs,
        'ends_at_ms': _gameEndsAtMs,
      },
    };
    _socketService.pushState(state: payload, targetId: targetId);
  }

  _WinnerOutcome? _winnerOutcomeIfAny() {
    // Rogue wins by capturing enough objectives.
    final captured = objectives.where((o) => o.captured).length;
    final required = _configuredVictoryObjectivesRequired();
    if (required > 0 && captured >= required) {
      return const _WinnerOutcome(type: 'ROGUE', reason: 'OBJECTIVES_CAPTURED');
    }

    // Agents win if all rogues are captured.
    final roguePlayers = players.where(
      (p) => (p.role ?? '').toUpperCase() == 'ROGUE',
    );
    if (roguePlayers.isNotEmpty &&
        roguePlayers.every((p) => p.status.toUpperCase() == 'CAPTURED')) {
      return const _WinnerOutcome(type: 'AGENT', reason: 'ALL_ROGUES_CAPTURED');
    }

    // Agents win if time is over.
    if (remainingSeconds != null && remainingSeconds! <= 0) {
      return const _WinnerOutcome(type: 'AGENT', reason: 'TIMEOUT');
    }

    return null;
  }

  void _pushSnapshotThrottled({String? targetId}) {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (targetId == null &&
        now - _lastSnapshotPushMs < realtimeRefreshIntervalMs) {
      return;
    }
    _lastSnapshotPushMs = now;
    _pushSnapshot(targetId: targetId);
  }

  void _handleGameActionRelay(Map payload) {
    final fromId = payload['fromId']?.toString();
    final action = payload['action'];
    if (fromId == null || action is! Map) return;
    final type = action['type']?.toString();
    if (type == 'rogue-capture-request') {
      _handleRogueCaptureRequest(fromId);
      return;
    }
    if (type == 'agent-capture-request') {
      final targetPlayerId = action['targetPlayerId']?.toString();
      if (targetPlayerId == null || targetPlayerId.isEmpty) return;
      _handleAgentCaptureRequest(fromId, targetPlayerId);
      return;
    }
    if (type != 'position-update') return;
    final point = GeoPoint.tryParse(action['latitude'], action['longitude']);
    if (point == null) return;
    final idx = players.indexWhere((p) => p.id == fromId);
    if (idx == -1) return;
    players[idx] = players[idx].copyWith(
      latitude: point.latitude,
      longitude: point.longitude,
    );
    final area = _playArea;
    if (area != null) {
      _playerZones[fromId] = PlayerZone.update(
        area,
        point,
        enforceReentry: gameStarted && !isGameFinished,
        previous: _playerZones[fromId],
      );
    }
    _rememberKnownPosition(players[idx]);
    _pushSnapshotThrottled();
    _tickObjectiveCapturesIfHost();
    _refreshAgentMapPositions();
    _syncObjectiveIntrusions();
    notifyListeners();
  }

  RogueTargetingResult getRogueTargetForHeading(double? headingDeg) {
    if ((playerRole ?? '').toUpperCase() != 'AGENT') {
      return const RogueTargetingResult(
        isValid: false,
        reason: 'Action réservée aux agents.',
      );
    }
    if (!gameStarted) {
      return const RogueTargetingResult(
        isValid: false,
        reason: 'La partie n\'a pas démarré.',
      );
    }
    if (headingDeg == null) {
      return const RogueTargetingResult(
        isValid: false,
        reason: 'Orientation boussole indisponible.',
      );
    }
    final me = myPosition;
    if (me == null) {
      return const RogueTargetingResult(
        isValid: false,
        reason: 'Position GPS indisponible.',
      );
    }

    final maxDistanceMeters = _configuredAgentTargetingRangeMeters();
    GamePlayer? bestTarget;
    double? bestDistance;
    double? bestAngleDelta;
    var bestScore = double.infinity;
    for (final player in players) {
      if ((player.role ?? '').toUpperCase() != 'ROGUE') continue;
      if ((player.status).toUpperCase() == 'CAPTURED') continue;
      if ((player.status).toLowerCase() == 'disconnected') continue;
      if (player.latitude == null || player.longitude == null) continue;
      final distance = Geolocator.distanceBetween(
        me.latitude,
        me.longitude,
        player.latitude!,
        player.longitude!,
      );
      if (distance > maxDistanceMeters) continue;
      final bearing = Geolocator.bearingBetween(
        me.latitude,
        me.longitude,
        player.latitude!,
        player.longitude!,
      );
      final delta = _absAngleDeltaDeg(headingDeg, bearing);
      final inCone = delta <= _kRogueTargetingHalfConeDeg;
      final score = (inCone ? 0.0 : 1000.0) + (delta * 10) + distance;
      if (score >= bestScore) continue;
      bestScore = score;
      bestTarget = player;
      bestDistance = distance;
      bestAngleDelta = delta;
    }

    if (bestTarget == null || bestDistance == null || bestAngleDelta == null) {
      return const RogueTargetingResult(
        isValid: false,
        reason: 'Aucun rogue détecté à proximité.',
      );
    }
    final isValid = bestAngleDelta <= _kRogueTargetingHalfConeDeg;
    if (!isValid) {
      return RogueTargetingResult(
        isValid: false,
        targetPlayerId: bestTarget.id,
        targetPlayerName: bestTarget.name,
        distanceMeters: bestDistance,
        angularDeltaDeg: bestAngleDelta,
        reason: 'Rogue hors cône de visée.',
      );
    }
    return RogueTargetingResult(
      isValid: true,
      targetPlayerId: bestTarget.id,
      targetPlayerName: bestTarget.name,
      distanceMeters: bestDistance,
      angularDeltaDeg: bestAngleDelta,
    );
  }

  String triggerAgentCaptureFromTarget({
    required String targetPlayerId,
    required double? headingDeg,
  }) {
    if (!gameStarted) return 'La partie n\'a pas démarré.';
    if (isOutOfGameZone) return 'Revenez par votre point de sortie.';
    if ((playerRole ?? '').toUpperCase() != 'AGENT') {
      return 'Action réservée aux agents.';
    }
    final targeting = getRogueTargetForHeading(headingDeg);
    if (!targeting.isValid || targeting.targetPlayerId == null) {
      return targeting.reason ?? 'Ciblage invalide.';
    }
    if (targeting.targetPlayerId != targetPlayerId) {
      return 'La cible a changé, recommencez le ciblage.';
    }
    if (isHost) {
      final me = playerId;
      if (me == null || me.isEmpty) return 'Agent introuvable.';
      _handleAgentCaptureRequest(me, targetPlayerId);
      return 'Capture envoyée.';
    }
    _socketService.sendGameAction(<String, dynamic>{
      'type': 'agent-capture-request',
      'targetPlayerId': targetPlayerId,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
    return 'Capture envoyée.';
  }

  double _absAngleDeltaDeg(double fromDeg, double toDeg) {
    var delta = (toDeg - fromDeg) % 360.0;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta.abs();
  }

  void _handleRogueCaptureRequest(String roguePlayerId) {
    if (!gameStarted || isGameFinished) return;
    final selfIdx = players.indexWhere((p) => p.id == roguePlayerId);
    if (selfIdx != -1) {
      final status = players[selfIdx].status.toUpperCase();
      if (status == 'CAPTURED' || status == 'DISCONNECTED') return;
    }
    final objectiveId = _nearestHackableObjectiveIdForPlayer(roguePlayerId);
    if (objectiveId == null) return;
    if (_objectiveCaptureEndAtMs.containsKey(objectiveId)) return;
    final idx = objectives.indexWhere((o) => o.id == objectiveId);
    if (idx == -1) return;
    final current = objectives[idx];
    if (current.captured) return;
    objectives[idx] = current.copyWith(state: 'CAPTURING');
    final now = DateTime.now().millisecondsSinceEpoch;
    _objectiveCaptureSeenAtMs[objectiveId] = now;
    _objectiveCaptureEndAtMs[objectiveId] = now + _configuredHackDurationMs();
    _objectiveCaptureRogueByObjectiveId[objectiveId] = roguePlayerId;
    _pushSnapshot();
    notifyListeners();
  }

  void _handleAgentCaptureRequest(String agentPlayerId, String targetPlayerId) {
    if (!isHost || !gameStarted) return;
    final agentIdx = players.indexWhere((p) => p.id == agentPlayerId);
    final targetIdx = players.indexWhere((p) => p.id == targetPlayerId);
    if (agentIdx == -1 || targetIdx == -1) return;
    final agent = players[agentIdx];
    final target = players[targetIdx];
    if ((agent.role ?? '').toUpperCase() != 'AGENT') return;
    if (_isPlayerRestricted(agent)) return;
    if ((target.role ?? '').toUpperCase() != 'ROGUE') return;
    if (target.status.toUpperCase() == 'CAPTURED') return;
    if (target.status.toLowerCase() == 'disconnected') return;
    players[targetIdx] = target.copyWith(status: 'CAPTURED');
    _evaluateWinConditionsIfHost();
    if (!isGameFinished) _pushSnapshot();
    _syncObjectiveIntrusions();
    notifyListeners();
  }

  String? _nearestHackableObjectiveIdForPlayer(String playerIdToCheck) {
    final p = players
        .where((p) => p.id == playerIdToCheck)
        .toList(growable: false);
    if (p.isEmpty) return null;
    final player = p.first;
    if ((player.role ?? '').toUpperCase() != 'ROGUE') return null;
    if (_isPlayerRestricted(player)) return null;
    final status = player.status.toUpperCase();
    if (status == 'CAPTURED' || status == 'DISCONNECTED') return null;
    if (player.latitude == null || player.longitude == null) return null;
    final rangeMeters = _configuredRogueRangeMeters();
    String? bestId;
    var bestDistance = double.infinity;
    for (final objective in objectives) {
      if (objective.captured) continue;
      if (objective.state.toUpperCase() == 'CAPTURING') continue;
      final d = Geolocator.distanceBetween(
        player.latitude!,
        player.longitude!,
        objective.point.latitude,
        objective.point.longitude,
      );
      if (d <= rangeMeters && d < bestDistance) {
        bestDistance = d;
        bestId = objective.id;
      }
    }
    return bestId;
  }

  bool _isRogueStillInRangeForObjective({
    required String roguePlayerId,
    required String objectiveId,
  }) {
    final p = players.where((player) => player.id == roguePlayerId).toList();
    if (p.isEmpty) return false;
    final rogue = p.first;
    if ((rogue.role ?? '').toUpperCase() != 'ROGUE') return false;
    if (_isPlayerRestricted(rogue)) return false;
    final status = rogue.status.toUpperCase();
    if (status == 'CAPTURED' || status == 'DISCONNECTED') return false;
    if (rogue.latitude == null || rogue.longitude == null) return false;

    final objective = objectives.where((o) => o.id == objectiveId).toList();
    if (objective.isEmpty || objective.first.captured) return false;

    final rangeMeters = _configuredRogueRangeMeters();
    final distance = Geolocator.distanceBetween(
      rogue.latitude!,
      rogue.longitude!,
      objective.first.point.latitude,
      objective.first.point.longitude,
    );
    return distance <= rangeMeters;
  }

  void _tickObjectiveCapturesIfHost() {
    if (!isHost || _objectiveCaptureEndAtMs.isEmpty) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    var changed = false;
    final interruptedIds = <String>[];
    for (final entry in _objectiveCaptureEndAtMs.entries) {
      final objectiveId = entry.key;
      final rogueId = _objectiveCaptureRogueByObjectiveId[objectiveId];
      if (rogueId == null || rogueId.isEmpty) continue;
      final stillInRangeForCurrentObjective = _isRogueStillInRangeForObjective(
        roguePlayerId: rogueId,
        objectiveId: objectiveId,
      );
      if (!stillInRangeForCurrentObjective) {
        interruptedIds.add(objectiveId);
      }
    }
    for (final id in interruptedIds) {
      _objectiveCaptureEndAtMs.remove(id);
      _objectiveCaptureSeenAtMs.remove(id);
      _objectiveCaptureRogueByObjectiveId.remove(id);
      final idx = objectives.indexWhere((o) => o.id == id);
      if (idx == -1) continue;
      final objective = objectives[idx];
      if (objective.captured) continue;
      objectives[idx] = objective.copyWith(state: 'VISIBLE');
      changed = true;
    }
    final done =
        _objectiveCaptureEndAtMs.entries
            .where((entry) => entry.value <= now)
            .toList()
          ..sort((a, b) => a.value.compareTo(b.value));
    final bonus =
        (_effectiveGameConfig?.captureTimeBonusSeconds ??
                bootstrap?.lobby.form?.captureTimeBonusSeconds ??
                0)
            .clamp(0, 3600);
    var earnedSeconds = 0;
    for (final entry in done) {
      final deadline = _gameEndsAtMs;
      if (deadline != null && entry.value > deadline) break;
      final id = entry.key;
      _objectiveCaptureEndAtMs.remove(id);
      _objectiveCaptureSeenAtMs.remove(id);
      _objectiveCaptureRogueByObjectiveId.remove(id);
      final idx = objectives.indexWhere((o) => o.id == id);
      if (idx == -1) continue;
      final objective = objectives[idx];
      if (objective.captured) continue;
      objectives[idx] = objective.copyWith(state: 'CAPTURED');
      if (deadline != null) _gameEndsAtMs = deadline + bonus * 1000;
      earnedSeconds += bonus;
      changed = true;
    }
    if (changed) {
      if (earnedSeconds > 0 && remainingSeconds != null) {
        final deadline = _gameEndsAtMs;
        remainingSeconds = deadline == null
            ? remainingSeconds! + earnedSeconds
            : ((deadline - now) / 1000).ceil().clamp(0, 1 << 31);
      }
      _evaluateWinConditionsIfHost();
      if (!isGameFinished) {
        if (earnedSeconds > 0 &&
            remainingSeconds != null &&
            connectionStatus == 'connected') {
          _socketService.updateRemainingTime(
            remaining: remainingSeconds!,
            countdownStarted: true,
          );
        }
        _pushSnapshot();
      }
      notifyListeners();
    }
  }

  void _refreshObjectiveCaptureTrackingFromStates() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final activeIds = objectives
        .where((o) => o.state.toUpperCase() == 'CAPTURING')
        .map((o) => o.id)
        .toSet();
    for (final id in activeIds) {
      _objectiveCaptureSeenAtMs[id] ??= now;
    }
    _objectiveCaptureSeenAtMs.removeWhere((id, _) => !activeIds.contains(id));
    _objectiveCaptureEndAtMs.removeWhere((id, _) => !activeIds.contains(id));
    _objectiveCaptureRogueByObjectiveId.removeWhere(
      (id, _) => !activeIds.contains(id),
    );
  }

  void _detectRogueCaptureInterruptionFromSync(List<GameObjective> previous) {
    if (!isRogueRole) return;
    final previousById = <String, GameObjective>{
      for (final objective in previous) objective.id: objective,
    };
    for (final current in objectives) {
      final before = previousById[current.id];
      if (before == null) continue;
      if (before.state.toUpperCase() == 'CAPTURING' &&
          current.state.toUpperCase() == 'VISIBLE') {
        _rogueCaptureInterruptedAtMs = DateTime.now().millisecondsSinceEpoch;
        _rogueCaptureInterruptedTimer?.cancel();
        _rogueCaptureInterruptedTimer = Timer(
          const Duration(milliseconds: 2300),
          notifyListeners,
        );
        break;
      }
    }
  }

  void _evaluateWinConditionsIfHost() {
    if (!isHost) return;
    if (winnerType != null && winnerType!.isNotEmpty) return;
    final outcome = _winnerOutcomeIfAny();
    if (outcome != null) {
      winnerType = outcome.type;
      winnerReason = outcome.reason;
      remainingSeconds = 0;
      _gameEndsAtMs = null;
      gameStarted = false;
      convergingPhase = false;
      _countdownTimer?.cancel();
      if (connectionStatus == 'connected') {
        _socketService.updateRemainingTime(
          remaining: 0,
          countdownStarted: false,
        );
      }
      _syncObjectiveIntrusions();
      _syncVoiceState();
      _pushSnapshot();
      notifyListeners();
    }
  }

  void sendRoleChat(String text) {
    final role = playerRole ?? 'AGENT';
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    _socketService.sendRoleChat(role: role, text: trimmed);
  }

  void sendChat(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    if (isGameFinished) {
      _socketService.sendGlobalChat(trimmed);
      return;
    }
    sendRoleChat(trimmed);
  }

  void leaveGame() {
    final code = gameCode;
    final me = playerId;
    if (code != null && me != null) {
      _socketService.leaveGame(code: code, playerId: me);
    }
  }

  void _sendJoinGame() {
    final data = bootstrap;
    final code = gameCode;
    if (data == null || code == null) return;
    _lastJoinAttemptMs = DateTime.now().millisecondsSinceEpoch;
    _joinInFlight = true;
    _socketService.joinGame(
      code: code,
      playerName: data.lobby.playerName,
      cognitoSub: data.lobby.cognitoSub,
      previousPlayerId: (playerId != null && playerId!.isNotEmpty)
          ? playerId
          : data.lobby.previousPlayerId,
    );
  }

  void _startJoinWatchdog() {
    _joinWatchdogTimer?.cancel();
    _joinWatchdogTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (_hasJoinedGame && !_needsRejoin) return;
      if (!_socketService.isConnected) return;
      final now = DateTime.now().millisecondsSinceEpoch;
      if (_joinInFlight && now - _lastJoinAttemptMs < 5000) return;
      _joinInFlight = false;
      connectionStatus = 'connecting';
      _sendJoinGame();
      notifyListeners();
    });
  }

  bool isPlayerVisibleForCurrentRole(GamePlayer player) {
    if (player.id == playerId) return false;
    if (isGameFinished) return true;
    if (player.status.toUpperCase() == 'CAPTURED') return false;
    final me = (playerRole ?? '').toUpperCase();
    final targetRole = (player.role ?? '').toUpperCase();
    if (me == 'ROGUE') {
      return targetRole == 'AGENT' || targetRole == 'ROGUE';
    }
    if (me == 'AGENT') {
      return targetRole == 'AGENT';
    }
    return true;
  }

  GamePlayer playerWithDisplayPosition(GamePlayer player) {
    if (_agentMapIntervalSeconds > 0 &&
        isRogueRole &&
        !isGameFinished &&
        player.id != playerId &&
        (player.role ?? '').toUpperCase() == 'AGENT') {
      final sampled = _agentMapPositions[player.id];
      return GamePlayer(
        id: player.id,
        name: player.name,
        isHost: player.isHost,
        role: player.role,
        status: player.status,
        latitude: sampled?.latitude,
        longitude: sampled?.longitude,
      );
    }
    return _withLastKnownPosition(player);
  }

  int get _agentMapIntervalSeconds =>
      _effectiveGameConfig?.rogueAgentPositionIntervalSeconds ??
      bootstrap?.lobby.form?.rogueAgentPositionIntervalSeconds ??
      0;

  void _refreshAgentMapPositions() {
    final seconds = _agentMapIntervalSeconds;
    if (!isRogueRole || isGameFinished || seconds <= 0) return;
    final now = DateTime.now();
    final last = _agentMapUpdatedAt;
    if (last != null && now.difference(last) < Duration(seconds: seconds)) {
      return;
    }
    _agentMapPositions.clear();
    for (final player in players) {
      if ((player.role ?? '').toUpperCase() != 'AGENT') continue;
      final known = _withLastKnownPosition(player);
      final point = GeoPoint.tryParse(known.latitude, known.longitude);
      if (point != null) _agentMapPositions[player.id] = point;
    }
    if (_agentMapPositions.isNotEmpty) _agentMapUpdatedAt = now;
  }

  List<GamePlayer> get mapMarkerPlayers {
    return players
        .where(
          (player) =>
              player.id == playerId || isPlayerVisibleForCurrentRole(player),
        )
        .map(playerWithDisplayPosition)
        .where(
          (player) =>
              GeoPoint.tryParse(player.latitude, player.longitude) != null,
        )
        .toList(growable: false);
  }

  bool isPlayerAudibleForCurrentRole(GamePlayer player) {
    if (!isVoiceChatEnabled) return false;
    if (player.id == playerId) return false;
    final statusUpper = player.status.toUpperCase();
    if (statusUpper == 'DISCONNECTED') return false;
    if (isGameFinished) return true;
    if (statusUpper == 'CAPTURED') return false;
    final me = (playerRole ?? '').toUpperCase();
    final targetRole = (player.role ?? '').toUpperCase();
    if (canListenOtherRoles) return true;
    if (me.isEmpty || targetRole.isEmpty) return false;
    return me == targetRole;
  }

  bool isPlayerVoiceActive(String playerId) {
    final seenAt = _voiceActiveSeenAtMs[playerId];
    if (seenAt == null) return false;
    return DateTime.now().millisecondsSinceEpoch - seenAt <= 1500;
  }

  bool get isVoiceReady => _voiceChatService.isEnabled;
  bool get canReconnectVoice =>
      _voiceAllowedBySettings &&
      connectionStatus == 'connected' &&
      !isReconnectingVoice;
  List<GamePlayer> get voiceParticipants =>
      players.where(isPlayerAudibleForCurrentRole).toList(growable: false);
  VoicePeerStatus voiceStatusFor(String id) => _voiceChatService.peerStatus(id);

  Future<void> reconnectVoice() async {
    if (_disposed || isReconnectingVoice || connectionStatus != 'connected') {
      return;
    }
    final settings = await _voiceSettingsService.load();
    if (_disposed || isReconnectingVoice || !settings.enabled) return;
    isReconnectingVoice = true;
    hasVoiceError = false;
    isVoiceChatEnabled = true;
    _turnExpiresAtMs = 0;
    _syncBackgroundVoice();
    notifyListeners();
    try {
      await _syncVoiceState();
      if (!_disposed && connectionStatus == 'connected') {
        await _voiceChatService.reconnect();
      }
    } finally {
      isReconnectingVoice = false;
      notifyListeners();
    }
  }

  void _syncBackgroundVoice() {
    if (_backgroundVoiceActive == isVoiceChatEnabled) return;
    _backgroundVoiceActive = isVoiceChatEnabled;
    unawaited(_backgroundService.setVoiceActive(_backgroundVoiceActive));
  }

  List<GamePlayer> get sameRoleVoicePlayers {
    final me = (playerRole ?? '').toUpperCase();
    if (me.isEmpty) return const <GamePlayer>[];
    return players
        .where((p) => p.id != playerId)
        .where((p) => p.status.toLowerCase() != 'disconnected')
        .where((p) => (p.role ?? '').toUpperCase() == me)
        .toList(growable: false);
  }

  List<GamePlayer> get activeSameRoleVoicePlayers {
    return sameRoleVoicePlayers
        .where((player) => isPlayerVoiceActive(player.id))
        .toList(growable: false);
  }

  List<GamePlayer> get activeAudibleVoicePlayers {
    return players
        .where(isPlayerAudibleForCurrentRole)
        .where((player) => isPlayerVoiceActive(player.id))
        .toList(growable: false);
  }

  Future<void> toggleVoiceChatEnabled() async {
    final settings = await _voiceSettingsService.load();
    if (!settings.enabled) {
      isVoiceChatEnabled = false;
      _voiceAllowedBySettings = false;
      _syncBackgroundVoice();
      _pushToTalkPressed = false;
      await _voiceChatService.disable();
      notifyListeners();
      return;
    }
    if (!isVoiceChatEnabled) {
      isVoiceChatEnabled = true;
      _syncBackgroundVoice();
      _isMicrophoneMuted = false;
      _pushToTalkPressed = false;
    } else {
      _isMicrophoneMuted = !_isMicrophoneMuted;
      if (_isMicrophoneMuted) {
        _pushToTalkPressed = false;
      }
    }
    if (isMicrophoneEnabled && !_voiceChatService.isEnabled) {
      await _syncVoiceState();
    } else {
      await _applyTransmissionGate();
    }
    notifyListeners();
  }

  Future<void> toggleListenOtherRoles() async {
    canListenOtherRoles = !canListenOtherRoles;
    await _syncVoiceState();
    notifyListeners();
  }

  void _startVoiceActivityTimer() {
    _voiceActivityTimer?.cancel();
    _voiceActivityTimer = Timer.periodic(const Duration(milliseconds: 900), (
      _,
    ) {
      if (!isVoiceChatEnabled) return;
      if (connectionStatus != 'connected') return;
      _voiceChatService.broadcastVoiceActivity(
        forceInactive: false,
        level: 1.0,
      );
      final before = _voiceActiveSeenAtMs.length;
      _voiceActiveSeenAtMs.removeWhere(
        (_, seenAt) => DateTime.now().millisecondsSinceEpoch - seenAt > 2000,
      );
      if (_voiceActiveSeenAtMs.length != before) {
        notifyListeners();
      }
    });
  }

  Future<void> _syncVoiceState() {
    if (_disposed) return Future<void>.value();
    _voiceSyncRequested = true;
    return _voiceSyncFuture ??= _runVoiceSync().whenComplete(() {
      _voiceSyncFuture = null;
    });
  }

  Future<void> _runVoiceSync() async {
    do {
      _voiceSyncRequested = false;
      await _syncVoiceStateOnce();
    } while (!_disposed && _voiceSyncRequested);
  }

  Future<void> _syncVoiceStateOnce() async {
    final wasReady = _voiceChatService.isEnabled;
    final hadError = hasVoiceError;
    try {
      final me = playerId;
      if (me == null || me.isEmpty || !isVoiceChatEnabled) {
        await _voiceChatService.disable();
        return;
      }
      await _refreshTurnIfNeeded();
      if (_disposed) return;
      if (!isVoiceChatEnabled) {
        await _voiceChatService.disable();
        return;
      }
      if (me != playerId) {
        _voiceSyncRequested = true;
        return;
      }
      final peers = players
          .where((p) => isPlayerAudibleForCurrentRole(p))
          .map((p) => p.id)
          .toList();
      await _applyTransmissionGate();
      if (_disposed) return;
      await _voiceChatService.enable(selfId: me, peerIds: peers);
      hasVoiceError = !_voiceChatService.isEnabled;
    } catch (_) {
      hasVoiceError = true;
      await _voiceChatService.disable();
    } finally {
      if (wasReady != _voiceChatService.isEnabled ||
          hadError != hasVoiceError) {
        notifyListeners();
      }
    }
  }

  Future<void> refreshVoiceSettings() async {
    final settings = await _voiceSettingsService.load();
    if (_disposed) return;
    isVoiceChatEnabled = settings.enabled;
    _voiceAllowedBySettings = settings.enabled;
    _syncBackgroundVoice();
    voiceMode = settings.mode;
    voiceActivationThreshold = settings.activationThreshold;
    if (!isVoiceChatEnabled) {
      _pushToTalkPressed = false;
      await _voiceChatService.disable();
      notifyListeners();
      return;
    }
    await _syncVoiceState();
    notifyListeners();
  }

  Future<void> setPushToTalkPressed(bool pressed) async {
    if (pressed && !isMicrophoneEnabled) return;
    if (_pushToTalkPressed == pressed) return;
    _pushToTalkPressed = pressed;
    await _applyTransmissionGate();
    notifyListeners();
  }

  Future<void> _applyTransmissionGate() async {
    if (!isMicrophoneEnabled) {
      await _voiceChatService.setTransmissionActive(false);
      return;
    }
    if (voiceMode == VoiceTransmissionMode.pushToTalk) {
      await _voiceChatService.setTransmissionActive(_pushToTalkPressed);
      return;
    }
    // Voice activation mode: currently opens transmission continuously,
    // threshold is used for remote activity highlighting sensitivity.
    await _voiceChatService.setTransmissionActive(true);
  }

  void _handleVoiceActivitySignal(String peerId, bool active) {
    if (!active) return;
    final threshold = voiceActivationThreshold.clamp(0.05, 1.0);
    // In absence of raw microphone level, keep compatibility:
    // packets below threshold are ignored for highlight.
    if (1.0 < threshold) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final previous = _voiceActiveSeenAtMs[peerId];
    _voiceActiveSeenAtMs[peerId] = now;
    if (previous == null || now - previous >= 300) {
      notifyListeners();
    }
  }

  Future<void> _refreshTurnIfNeeded() async {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now < _turnExpiresAtMs) return;
    final creds = await _socketService.requestTurnCredentials();
    if (_disposed) return;
    if (creds == null || creds.urls.isEmpty) {
      _turnExpiresAtMs = DateTime.now().millisecondsSinceEpoch + 5000;
      return;
    }
    final servers = <Map<String, dynamic>>[];
    for (final url in creds.urls) {
      final isTurn = url.startsWith('turn:');
      final entry = <String, dynamic>{'urls': url};
      if (isTurn && (creds.username?.isNotEmpty ?? false)) {
        entry['username'] = creds.username;
      }
      if (isTurn && (creds.credential?.isNotEmpty ?? false)) {
        entry['credential'] = creds.credential;
      }
      servers.add(entry);
    }
    if (servers.isNotEmpty) {
      _voiceChatService.configureIceServers(servers);
      _turnExpiresAtMs = now + 9 * 60 * 1000;
    }
  }

  int get startZoneRadiusMeters {
    return _effectiveGameConfig?.startZoneRadius ??
        bootstrap?.lobby.form?.startZoneRadius ??
        CreateLobbyDefaults.startZoneRadius;
  }

  GeoPoint? _startZoneForRole(String? role) {
    final upper = (role ?? '').toUpperCase();
    if (upper == 'ROGUE') {
      return _effectiveGameConfig?.rogueStartZone ??
          bootstrap?.lobby.rogueStartZone;
    }
    if (upper == 'AGENT') {
      return _effectiveGameConfig?.startZone ?? bootstrap?.lobby.agentStartZone;
    }
    return null;
  }

  GeoPoint? get myStartZone => _startZoneForRole(playerRole);

  bool get canTriggerRogueObjectiveCapture {
    if (!gameStarted || isOutOfGameZone || _needsRejoin) return false;
    final me = playerId;
    if (me == null || me.isEmpty) return false;
    if (isAnyObjectiveCapturing) return false;
    return _nearestHackableObjectiveIdForPlayer(me) != null;
  }

  bool get isRogueRole => (playerRole ?? '').toUpperCase() == 'ROGUE';

  bool get isAnyObjectiveCapturing =>
      objectives.any((o) => o.state.toUpperCase() == 'CAPTURING');

  int? get rogueCaptureRemainingSeconds {
    if (!isRogueRole || !isAnyObjectiveCapturing) return null;
    final now = DateTime.now().millisecondsSinceEpoch;
    int? remainingMs;
    if (_objectiveCaptureEndAtMs.isNotEmpty) {
      for (final endAt in _objectiveCaptureEndAtMs.values) {
        final remaining = endAt - now;
        if (remainingMs == null || remaining < remainingMs) {
          remainingMs = remaining;
        }
      }
    } else if (_objectiveCaptureSeenAtMs.isNotEmpty) {
      final hackDuration = _configuredHackDurationMs();
      for (final startedAt in _objectiveCaptureSeenAtMs.values) {
        final remaining = (startedAt + hackDuration) - now;
        if (remainingMs == null || remaining < remainingMs) {
          remainingMs = remaining;
        }
      }
    }
    if (remainingMs == null) return null;
    if (remainingMs <= 0) return 0;
    return (remainingMs / 1000).ceil();
  }

  int get configuredHackDurationMs => _configuredHackDurationMs();
  double get configuredAgentTargetingRangeMeters =>
      _configuredAgentTargetingRangeMeters();

  bool get showRogueCaptureInterruptedBanner {
    if (_rogueCaptureInterruptedAtMs == null) return false;
    final now = DateTime.now().millisecondsSinceEpoch;
    return now - _rogueCaptureInterruptedAtMs! <= 2200;
  }

  double get rogueCaptureProgress {
    final remaining = rogueCaptureRemainingSeconds;
    if (remaining == null) return 0;
    final totalMs = configuredHackDurationMs;
    if (totalMs <= 0) return 0;
    final remainingMs = remaining * 1000;
    final progress = 1 - (remainingMs / totalMs);
    if (progress < 0) return 0;
    if (progress > 1) return 1;
    return progress;
  }

  void triggerRogueSpecialAction() {
    if (!canTriggerRogueObjectiveCapture) return;
    final me = playerId;
    if (me == null || me.isEmpty) return;
    if (isAnyObjectiveCapturing) return;
    if (isHost) {
      _handleRogueCaptureRequest(me);
      return;
    }
    _socketService.sendGameAction(<String, dynamic>{
      'type': 'rogue-capture-request',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  String triggerAgentCaptureFromQr(String rawPayload) {
    if (!gameStarted) return 'La partie n\'a pas démarré.';
    if (isOutOfGameZone) return 'Revenez par votre point de sortie.';
    if ((playerRole ?? '').toUpperCase() != 'AGENT') {
      return 'Action réservée aux agents.';
    }
    final dynamic decoded;
    try {
      decoded = jsonDecode(rawPayload);
    } catch (_) {
      return 'QR invalide.';
    }
    if (decoded is! Map) return 'QR invalide.';
    final type = decoded['type']?.toString();
    final scannedCode = decoded['gameCode']?.toString().toUpperCase();
    final targetId = decoded['playerId']?.toString();
    final targetRole = decoded['role']?.toString().toUpperCase();
    final currentCode = (gameCode ?? bootstrap?.lobby.code ?? '').toUpperCase();
    if (type != 'player-vitality-id') return 'QR non reconnu.';
    if (scannedCode != currentCode) return 'QR d\'une autre partie.';
    if (targetId == null || targetId.isEmpty) return 'QR incomplet.';
    if (targetRole != 'ROGUE') return 'Ce joueur n\'est pas un rogue.';
    if (targetId == playerId) return 'Auto-capture impossible.';

    if (isHost) {
      final me = playerId;
      if (me == null || me.isEmpty) return 'Agent introuvable.';
      _handleAgentCaptureRequest(me, targetId);
      return 'Capture envoyée.';
    }

    _socketService.sendGameAction(<String, dynamic>{
      'type': 'agent-capture-request',
      'targetPlayerId': targetId,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
    return 'Capture envoyée.';
  }

  List<GeoPoint> buildPathToRallyPoint() {
    final target = rallyPoint;
    if (!isGameFinished || target == null) return const <GeoPoint>[];
    return _buildGuidancePath(target);
  }

  List<GeoPoint> buildPathToMyStartZone() {
    final target = myStartZone;
    if (target == null) return const <GeoPoint>[];
    return _buildGuidancePath(target);
  }

  List<GeoPoint> buildPathToReentryPoint() {
    final point = reentryPoint;
    return point == null ? const [] : _buildGuidancePath(point);
  }

  List<GeoPoint> _buildGuidancePath(GeoPoint target) {
    final start = myPosition;
    if (start == null) return const <GeoPoint>[];

    final streetNetwork =
        _effectiveGameConfig?.mapStreetNetwork ?? const <List<GeoPoint>>[];
    if (streetNetwork.isNotEmpty) {
      final graphPath = _streetPathFinder.findPath(
        start: start,
        target: target,
        streets: streetNetwork,
      );
      if (graphPath.length >= 2) {
        return graphPath;
      }
    }

    final network =
        _effectiveGameConfig?.mapStreets ??
        bootstrap?.lobby.outerStreetContour ??
        const <GeoPoint>[];
    if (network.length < 2) return <GeoPoint>[start, target];

    final startIdx = _nearestPointIndex(network, start);
    final targetIdx = _nearestPointIndex(network, target);
    if (startIdx == -1 || targetIdx == -1) {
      return <GeoPoint>[start, target];
    }

    final forward = _pathBetweenIndices(network, startIdx, targetIdx, true);
    final backward = _pathBetweenIndices(network, startIdx, targetIdx, false);
    final best = _pathLengthMeters(forward) <= _pathLengthMeters(backward)
        ? forward
        : backward;

    return <GeoPoint>[start, if (best.isNotEmpty) ...best, target];
  }

  int _nearestPointIndex(List<GeoPoint> points, GeoPoint target) {
    var bestIndex = -1;
    var bestDistance = double.infinity;
    for (var i = 0; i < points.length; i++) {
      final p = points[i];
      final d = Geolocator.distanceBetween(
        p.latitude,
        p.longitude,
        target.latitude,
        target.longitude,
      );
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  List<GeoPoint> _pathBetweenIndices(
    List<GeoPoint> points,
    int from,
    int to,
    bool forward,
  ) {
    if (points.isEmpty) return const <GeoPoint>[];
    final path = <GeoPoint>[];
    final n = points.length;
    var idx = from;
    path.add(points[idx]);
    while (idx != to) {
      idx = forward ? (idx + 1) % n : (idx - 1 + n) % n;
      path.add(points[idx]);
      if (path.length > n + 1) break;
    }
    return path;
  }

  double _pathLengthMeters(List<GeoPoint> points) {
    if (points.length < 2) return 0;
    var sum = 0.0;
    for (var i = 1; i < points.length; i++) {
      final a = points[i - 1];
      final b = points[i];
      sum += Geolocator.distanceBetween(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
      );
    }
    return sum;
  }

  bool isPlayerInStartZone(GamePlayer player) {
    if (player.latitude == null || player.longitude == null) return false;
    final zone = _startZoneForRole(player.role);
    if (zone == null) return false;
    final distance = Geolocator.distanceBetween(
      player.latitude!,
      player.longitude!,
      zone.latitude,
      zone.longitude,
    );
    return distance <= startZoneRadiusMeters;
  }

  bool get canHostStartGame {
    if (!isHost || gameStarted) return false;
    final relevant = players
        .where((p) {
          if ((p.status).toLowerCase() == 'disconnected') return false;
          final role = (p.role ?? '').toUpperCase();
          return role == 'AGENT' || role == 'ROGUE';
        })
        .toList(growable: false);
    if (relevant.isEmpty) return false;
    final agents = relevant
        .where((p) => (p.role ?? '').toUpperCase() == 'AGENT')
        .length;
    final rogues = relevant
        .where((p) => (p.role ?? '').toUpperCase() == 'ROGUE')
        .length;
    if (agents < 1 || rogues < 1) return false;
    return relevant.every(isPlayerInStartZone);
  }

  List<GameChatMessage> _parseGameChatMessages(List rawMessages) {
    final relevantMessages = rawMessages.length > _maxGameChatMessages
        ? rawMessages.skip(rawMessages.length - _maxGameChatMessages)
        : rawMessages;
    return relevantMessages
        .whereType<Map>()
        .map((raw) {
          final timestampRaw = raw['timestamp'];
          return GameChatMessage(
            playerId: raw['playerId']?.toString() ?? '',
            playerName: raw['playerName']?.toString() ?? 'Joueur',
            text: raw['text']?.toString() ?? '',
            timestampMs: timestampRaw is int
                ? timestampRaw
                : DateTime.now().millisecondsSinceEpoch,
          );
        })
        .toList(growable: false);
  }

  void _appendChatMessage(List<GameChatMessage> messages, Map payload) {
    messages.add(
      GameChatMessage(
        playerId: payload['playerId']?.toString() ?? '',
        playerName: payload['playerName']?.toString() ?? 'Joueur',
        text: payload['text']?.toString() ?? '',
        timestampMs:
            int.tryParse(payload['timestamp']?.toString() ?? '') ??
            DateTime.now().millisecondsSinceEpoch,
      ),
    );
    if (messages.length > _maxGameChatMessages) {
      messages.removeRange(0, messages.length - _maxGameChatMessages);
    }
  }

  GeoPoint? _parseGeoPoint(dynamic raw) {
    if (raw is! Map) return null;
    return GeoPoint.tryParse(raw['latitude'], raw['longitude']);
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    final pendingPosition = _positionFixCompleter;
    if (pendingPosition != null && !pendingPosition.isCompleted) {
      pendingPosition.complete(null);
    }
    _startCountdownTimer?.cancel();
    _countdownTimer?.cancel();
    _joinWatchdogTimer?.cancel();
    _voiceActivityTimer?.cancel();
    _messagesSub?.cancel();
    _positionSub?.cancel();
    _rogueCaptureInterruptedTimer?.cancel();
    _voiceChatService.dispose();
    if (_backgroundVoiceActive) {
      unawaited(_backgroundService.setVoiceActive(false));
    }
    _socketService.dispose();
    super.dispose();
  }
}

class _WinnerOutcome {
  const _WinnerOutcome({required this.type, required this.reason});

  final String type;
  final String reason;
}
