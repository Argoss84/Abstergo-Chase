import 'dart:async';

import 'package:abstergo_chase/app/config/app_runtime_config.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/game/data/game_socket_service.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/data/player_session_store.dart';
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
      : _socketService = socketService ?? GameSocketService();

  final GameSocketService _socketService;
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  StreamSubscription<Map<String, dynamic>>? _messagesSub;
  StreamSubscription<Position>? _positionSub;
  Timer? _countdownTimer;
  Timer? _joinWatchdogTimer;

  bool isLoading = true;
  String? error;
  String connectionStatus = 'idle';
  GameBootstrapData? bootstrap;
  String? gameCode;
  String? playerId;
  String? playerRole;
  bool isHost = false;
  bool gameStarted = false;
  bool convergingPhase = true;
  int? remainingSeconds;
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

  LobbyGameConfig? get _effectiveGameConfig => liveGameConfig ?? bootstrap?.gameConfig;

  int _configuredDurationSeconds() {
    final fromForm = bootstrap?.lobby.form?.duration;
    if (fromForm != null && fromForm > 0) return fromForm;
    final fromConfig = _effectiveGameConfig?.durationSeconds;
    if (fromConfig != null && fromConfig > 0) return fromConfig;
    return 900;
  }

  Future<void> initialize(GameBootstrapData data) async {
    bootstrap = data;
    gameCode = data.codeOverride ?? data.lobby.code;
    playerId = data.playerId;
    players
      ..clear()
      ..addAll(data.players.map((p) {
        return GamePlayer(
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          role: p.role,
          status: p.status,
        );
      }));
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
      await _socketService.connect(
        serverUrl: Uri.parse(data.lobby.serverUrl),
        socketPath: data.lobby.socketPath,
      );
      _messagesSub?.cancel();
      _messagesSub = _socketService.messages.listen(_onMessage);
      _startJoinWatchdog();
      _sendJoinGame();
      await _startPositionTracking();
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
    _positionSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
      ),
    ).listen((position) {
      myPosition = GeoPoint(
        latitude: position.latitude,
        longitude: position.longitude,
      );
      final idx = players.indexWhere((p) => p.id == playerId);
      if (idx != -1) {
        players[idx] = players[idx].copyWith(
          latitude: position.latitude,
          longitude: position.longitude,
        );
      }
      _publishPositionIfDue(position.latitude, position.longitude);
      notifyListeners();
    });
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
    gameStarted = true;
    convergingPhase = false;
    // Always start from configured duration, never from stale pre-start sync.
    remainingSeconds = _configuredDurationSeconds();
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
              players[i] = players[i].copyWith(isHost: players[i].id == newHost);
            }
            isHost = playerId == newHost;
            notifyListeners();
          }
        }
        return;
      case 'game:peer-left':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null) {
            players.removeWhere((p) => p.id == id);
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
              _evaluateWinConditionsIfHost();
              notifyListeners();
            }
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
              timestampMs: int.tryParse(payload['timestamp']?.toString() ?? '') ??
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
        ..addAll((game['players'] as List).whereType<Map>().map((raw) {
          return GamePlayer(
            id: raw['id']?.toString() ?? '',
            name: raw['name']?.toString() ?? 'Joueur',
            isHost: raw['isHost'] == true,
            role: raw['role']?.toString(),
            status: raw['status']?.toString() ?? 'active',
          );
        }));
    }
    if (game is Map) {
      final serverRemaining = int.tryParse(
        game['remainingTimeSeconds']?.toString() ?? '',
      );
      if (serverRemaining != null) {
        remainingSeconds = serverRemaining;
      }
    }
    final gameConfigRaw = game is Map ? game['config'] : null;
    if (gameConfigRaw is Map) {
      liveGameConfig = LobbyGameConfig.fromMap(
        Map<String, dynamic>.from(gameConfigRaw),
      );
    }
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
    gameStarted = payload['started'] == true || payload['countdown_started'] == true;
    convergingPhase = payload['is_converging_phase'] == true;
    final syncedRemaining =
        int.tryParse(payload['remaining_time']?.toString() ?? '');
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
      }
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

  void _pushSnapshot({String? targetId}) {
    if (!isHost) return;
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
        'winner_type': _winnerTypeIfAny(),
      },
    };
    _socketService.pushState(state: payload, targetId: targetId);
  }

  void _pushSnapshotThrottled({String? targetId}) {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (targetId == null && now - _lastSnapshotPushMs < realtimeRefreshIntervalMs) {
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
    if (type != 'position-update') return;
    final lat = double.tryParse(action['latitude']?.toString() ?? '');
    final lng = double.tryParse(action['longitude']?.toString() ?? '');
    if (lat == null || lng == null) return;
    final idx = players.indexWhere((p) => p.id == fromId);
    if (idx == -1) return;
    players[idx] = players[idx].copyWith(
      latitude: lat,
      longitude: lng,
    );
    _pushSnapshotThrottled();
    notifyListeners();
  }

  String? _winnerTypeIfAny() {
    final roguePlayers = players.where((p) => (p.role ?? '').toUpperCase() == 'ROGUE');
    if (roguePlayers.isNotEmpty && roguePlayers.every((p) => p.status == 'CAPTURED')) {
      return 'AGENT';
    }
    final captured = objectives.where((o) => o.captured).length;
    final required = bootstrap?.lobby.form?.victoryConditionObjectives ?? objectives.length;
    if (required > 0 && captured >= required) {
      return 'ROGUE';
    }
    return null;
  }

  void _evaluateWinConditionsIfHost() {
    if (!isHost) return;
    final winner = _winnerTypeIfAny();
    if (winner != null) {
      remainingSeconds = 0;
      _pushSnapshot();
    }
  }

  void sendRoleChat(String text) {
    final role = playerRole ?? 'AGENT';
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    roleChat.add(
      GameChatMessage(
        playerId: playerId ?? '',
        playerName: bootstrap?.lobby.playerName ?? 'Moi',
        text: trimmed,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    if (roleChat.length > 150) {
      roleChat.removeRange(0, roleChat.length - 150);
    }
    notifyListeners();
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
      previousPlayerId:
          (playerId != null && playerId!.isNotEmpty)
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

  int get startZoneRadiusMeters {
    return _effectiveGameConfig?.objectiveZoneRadius ??
        bootstrap?.lobby.form?.objectiveZoneRadius ??
        50;
  }

  GeoPoint? _startZoneForRole(String? role) {
    final upper = (role ?? '').toUpperCase();
    if (upper == 'ROGUE') {
      return _effectiveGameConfig?.rogueStartZone ?? bootstrap?.lobby.rogueStartZone;
    }
    if (upper == 'AGENT') {
      return _effectiveGameConfig?.startZone ?? bootstrap?.lobby.agentStartZone;
    }
    return null;
  }

  GeoPoint? get myStartZone => _startZoneForRole(playerRole);

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

    final network = _effectiveGameConfig?.mapStreets ??
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

    return <GeoPoint>[
      start,
      if (best.isNotEmpty) ...best,
      target,
    ];
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
      final key = '${p.latitude.toStringAsFixed(6)},${p.longitude.toStringAsFixed(6)}';
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
    return <GeoPoint>[
      start,
      ...pathOnStreets,
      target,
    ];
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
    final relevant = players.where((p) {
      if ((p.status).toLowerCase() == 'disconnected') return false;
      final role = (p.role ?? '').toUpperCase();
      return role == 'AGENT' || role == 'ROGUE';
    }).toList(growable: false);
    if (relevant.isEmpty) return false;
    return relevant.every(isPlayerInStartZone);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _joinWatchdogTimer?.cancel();
    _messagesSub?.cancel();
    _positionSub?.cancel();
    _socketService.dispose();
    super.dispose();
  }
}
