import 'dart:async';
import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/shared/services/voice_chat_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:broken_veil_protocol/shared/utils/signaling_error_message.dart';
import 'package:flutter/foundation.dart';

class LobbyController extends ChangeNotifier {
  LobbyController({
    LobbySocketService? socketService,
    PlayerSessionStore? playerSessionStore,
  }) : _socketService = socketService ?? LobbySocketService(),
       _playerSessionStore = playerSessionStore ?? PlayerSessionStore() {
    _voiceChatService = VoiceChatService(
      signalSender: (targetId, signal) {
        return _socketService.sendWebRtcSignal(
          targetId: targetId,
          signal: signal,
        );
      },
      onVoiceActivity: _handleVoiceActivitySignal,
    );
  }

  final LobbySocketService _socketService;
  final PlayerSessionStore _playerSessionStore;
  late final VoiceChatService _voiceChatService;
  final VoiceSettingsService _voiceSettingsService = VoiceSettingsService();
  StreamSubscription<Map<String, dynamic>>? _messagesSub;

  bool isLoading = true;
  String? error;
  String? lobbyCode;
  String? playerId;
  bool isHost = false;
  bool gameStarted = false;
  LobbyGameConfig? gameConfig;
  final List<LobbyPlayer> players = <LobbyPlayer>[];
  final List<LobbyChatMessage> chatMessages = <LobbyChatMessage>[];
  String connectionStatus = 'idle';
  bool isVoiceChatEnabled = true;
  bool _isMicrophoneMuted = false;
  bool get isMicrophoneEnabled => isVoiceChatEnabled && !_isMicrophoneMuted;
  LobbyBootstrapData? bootstrapData;
  final List<String> objectiveNames = <String>[];
  bool shouldOpenGameForCode = false;
  int _turnExpiresAtMs = 0;
  final Map<String, int> _voiceActiveSeenAtMs = <String, int>{};
  Timer? _voiceActivityGcTimer;
  Timer? _disconnectRecoveryTimer;
  Timer? _resyncHeartbeatTimer;
  bool _isBindingSession = false;
  bool _isRecoveringSession = false;
  int _recoveryAttempts = 0;
  static const Duration _resyncHeartbeatInterval = Duration(seconds: 8);

  static const List<String> _objectiveNamePool = <String>[
    'Serveur de donnees',
    'Cache secret',
    'Base de repli',
    'Point de contact',
    'Relais de communication',
    'Coffre-fort numerique',
    'Zone d\'extraction',
    'Poste de commande',
    'Antenne relais',
    'Bunker cache',
    'Centre de controle',
    'Depot securise',
    'Point de rendez-vous',
    'Station d\'ecoute',
    'Archive confidentielle',
    'Terminal de liaison',
    'Refuge temporaire',
    'Noeud de reseau',
    'Salle des serveurs',
    'Point de chute',
  ];
  static const List<String> _lobbyNotFoundMarkers = <String>[
    'lobby introuvable',
    'lobby not found',
  ];
  static const int _maxLobbyChatMessages = 100;

  Future<void> initialize({required LobbyBootstrapData bootstrap}) async {
    bootstrapData = bootstrap;
    lobbyCode = bootstrap.code.toUpperCase();
    isLoading = true;
    error = null;
    connectionStatus = 'connecting';
    shouldOpenGameForCode = false;
    notifyListeners();

    _messagesSub?.cancel();
    _messagesSub = _socketService.messages.listen(_onMessage);

    try {
      await _bindToLobby(bootstrap, isInitial: true);
      _regenerateObjectiveNames();
      final voiceSettings = await _voiceSettingsService.load();
      isVoiceChatEnabled = voiceSettings.enabled;
      isLoading = false;
      notifyListeners();
      // Keep lobby join UX responsive even if microphone permission stalls.
      _syncVoiceState();
      _startVoiceActivityGcTimer();
      _startResyncHeartbeat();
    } catch (e) {
      error = e.toString();
      connectionStatus = 'error';
      isLoading = false;
      notifyListeners();
    }
  }

  void _regenerateObjectiveNames() {
    objectiveNames
      ..clear()
      ..addAll(
        _pickRandomObjectives(bootstrapData?.form?.objectiveNumber ?? 0),
      );
  }

  List<String> _pickRandomObjectives(int count) {
    final pool = [..._objectiveNamePool]..shuffle(Random());
    return pool.take(min(count, pool.length)).toList(growable: false);
  }

  void _sortPlayersByName() {
    players.sort((a, b) {
      final nameCompare = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      if (nameCompare != 0) return nameCompare;
      return a.id.compareTo(b.id);
    });
  }

  void _onMessage(Map<String, dynamic> event) {
    final type = event['type']?.toString();
    final payload = event['payload'];
    switch (type) {
      case 'lobby:joined':
      case 'lobby:created':
        _applyLobbyStateFromPayload(payload, updateIdentity: true);
        connectionStatus = 'connected';
        error = null;
        _syncVoiceState();
        notifyListeners();
        return;
      case 'lobby:snapshot':
        _applyLobbyStateFromPayload(payload, updateIdentity: false);
        connectionStatus = 'connected';
        error = null;
        notifyListeners();
        return;
      case 'server:hello':
        if (playerId != null && bootstrapData != null && !_isBindingSession) {
          unawaited(recoverAfterResume());
        }
        return;
      case 'lobby:peer-joined':
      case 'lobby:peer-reconnected':
        if (payload is Map) {
          _upsertPeerFromPayload(payload);
        }
        return;
      case 'lobby:peer-left':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null && id.isNotEmpty) {
            final removed = players.any((p) => p.id == id);
            if (removed) {
              players.removeWhere((p) => p.id == id);
              _syncVoiceState();
              notifyListeners();
            }
          }
        }
        return;
      case 'lobby:host-reconnected':
        if (payload is Map) {
          final newHost = payload['newHostId']?.toString();
          if (newHost != null) {
            for (var i = 0; i < players.length; i++) {
              players[i] = players[i].copyWith(
                isHost: players[i].id == newHost,
              );
            }
            isHost = playerId == newHost;
            bootstrapData = bootstrapData?.copyWith(reconnectAsHost: isHost);
            _syncVoiceState();
            notifyListeners();
          }
        }
        return;
      case 'webrtc:signal':
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
      case 'lobby:chat-message':
        if (payload is Map) {
          chatMessages.add(
            LobbyChatMessage(
              playerId: payload['playerId']?.toString() ?? '',
              playerName: payload['playerName']?.toString() ?? 'Joueur',
              text: payload['text']?.toString() ?? '',
              timestampMs: (payload['timestamp'] is int)
                  ? payload['timestamp'] as int
                  : DateTime.now().millisecondsSinceEpoch,
            ),
          );
          if (chatMessages.length > _maxLobbyChatMessages) {
            chatMessages.removeRange(
              0,
              chatMessages.length - _maxLobbyChatMessages,
            );
          }
          notifyListeners();
        }
        return;
      case 'lobby:player-updated':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          final changes = payload['changes'];
          if (id != null && changes is Map) {
            final idx = players.indexWhere((p) => p.id == id);
            if (idx != -1) {
              final hasRoleChange = changes.containsKey('role');
              players[idx] = players[idx].copyWith(
                role: hasRoleChange
                    ? changes['role']?.toString()
                    : players[idx].role,
                status: changes['status']?.toString() ?? players[idx].status,
              );
              notifyListeners();
            }
          }
        }
        return;
      case 'lobby:role-updated':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null) {
            final idx = players.indexWhere((p) => p.id == id);
            if (idx != -1) {
              players[idx] = players[idx].copyWith(
                role: payload['role']?.toString(),
              );
              notifyListeners();
            }
          }
        }
        return;
      case 'lobby:config-updated':
        if (payload is Map) {
          final rawConfig = payload['config'];
          if (rawConfig is Map) {
            final nextConfig = Map<String, dynamic>.from(
              rawConfig.map((k, v) => MapEntry(k.toString(), v)),
            );
            gameConfig = LobbyGameConfig.fromMap(nextConfig);
            final nextForm = _formFromConfigMap(nextConfig);
            bootstrapData = bootstrapData?.copyWith(form: nextForm);
            _regenerateObjectiveNames();
            notifyListeners();
          }
        }
        return;
      case 'game:started':
      case 'game:created':
        gameStarted = true;
        notifyListeners();
        return;
      case 'lobby:action-rejected':
        if (payload is Map) {
          error =
              payload['reason']?.toString() ?? 'Action refusee par le serveur.';
        } else {
          error = 'Action refusee par le serveur.';
        }
        notifyListeners();
        return;
      case 'game:error':
        final message = signalingErrorMessage(
          payload,
          fallback: 'Erreur de creation de partie.',
        );
        if (isTransientVoiceSignalingError(message)) {
          return;
        }
        error = message;
        notifyListeners();
        return;
      case 'lobby:closed':
      case 'lobby:error':
        final message = signalingErrorMessage(
          payload,
          fallback: 'Lobby indisponible.',
        );
        if (isTransientVoiceSignalingError(message)) {
          return;
        }
        final isResyncMiss =
            message.toLowerCase().contains('resync') &&
            playerId != null &&
            players.isNotEmpty;
        if (isResyncMiss) {
          return;
        }
        if (_isRecoveringSession) {
          // During resume recovery, avoid forcing a false fallback route.
          error = message;
          connectionStatus = 'connecting';
          notifyListeners();
          return;
        }
        error = message;
        shouldOpenGameForCode =
            type == 'lobby:error' && _isLobbyNotFoundMessage(message);
        connectionStatus = 'error';
        notifyListeners();
        return;
      case 'socket:disconnected':
        connectionStatus = 'connecting';
        _scheduleDisconnectRecovery();
        notifyListeners();
        return;
      case 'socket:reconnected':
        unawaited(recoverAfterResume());
        return;
      default:
        return;
    }
  }

  bool _isLobbyNotFoundMessage(String message) {
    final normalized = message.trim().toLowerCase();
    return _lobbyNotFoundMarkers.any(normalized.contains);
  }

  void sendChat(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    _socketService.sendLobbyChat(trimmed);
  }

  void updateRole({required String targetPlayerId, required String? role}) {
    _socketService.sendRoleUpdate(playerId: targetPlayerId, role: role);
  }

  void updateLobbyConfig(CreateLobbyFormData form) {
    final bootstrap = bootstrapData;
    if (!isHost || bootstrap == null) return;
    bootstrapData = bootstrap.copyWith(form: form);
    _socketService.sendLobbyConfigUpdate(
      gameConfig: <String, dynamic>{
        'objectif_number': form.objectiveNumber,
        'duration': form.duration,
        'victory_condition_nb_objectivs': form.victoryConditionObjectives,
        'hack_duration_ms': form.hackDurationMs,
        'objectiv_zone_radius': form.objectiveZoneRadius,
        'start_zone_radius': form.startZoneRadius,
        'rogue_range': form.rogueRange,
        'agent_range': form.agentRange,
        'map_center_latitude': form.mapCenterLatitude,
        'map_center_longitude': form.mapCenterLongitude,
        'map_radius': form.mapRadius,
      },
    );
    notifyListeners();
  }

  bool get canStartGame {
    final hasUnassignedPlayer = players.any(
      (player) => (player.role ?? '').trim().isEmpty,
    );
    if (hasUnassignedPlayer) return false;
    final agents = players
        .where((p) => (p.role ?? '').toUpperCase() == 'AGENT')
        .length;
    final rogues = players
        .where((p) => (p.role ?? '').toUpperCase() == 'ROGUE')
        .length;
    return agents >= 1 && rogues >= 1;
  }

  void startGame() {
    final code = lobbyCode;
    if (code == null || !isHost || !canStartGame) return;
    _socketService.startGame(code);
  }

  void requestLatestState() => _socketService.requestLatestState(
    code: lobbyCode ?? bootstrapData?.code,
    oldPlayerId: playerId ?? bootstrapData?.previousPlayerId,
    cognitoSub: bootstrapData?.cognitoSub,
  );

  void _scheduleDisconnectRecovery({Duration delay = const Duration(seconds: 1)}) {
    _disconnectRecoveryTimer?.cancel();
    _disconnectRecoveryTimer = Timer(delay, () {
      if (_isBindingSession) return;
      unawaited(recoverAfterResume());
    });
  }

  Future<void> recoverAfterResume() async {
    final bootstrap = bootstrapData;
    if (_isBindingSession || bootstrap == null) return;
    _isRecoveringSession = true;
    try {
      await _bindToLobby(bootstrap, isInitial: false);
      requestLatestState();
      await _syncVoiceState();
      _startResyncHeartbeat();
    } catch (_) {
      connectionStatus = _socketService.isConnected ? 'connected' : 'error';
      notifyListeners();
      _recoveryAttempts += 1;
      if (_recoveryAttempts <= 5) {
        final seconds = min(8, _recoveryAttempts * 2);
        _scheduleDisconnectRecovery(delay: Duration(seconds: seconds));
      }
    } finally {
      _isRecoveringSession = false;
    }
  }

  Future<void> _bindToLobby(
    LobbyBootstrapData bootstrap, {
    required bool isInitial,
  }) async {
    if (_isBindingSession) return;
    _isBindingSession = true;
    if (!isInitial) {
      connectionStatus = 'connecting';
      notifyListeners();
    }
    try {
      if (!_socketService.isConnected) {
        await _socketService.connect(
          serverUrl: Uri.parse(bootstrap.serverUrl),
          socketPath: bootstrap.socketPath,
        );
      }
      final joined = await _socketService.joinLobby(
        code: bootstrap.code,
        playerName: bootstrap.playerName,
        cognitoSub: bootstrap.cognitoSub,
        previousPlayerId: playerId ?? bootstrap.previousPlayerId,
        reconnectAsHost: isHost || (playerId == null && bootstrap.reconnectAsHost),
      );
      lobbyCode = joined.code;
      playerId = joined.playerId;
      isHost = joined.playerId == joined.hostId;
      bootstrapData = (bootstrapData ?? bootstrap).copyWith(
        previousPlayerId: joined.playerId,
        reconnectAsHost: isHost,
      );
      error = null;
      connectionStatus = 'connected';
      _recoveryAttempts = 0;
      _disconnectRecoveryTimer?.cancel();
      await _persistPlayerId();
      requestLatestState();
      notifyListeners();
    } finally {
      _isBindingSession = false;
    }
  }

  Future<void> _persistPlayerId() async {
    final code = lobbyCode;
    final id = playerId;
    if (code == null || id == null || id.isEmpty) return;
    try {
      await _playerSessionStore.savePlayerIdForCode(code: code, playerId: id);
    } catch (_) {}
  }

  void _startResyncHeartbeat() {
    _resyncHeartbeatTimer?.cancel();
    _resyncHeartbeatTimer = Timer.periodic(_resyncHeartbeatInterval, (_) {
      if (_isBindingSession) return;
      if (lobbyCode == null && bootstrapData == null) return;
      requestLatestState();
    });
  }

  void _applyLobbyStateFromPayload(
    dynamic payload, {
    required bool updateIdentity,
  }) {
    if (payload is! Map) return;
    final hostId = payload['hostId']?.toString();
    final lobby = payload['lobby'];
    var rosterChanged = false;
    if (lobby is Map) {
      final config = lobby['config'];
      if (config is Map) {
        final configMap = Map<String, dynamic>.from(
          config.map((k, v) => MapEntry(k.toString(), v)),
        );
        gameConfig = LobbyGameConfig.fromMap(configMap);
        bootstrapData = bootstrapData?.copyWith(
          form: _formFromConfigMap(configMap),
        );
      }
      final lobbyChatMessages = lobby['chatMessages'];
      if (lobbyChatMessages is List) {
        chatMessages
          ..clear()
          ..addAll(_parseLobbyChatMessages(lobbyChatMessages));
      }
      final playersRaw = lobby['players'];
      if (playersRaw is List) {
        rosterChanged = _replacePlayersFromRaw(playersRaw);
      }
    }
    if (updateIdentity) {
      final incomingId = payload['playerId']?.toString();
      if (incomingId != null && incomingId.isNotEmpty) {
        if (playerId == null || playerId == incomingId) {
          playerId = incomingId;
        }
      }
    }
    if (playerId != null && hostId != null) {
      isHost = playerId == hostId;
    }
    if (rosterChanged) {
      _syncVoiceState();
    }
  }

  bool _replacePlayersFromRaw(List playersRaw) {
    final next = playersRaw.whereType<Map>().map((raw) {
      return LobbyPlayer(
        id: raw['id']?.toString() ?? '',
        name: raw['name']?.toString() ?? 'Joueur',
        isHost: raw['isHost'] == true,
        role: raw['role']?.toString(),
        status: raw['status']?.toString() ?? 'active',
      );
    }).toList();
    next.sort((a, b) {
      final nameCompare = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      if (nameCompare != 0) return nameCompare;
      return a.id.compareTo(b.id);
    });
    final unchanged =
        next.length == players.length &&
        [
          for (var i = 0; i < next.length; i++)
            next[i].id == players[i].id &&
                next[i].name == players[i].name &&
                next[i].role == players[i].role &&
                next[i].status == players[i].status &&
                next[i].isHost == players[i].isHost,
        ].every((match) => match);
    if (unchanged) return false;
    players
      ..clear()
      ..addAll(next);
    return true;
  }

  void _upsertPeerFromPayload(Map payload) {
    final id = payload['playerId']?.toString();
    if (id == null || id.isEmpty) return;
    final oldId = payload['oldPlayerId']?.toString();
    if (oldId != null && oldId.isNotEmpty && oldId != id) {
      players.removeWhere((p) => p.id == oldId);
    }
    final idx = players.indexWhere((p) => p.id == id);
    final previous = idx == -1 ? null : players[idx];
    final next = LobbyPlayer(
      id: id,
      name: payload['playerName']?.toString() ?? previous?.name ?? 'Joueur',
      isHost: payload.containsKey('isHost')
          ? payload['isHost'] == true
          : (previous?.isHost ?? false),
      role: payload.containsKey('role')
          ? payload['role']?.toString()
          : previous?.role,
      status: payload['status']?.toString() ?? previous?.status ?? 'active',
    );
    if (previous != null &&
        previous.name == next.name &&
        previous.isHost == next.isHost &&
        previous.role == next.role &&
        previous.status == next.status) {
      return;
    }
    if (idx == -1) {
      players.add(next);
    } else {
      players[idx] = next;
    }
    _sortPlayersByName();
    _syncVoiceState();
    notifyListeners();
  }

  Future<void> toggleVoiceChat() async {
    final voiceSettings = await _voiceSettingsService.load();
    if (!voiceSettings.enabled) {
      isVoiceChatEnabled = false;
      await _voiceChatService.disable();
      notifyListeners();
      return;
    }
    if (!isVoiceChatEnabled) {
      isVoiceChatEnabled = true;
      _isMicrophoneMuted = false;
      await _syncVoiceState();
    } else {
      _isMicrophoneMuted = !_isMicrophoneMuted;
      await _voiceChatService.setTransmissionActive(isMicrophoneEnabled);
    }
    notifyListeners();
  }

  Future<void> _syncVoiceState() async {
    try {
      final me = playerId;
      if (me == null || me.isEmpty || !isVoiceChatEnabled) {
        await _voiceChatService.disable();
        return;
      }
      await _refreshTurnIfNeeded();
      final peerIds = players
          .where((p) => p.id != me && p.status.toLowerCase() != 'disconnected')
          .map((p) => p.id)
          .toList(growable: false);
      await _voiceChatService.setTransmissionActive(isMicrophoneEnabled);
      await _voiceChatService.enable(selfId: me, peerIds: peerIds);
    } catch (_) {
      isVoiceChatEnabled = false;
      await _voiceChatService.disable();
    }
  }

  bool isPlayerVoiceActive(String playerId) {
    final seenAt = _voiceActiveSeenAtMs[playerId];
    if (seenAt == null) return false;
    return DateTime.now().millisecondsSinceEpoch - seenAt <= 1500;
  }

  void _handleVoiceActivitySignal(String peerId, bool active) {
    if (!active) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final previous = _voiceActiveSeenAtMs[peerId];
    _voiceActiveSeenAtMs[peerId] = now;
    if (previous == null || now - previous >= 300) {
      notifyListeners();
    }
  }

  void _startVoiceActivityGcTimer() {
    _voiceActivityGcTimer?.cancel();
    _voiceActivityGcTimer = Timer.periodic(const Duration(milliseconds: 900), (
      _,
    ) {
      if (!isVoiceChatEnabled) return;
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

  void leaveLobby() {
    final code = lobbyCode;
    final player = playerId;
    if (code != null && player != null) {
      _socketService.leaveLobby(code: code, playerId: player);
    }
  }

  CreateLobbyFormData _formFromConfigMap(Map<String, dynamic> config) {
    final current = bootstrapData?.form ?? CreateLobbyFormData.initial();
    return current.copyWith(
      objectiveNumber:
          int.tryParse(config['objectif_number']?.toString() ?? '') ??
          current.objectiveNumber,
      duration:
          int.tryParse(config['duration']?.toString() ?? '') ??
          current.duration,
      victoryConditionObjectives:
          int.tryParse(
            (config['victory_condition_nb_objectivs'] ??
                    config['victory_condition_nb_objectives'])
                ?.toString() ??
                '',
          ) ??
          current.victoryConditionObjectives,
      hackDurationMs:
          int.tryParse(config['hack_duration_ms']?.toString() ?? '') ??
          current.hackDurationMs,
      objectiveZoneRadius:
          int.tryParse(config['objectiv_zone_radius']?.toString() ?? '') ??
          current.objectiveZoneRadius,
      startZoneRadius:
          int.tryParse(config['start_zone_radius']?.toString() ?? '') ??
          current.startZoneRadius,
      rogueRange:
          int.tryParse(config['rogue_range']?.toString() ?? '') ??
          current.rogueRange,
      agentRange:
          int.tryParse(config['agent_range']?.toString() ?? '') ??
          current.agentRange,
      mapCenterLatitude:
          config['map_center_latitude']?.toString() ??
          current.mapCenterLatitude,
      mapCenterLongitude:
          config['map_center_longitude']?.toString() ??
          current.mapCenterLongitude,
      mapRadius:
          int.tryParse(config['map_radius']?.toString() ?? '') ??
          current.mapRadius,
    );
  }

  List<LobbyChatMessage> _parseLobbyChatMessages(List rawMessages) {
    final relevantMessages = rawMessages.length > _maxLobbyChatMessages
        ? rawMessages.skip(rawMessages.length - _maxLobbyChatMessages)
        : rawMessages;
    return relevantMessages
        .whereType<Map>()
        .map((raw) {
          final timestampRaw = raw['timestamp'];
          return LobbyChatMessage(
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

  @override
  void dispose() {
    _messagesSub?.cancel();
    _voiceActivityGcTimer?.cancel();
    _disconnectRecoveryTimer?.cancel();
    _resyncHeartbeatTimer?.cancel();
    _voiceChatService.dispose();
    _socketService.dispose();
    super.dispose();
  }
}
