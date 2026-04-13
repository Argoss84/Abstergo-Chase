import 'dart:async';

import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/game/data/game_socket_service.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
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
  StreamSubscription<Map<String, dynamic>>? _messagesSub;
  StreamSubscription<Position>? _positionSub;
  Timer? _countdownTimer;

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
  GeoPoint? myPosition;
  int realtimeRefreshIntervalMs = 1000;
  int _lastPositionPublishMs = 0;
  int _lastSnapshotPushMs = 0;
  bool _hasJoinedGame = false;
  bool _needsRejoin = false;
  bool _joinInFlight = false;
  bool _requestedInitialSync = false;

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
    playerRole = players
        .firstWhere((p) => p.id == playerId, orElse: () => players.first)
        .role;
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
      _sendJoinGame();
      await _startPositionTracking();
      connectionStatus = 'connected';
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

  void setRealtimeRefreshIntervalMs(int value) {
    realtimeRefreshIntervalMs = value.clamp(300, 5000);
    notifyListeners();
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
    remainingSeconds ??= bootstrap?.lobby.form?.duration ?? 900;
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
        return;
      }
      remainingSeconds = remainingSeconds! - 1;
      _socketService.updateRemainingTime(
        remaining: remainingSeconds!,
        countdownStarted: true,
      );
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
        }
        return;
      case 'socket:connected':
        connectionStatus = 'connected';
        if (_needsRejoin && !_joinInFlight) {
          _sendJoinGame();
        }
        notifyListeners();
        return;
      case 'socket:disconnected':
        _needsRejoin = true;
        _joinInFlight = false;
        _hasJoinedGame = false;
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
            gameStarted = true;
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
        final msg = payload?.toString() ?? 'Erreur game';
        if (msg.contains('Partie introuvable pour action') && !_hasJoinedGame) {
          return;
        }
        error = msg;
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
    final me = players.where((p) => p.id == playerId);
    playerRole = me.isEmpty ? null : me.first.role;
    if (host != null) {
      isHost = host == playerId;
    } else {
      isHost = players.any((p) => p.id == playerId && p.isHost);
    }
    gameCode = payload['code']?.toString() ?? gameCode;
    _hasJoinedGame = true;
    _needsRejoin = false;
    _joinInFlight = false;
    connectionStatus = 'connected';
    if (!_requestedInitialSync) {
      _requestedInitialSync = true;
      _socketService.requestGameSync();
    }
  }

  void _applyStateSync(Map payload) {
    gameStarted = payload['started'] == true || payload['countdown_started'] == true;
    convergingPhase = payload['is_converging_phase'] == true;
    remainingSeconds = int.tryParse(payload['remaining_time']?.toString() ?? '') ??
        remainingSeconds;
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
    _joinInFlight = true;
    _socketService.joinGame(
      code: code,
      playerName: data.lobby.playerName,
      previousPlayerId: playerId,
    );
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

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _messagesSub?.cancel();
    _positionSub?.cancel();
    _socketService.dispose();
    super.dispose();
  }
}
