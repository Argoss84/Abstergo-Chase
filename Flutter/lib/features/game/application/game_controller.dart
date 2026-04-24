import 'dart:async';
import 'dart:convert';

import 'package:abstergo_chase/app/config/app_runtime_config.dart';
import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/game/data/game_socket_service.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/data/player_session_store.dart';
import 'package:abstergo_chase/shared/services/voice_chat_service.dart';
import 'package:abstergo_chase/shared/services/voice_settings_service.dart';
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
    );
  }

  final GameSocketService _socketService;
  late final VoiceChatService _voiceChatService;
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  final VoiceSettingsService _voiceSettingsService = VoiceSettingsService();
  StreamSubscription<Map<String, dynamic>>? _messagesSub;
  StreamSubscription<Position>? _positionSub;
  Timer? _countdownTimer;
  Timer? _joinWatchdogTimer;
  Timer? _voiceActivityTimer;
  Timer? _rogueCaptureInterruptedTimer;

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
  bool canListenOtherRoles = false;
  VoiceTransmissionMode voiceMode = VoiceTransmissionMode.voiceActivation;
  double voiceActivationThreshold = 0.55;
  bool _pushToTalkPressed = false;
  bool convergingPhase = true;
  int? remainingSeconds;
  String? winnerType;
  String? winnerReason;
  int? victoryObjectivesRequired;
  int? startCountdownEndAtMs;
  Timer? _startCountdownTimer;
  bool isOutOfGameZone = false;
  final List<GamePlayer> players = <GamePlayer>[];
  final List<GameObjective> objectives = <GameObjective>[];
  final List<GameChatMessage> roleChat = <GameChatMessage>[];
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
  int _turnExpiresAtMs = 0;
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
    return 900;
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

  Future<void> initialize(GameBootstrapData data) async {
    bootstrap = data;
    gameCode = data.codeOverride ?? data.lobby.code;
    playerId = data.playerId;
    remainingSeconds = _configuredDurationSeconds();
    winnerType = null;
    winnerReason = null;
    final required = data.lobby.form?.victoryConditionObjectives;
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
          );
        }),
      );
    playerRole = players.where((p) => p.id == playerId).isNotEmpty
        ? players.firstWhere((p) => p.id == playerId).role
        : null;
    isHost = players.any((p) => p.id == playerId && p.isHost);
    _bootstrapObjectives(data);

    isLoading = true;
    error = null;
    connectionStatus = 'connecting';
    notifyListeners();

    try {
      final voiceSettings = await _voiceSettingsService.load();
      isVoiceChatEnabled = voiceSettings.enabled;
      voiceMode = voiceSettings.mode;
      voiceActivationThreshold = voiceSettings.activationThreshold;
      await _socketService.connect(
        serverUrl: Uri.parse(data.lobby.serverUrl),
        socketPath: data.lobby.socketPath,
      );
      _messagesSub?.cancel();
      _messagesSub = _socketService.messages.listen(_onMessage);
      _startJoinWatchdog();
      _sendJoinGame();
      await _startPositionTracking();
      await _syncVoiceState();
      _startVoiceActivityTimer();
      connectionStatus = _hasJoinedGame ? 'connected' : 'connecting';
      isLoading = false;
      notifyListeners();
    } catch (e) {
      error = e.toString();
      connectionStatus = 'error';
      isLoading = false;
      notifyListeners();
    }
  }

  void _bootstrapObjectives(GameBootstrapData data) {
    objectives
      ..clear()
      ..addAll(
        data.lobby.objectives.asMap().entries.map((entry) {
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
    if (!serviceEnabled) return;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return;
    }
    _positionSub?.cancel();
    _positionSub =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 5,
          ),
        ).listen((position) {
          final previousPosition = myPosition;
          final previousOutOfZone = isOutOfGameZone;
          final nextPosition = GeoPoint(
            latitude: position.latitude,
            longitude: position.longitude,
          );
          myPosition = nextPosition;
          isOutOfGameZone = !_isMyPositionInsideGameZone();
          var playerPositionChanged = false;
          final idx = players.indexWhere((p) => p.id == playerId);
          if (idx != -1) {
            playerPositionChanged =
                players[idx].latitude != position.latitude ||
                players[idx].longitude != position.longitude;
            players[idx] = players[idx].copyWith(
              latitude: position.latitude,
              longitude: position.longitude,
            );
          }
          _publishPositionIfDue(position.latitude, position.longitude);
          if (!_samePoint(previousPosition, nextPosition) ||
              previousOutOfZone != isOutOfGameZone ||
              playerPositionChanged) {
            notifyListeners();
          }
        });
  }

  bool _isMyPositionInsideGameZone() {
    final pos = myPosition;
    if (pos == null) return true;
    final contour =
        _effectiveGameConfig?.mapStreets ?? bootstrap?.lobby.outerStreetContour;
    final polygon = _sanitizeContour(contour ?? const <GeoPoint>[]);
    if (polygon.length < 3) return true;
    return _isPointInPolygon(pos, polygon);
  }

  List<GeoPoint> _sanitizeContour(List<GeoPoint> contour) {
    if (contour.length < 3) return const <GeoPoint>[];
    final open = <GeoPoint>[...contour];
    final first = open.first;
    final last = open.last;
    final closeMeters = Geolocator.distanceBetween(
      first.latitude,
      first.longitude,
      last.latitude,
      last.longitude,
    );
    if (closeMeters < 2) {
      open.removeLast();
    }
    return open.length >= 3 ? open : const <GeoPoint>[];
  }

  bool _isPointInPolygon(GeoPoint point, List<GeoPoint> polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      final xi = polygon[i].longitude;
      final yi = polygon[i].latitude;
      final xj = polygon[j].longitude;
      final yj = polygon[j].latitude;
      final intersects =
          ((yi > point.latitude) != (yj > point.latitude)) &&
          (point.longitude <
              (xj - xi) *
                      (point.latitude - yi) /
                      ((yj - yi).abs() < 1e-12 ? 1e-12 : (yj - yi)) +
                  xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  void _publishPositionIfDue(double latitude, double longitude) {
    if (!_hasJoinedGame || connectionStatus != 'connected') return;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastPositionPublishMs < realtimeRefreshIntervalMs) return;
    _lastPositionPublishMs = now;
    if (isHost) {
      _pushSnapshotThrottled();
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
      notifyListeners();
    });
    _pushSnapshot();
    notifyListeners();
  }

  void _beginGameNow() {
    if (!isHost) return;
    gameStarted = true;
    convergingPhase = false;
    // Always start from configured duration, never from stale pre-start sync.
    final configured = _configuredDurationSeconds();
    remainingSeconds = configured > 0 ? configured : 900;
    // Broadcast the initial shared countdown value immediately.
    _socketService.updateRemainingTime(
      remaining: remainingSeconds!,
      countdownStarted: true,
    );
    _startTimer();
    _pushSnapshot();
    notifyListeners();
  }

  void _startTimer() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!isHost || remainingSeconds == null) return;
      if (remainingSeconds! <= 0) {
        _countdownTimer?.cancel();
        winnerType ??= 'AGENT';
        winnerReason ??= 'TIMEOUT';
        gameStarted = false;
        convergingPhase = false;
        _socketService.updateRemainingTime(
          remaining: 0,
          countdownStarted: false,
        );
        _pushSnapshot();
        notifyListeners();
        return;
      }
      remainingSeconds = remainingSeconds! - 1;
      _socketService.updateRemainingTime(
        remaining: remainingSeconds!,
        countdownStarted: true,
      );
      if (remainingSeconds! == 0) {
        _countdownTimer?.cancel();
        winnerType ??= 'AGENT';
        winnerReason ??= 'TIMEOUT';
        gameStarted = false;
        convergingPhase = false;
        _socketService.updateRemainingTime(
          remaining: 0,
          countdownStarted: false,
        );
        _pushSnapshot();
        notifyListeners();
        return;
      }
      if (remainingSeconds! % 2 == 0) {
        _pushSnapshot();
      }
      _tickObjectiveCapturesIfHost();
      _evaluateWinConditionsIfHost();
      notifyListeners();
    });
  }

  void _onMessage(Map<String, dynamic> event) {
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
        _hasJoinedGame = false;
        _lastJoinAttemptMs = 0;
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
            isHost = playerId == newHost;
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
            if (oldId != null && oldId.isNotEmpty && oldId != id) {
              players.removeWhere((p) => p.id == oldId);
            }
            final idx = players.indexWhere((p) => p.id == id);
            final role = payload['role']?.toString();
            final status = payload['status']?.toString() ?? 'active';
            final name = payload['playerName']?.toString() ?? 'Joueur';
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
            if (idx == -1) {
              players.add(
                GamePlayer(
                  id: id,
                  name: name,
                  isHost: false,
                  role: role,
                  status: status,
                ),
              );
            } else {
              players[idx] = players[idx].copyWith(
                name: name,
                role: role ?? players[idx].role,
                status: status,
              );
            }
            _dedupePlayers();
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
          if (roleChat.length > 150) {
            roleChat.removeRange(0, roleChat.length - 150);
          }
          notifyListeners();
        }
        return;
      case 'game:error':
      case 'game:action-rejected':
        _joinInFlight = false;
        final msg = payload?.toString() ?? 'Erreur game';
        if (msg.contains('Partie introuvable pour action') && !_hasJoinedGame) {
          return;
        }
        error = msg;
        connectionStatus = _hasJoinedGame ? 'connected' : 'error';
        notifyListeners();
        return;
      case 'game:closed':
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
    if (joinedPlayerId != null && joinedPlayerId.isNotEmpty) {
      playerId = joinedPlayerId;
    }
    if (host != null) {
      isHost = host == playerId;
    }
    if (game is Map && game['players'] is List) {
      players
        ..clear()
        ..addAll(
          (game['players'] as List).whereType<Map>().map((raw) {
            return GamePlayer(
              id: raw['id']?.toString() ?? '',
              name: raw['name']?.toString() ?? 'Joueur',
              isHost: raw['isHost'] == true,
              role: raw['role']?.toString(),
              status: raw['status']?.toString() ?? 'active',
            );
          }),
        );
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
    if (!_requestedInitialSync) {
      _requestedInitialSync = true;
      _socketService.requestGameSync();
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
        final lat = double.tryParse(raw['latitude']?.toString() ?? '');
        final lng = double.tryParse(raw['longitude']?.toString() ?? '');
        if (lat == null || lng == null) continue;
        next.add(
          GameObjective(
            id: raw['id_prop']?.toString() ?? 'obj-${i + 1}',
            point: GeoPoint(latitude: lat, longitude: lng),
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
        final lat = double.tryParse(raw['latitude']?.toString() ?? '');
        final lng = double.tryParse(raw['longitude']?.toString() ?? '');
        final status = raw['status']?.toString();
        final role = raw.containsKey('role') ? raw['role']?.toString() : null;
        final name =
            raw['displayName']?.toString() ??
            raw['name']?.toString() ??
            'Joueur';
        if (idx != -1) {
          players[idx] = players[idx].copyWith(
            name: name,
            role: role ?? players[idx].role,
            latitude: lat ?? players[idx].latitude,
            longitude: lng ?? players[idx].longitude,
            status: status ?? players[idx].status,
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
    }
  }

  void _dedupePlayers() {
    if (players.length < 2) return;
    final selfId = playerId;
    final byId = <String, GamePlayer>{};
    for (final p in players) {
      if (p.id.isEmpty) continue;
      byId[p.id] = p;
    }
    var next = byId.values.toList(growable: false);

    // Dedupe by (name, role) to reduce reconnection artifacts.
    final grouped = <String, List<GamePlayer>>{};
    for (final p in next) {
      final key = '${p.name.toLowerCase()}|${(p.role ?? '').toUpperCase()}';
      (grouped[key] ??= <GamePlayer>[]).add(p);
    }
    final deduped = <GamePlayer>[];
    for (final entry in grouped.entries) {
      final list = entry.value;
      if (list.length == 1) {
        deduped.add(list.first);
        continue;
      }
      list.sort((a, b) {
        // Prefer keeping the local player entry when duplicated.
        if (selfId != null && selfId.isNotEmpty) {
          final aIsSelf = a.id == selfId;
          final bIsSelf = b.id == selfId;
          if (aIsSelf != bIsSelf) return aIsSelf ? -1 : 1;
        }
        final aDisc = a.status.toLowerCase() == 'disconnected';
        final bDisc = b.status.toLowerCase() == 'disconnected';
        if (aDisc != bDisc) return aDisc ? 1 : -1;
        // Prefer active over captured.
        final aCap = a.status.toUpperCase() == 'CAPTURED';
        final bCap = b.status.toUpperCase() == 'CAPTURED';
        if (aCap != bCap) return aCap ? 1 : -1;
        final aPos = (a.latitude != null && a.longitude != null) ? 0 : 1;
        final bPos = (b.latitude != null && b.longitude != null) ? 0 : 1;
        if (aPos != bPos) return aPos - bPos;
        return 0;
      });
      deduped.add(list.first);
    }
    players
      ..clear()
      ..addAll(deduped);
  }

  void _pushSnapshot({String? targetId}) {
    if (!isHost) return;
    // Ensure host also updates its local winner state.
    _ensureWinnerFieldsIfAny();
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
        };
      }).toList(),
      'players': players.map((p) {
        return <String, dynamic>{
          'id_player': p.id,
          'role': p.role,
          'status': p.status,
          'latitude': p.latitude,
          'longitude': p.longitude,
          'displayName': p.name,
        };
      }).toList(),
      'gameDetails': <String, dynamic>{
        'winner_type': winnerType,
        'winner_reason': winnerReason,
        'victory_objectives_required':
            victoryObjectivesRequired ??
            bootstrap?.lobby.form?.victoryConditionObjectives,
        'start_countdown_end_at_ms': startCountdownEndAtMs,
      },
    };
    _socketService.pushState(state: payload, targetId: targetId);
  }

  void _ensureWinnerFieldsIfAny() {
    if (winnerType != null && winnerType!.isNotEmpty) return;
    final outcome = _winnerOutcomeIfAny();
    if (outcome == null) return;
    winnerType = outcome.type;
    winnerReason = outcome.reason;
  }

  _WinnerOutcome? _winnerOutcomeIfAny() {
    // Rogue wins by capturing enough objectives.
    final captured = objectives.where((o) => o.captured).length;
    final required =
        bootstrap?.lobby.form?.victoryConditionObjectives ?? objectives.length;
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
    final lat = double.tryParse(action['latitude']?.toString() ?? '');
    final lng = double.tryParse(action['longitude']?.toString() ?? '');
    if (lat == null || lng == null) return;
    final idx = players.indexWhere((p) => p.id == fromId);
    if (idx == -1) return;
    players[idx] = players[idx].copyWith(latitude: lat, longitude: lng);
    _pushSnapshotThrottled();
    _tickObjectiveCapturesIfHost();
    notifyListeners();
  }

  void _handleRogueCaptureRequest(String roguePlayerId) {
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
    if ((target.role ?? '').toUpperCase() != 'ROGUE') return;
    if (target.status.toUpperCase() == 'CAPTURED') return;
    if (target.status.toLowerCase() == 'disconnected') return;
    players[targetIdx] = target.copyWith(status: 'CAPTURED');
    _pushSnapshot();
    _evaluateWinConditionsIfHost();
    notifyListeners();
  }

  String? _nearestHackableObjectiveIdForPlayer(String playerIdToCheck) {
    final p = players
        .where((p) => p.id == playerIdToCheck)
        .toList(growable: false);
    if (p.isEmpty) return null;
    final player = p.first;
    if ((player.role ?? '').toUpperCase() != 'ROGUE') return null;
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

  void _tickObjectiveCapturesIfHost() {
    if (!isHost || _objectiveCaptureEndAtMs.isEmpty) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    var changed = false;
    final interruptedIds = <String>[];
    for (final entry in _objectiveCaptureEndAtMs.entries) {
      final objectiveId = entry.key;
      final rogueId = _objectiveCaptureRogueByObjectiveId[objectiveId];
      if (rogueId == null || rogueId.isEmpty) continue;
      final stillInRangeObjective = _nearestHackableObjectiveIdForPlayer(
        rogueId,
      );
      if (stillInRangeObjective != objectiveId) {
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
    final doneIds = <String>[];
    for (final entry in _objectiveCaptureEndAtMs.entries) {
      if (entry.value > now) continue;
      doneIds.add(entry.key);
    }
    for (final id in doneIds) {
      _objectiveCaptureEndAtMs.remove(id);
      _objectiveCaptureSeenAtMs.remove(id);
      _objectiveCaptureRogueByObjectiveId.remove(id);
      final idx = objectives.indexWhere((o) => o.id == id);
      if (idx == -1) continue;
      final objective = objectives[idx];
      if (objective.captured) continue;
      objectives[idx] = objective.copyWith(state: 'CAPTURED');
      changed = true;
    }
    if (changed) {
      _pushSnapshot();
      _evaluateWinConditionsIfHost();
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
      gameStarted = false;
      convergingPhase = false;
      _countdownTimer?.cancel();
      _socketService.updateRemainingTime(remaining: 0, countdownStarted: false);
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
      previousPlayerId: (playerId != null && playerId!.isNotEmpty)
          ? playerId
          : data.lobby.previousPlayerId,
    );
  }

  void _startJoinWatchdog() {
    _joinWatchdogTimer?.cancel();
    _joinWatchdogTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (_hasJoinedGame) return;
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
    if (player.status == 'CAPTURED') return false;
    final me = (playerRole ?? '').toUpperCase();
    final targetRole = (player.role ?? '').toUpperCase();
    if (me == 'ROGUE') {
      return targetRole == 'AGENT';
    }
    if (me == 'AGENT') {
      return targetRole == 'AGENT';
    }
    return true;
  }

  bool isPlayerAudibleForCurrentRole(GamePlayer player) {
    if (!isVoiceChatEnabled) return false;
    if (player.id == playerId) return false;
    final statusUpper = player.status.toUpperCase();
    if (statusUpper == 'CAPTURED' || statusUpper == 'DISCONNECTED')
      return false;
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

  List<GamePlayer> get sameRoleVoicePlayers {
    final me = (playerRole ?? '').toUpperCase();
    if (me.isEmpty) return const <GamePlayer>[];
    return players
        .where((p) => p.id != playerId)
        .where((p) => p.status.toLowerCase() != 'disconnected')
        .where((p) => (p.role ?? '').toUpperCase() == me)
        .toList(growable: false);
  }

  Future<void> toggleVoiceChatEnabled() async {
    final settings = await _voiceSettingsService.load();
    if (!settings.enabled) {
      isVoiceChatEnabled = false;
      _pushToTalkPressed = false;
      await _voiceChatService.disable();
      notifyListeners();
      return;
    }
    isVoiceChatEnabled = !isVoiceChatEnabled;
    if (!isVoiceChatEnabled) {
      _pushToTalkPressed = false;
    }
    await _syncVoiceState();
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

  Future<void> _syncVoiceState() async {
    try {
      final me = playerId;
      if (me == null || me.isEmpty || !isVoiceChatEnabled) {
        await _voiceChatService.disable();
        return;
      }
      await _refreshTurnIfNeeded();
      final peers = players
          .where((p) => isPlayerAudibleForCurrentRole(p))
          .map((p) => p.id)
          .toList();
      await _voiceChatService.enable(selfId: me, peerIds: peers);
      await _applyTransmissionGate();
    } catch (_) {
      isVoiceChatEnabled = false;
      await _voiceChatService.disable();
    }
  }

  Future<void> refreshVoiceSettings() async {
    final settings = await _voiceSettingsService.load();
    isVoiceChatEnabled = settings.enabled;
    voiceMode = settings.mode;
    voiceActivationThreshold = settings.activationThreshold;
    if (!isVoiceChatEnabled) {
      _pushToTalkPressed = false;
      await _voiceChatService.disable();
      notifyListeners();
      return;
    }
    await _applyTransmissionGate();
    notifyListeners();
  }

  Future<void> setPushToTalkPressed(bool pressed) async {
    if (_pushToTalkPressed == pressed) return;
    _pushToTalkPressed = pressed;
    await _applyTransmissionGate();
    notifyListeners();
  }

  Future<void> _applyTransmissionGate() async {
    if (!isVoiceChatEnabled) {
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
    if (creds == null || creds.urls.isEmpty) return;
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
    if (!gameStarted) return false;
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
    if (!isRogueRole || !gameStarted) return;
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

  List<GeoPoint> buildPathToMyStartZone() {
    final start = myPosition;
    final target = myStartZone;
    if (start == null || target == null) return const <GeoPoint>[];

    final streetNetwork =
        _effectiveGameConfig?.mapStreetNetwork ?? const <List<GeoPoint>>[];
    if (streetNetwork.isNotEmpty) {
      final graphPath = _shortestPathOnStreetNetwork(
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

  List<GeoPoint> _shortestPathOnStreetNetwork({
    required GeoPoint start,
    required GeoPoint target,
    required List<List<GeoPoint>> streets,
  }) {
    final nodes = <GeoPoint>[];
    final nodeIndexByKey = <String, int>{};
    final adjacency = <int, Map<int, double>>{};

    int ensureNode(GeoPoint p) {
      final key =
          '${p.latitude.toStringAsFixed(6)},${p.longitude.toStringAsFixed(6)}';
      final existing = nodeIndexByKey[key];
      if (existing != null) return existing;
      final idx = nodes.length;
      nodes.add(p);
      nodeIndexByKey[key] = idx;
      adjacency[idx] = <int, double>{};
      return idx;
    }

    void addEdge(int a, int b) {
      if (a == b) return;
      final pa = nodes[a];
      final pb = nodes[b];
      final distance = Geolocator.distanceBetween(
        pa.latitude,
        pa.longitude,
        pb.latitude,
        pb.longitude,
      );
      final existingAB = adjacency[a]![b];
      if (existingAB == null || distance < existingAB) {
        adjacency[a]![b] = distance;
      }
      final existingBA = adjacency[b]![a];
      if (existingBA == null || distance < existingBA) {
        adjacency[b]![a] = distance;
      }
    }

    for (final street in streets) {
      if (street.length < 2) continue;
      var previous = ensureNode(street.first);
      for (var i = 1; i < street.length; i++) {
        final current = ensureNode(street[i]);
        addEdge(previous, current);
        previous = current;
      }
    }
    if (nodes.length < 2) return const <GeoPoint>[];

    final startNode = _nearestNodeIndex(nodes, start);
    final targetNode = _nearestNodeIndex(nodes, target);
    if (startNode == -1 || targetNode == -1) return const <GeoPoint>[];

    final distances = <int, double>{};
    final previous = <int, int>{};
    final visited = <int>{};
    for (var i = 0; i < nodes.length; i++) {
      distances[i] = double.infinity;
    }
    distances[startNode] = 0;

    while (visited.length < nodes.length) {
      int? current;
      var currentDistance = double.infinity;
      for (var i = 0; i < nodes.length; i++) {
        if (visited.contains(i)) continue;
        final d = distances[i] ?? double.infinity;
        if (d < currentDistance) {
          currentDistance = d;
          current = i;
        }
      }
      if (current == null || currentDistance == double.infinity) break;
      if (current == targetNode) break;
      visited.add(current);

      final neighbors = adjacency[current] ?? const <int, double>{};
      for (final entry in neighbors.entries) {
        final next = entry.key;
        if (visited.contains(next)) continue;
        final candidate = currentDistance + entry.value;
        if (candidate < (distances[next] ?? double.infinity)) {
          distances[next] = candidate;
          previous[next] = current;
        }
      }
    }

    if ((distances[targetNode] ?? double.infinity) == double.infinity) {
      return const <GeoPoint>[];
    }

    final reversePath = <GeoPoint>[nodes[targetNode]];
    var cursor = targetNode;
    while (cursor != startNode) {
      final prev = previous[cursor];
      if (prev == null) break;
      cursor = prev;
      reversePath.add(nodes[cursor]);
    }
    final pathOnStreets = reversePath.reversed.toList(growable: false);
    return <GeoPoint>[start, ...pathOnStreets, target];
  }

  int _nearestNodeIndex(List<GeoPoint> nodes, GeoPoint target) {
    var best = -1;
    var bestDistance = double.infinity;
    for (var i = 0; i < nodes.length; i++) {
      final p = nodes[i];
      final d = Geolocator.distanceBetween(
        p.latitude,
        p.longitude,
        target.latitude,
        target.longitude,
      );
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
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
    return relevant.every(isPlayerInStartZone);
  }

  @override
  void dispose() {
    _startCountdownTimer?.cancel();
    _countdownTimer?.cancel();
    _joinWatchdogTimer?.cancel();
    _voiceActivityTimer?.cancel();
    _messagesSub?.cancel();
    _positionSub?.cancel();
    _rogueCaptureInterruptedTimer?.cancel();
    _voiceChatService.dispose();
    _socketService.dispose();
    super.dispose();
  }
}

class _WinnerOutcome {
  const _WinnerOutcome({required this.type, required this.reason});

  final String type;
  final String reason;
}
