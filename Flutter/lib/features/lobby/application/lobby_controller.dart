import 'dart:async';
import 'dart:math';

import 'package:abstergo_chase/features/lobby/data/lobby_socket_service.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/shared/services/voice_chat_service.dart';
import 'package:flutter/foundation.dart';

class LobbyController extends ChangeNotifier {
  LobbyController({LobbySocketService? socketService})
    : _socketService = socketService ?? LobbySocketService() {
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
  late final VoiceChatService _voiceChatService;
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
  LobbyBootstrapData? bootstrapData;
  final List<String> objectiveNames = <String>[];
  bool shouldOpenGameForCode = false;
  int _turnExpiresAtMs = 0;
  final Map<String, int> _voiceActiveSeenAtMs = <String, int>{};
  Timer? _voiceActivityGcTimer;

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

  Future<void> initialize({required LobbyBootstrapData bootstrap}) async {
    bootstrapData = bootstrap;
    lobbyCode = bootstrap.code.toUpperCase();
    isLoading = true;
    error = null;
    connectionStatus = 'connecting';
    shouldOpenGameForCode = false;
    notifyListeners();

    try {
      final serverUri = Uri.parse(bootstrap.serverUrl);
      await _socketService.connect(
        serverUrl: serverUri,
        socketPath: bootstrap.socketPath,
      );
      _messagesSub?.cancel();
      _messagesSub = _socketService.messages.listen(_onMessage);

      final joined = await _socketService.joinLobby(
        code: bootstrap.code,
        playerName: bootstrap.playerName,
        previousPlayerId: bootstrap.previousPlayerId,
        reconnectAsHost: bootstrap.reconnectAsHost,
      );
      lobbyCode = joined.code;
      playerId = joined.playerId;
      isHost = joined.playerId == joined.hostId;
      connectionStatus = 'connected';
      _regenerateObjectiveNames();
      isLoading = false;
      notifyListeners();
      // Keep lobby join UX responsive even if microphone permission stalls.
      _syncVoiceState();
      _startVoiceActivityGcTimer();
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

  void _onMessage(Map<String, dynamic> event) {
    final type = event['type']?.toString();
    final payload = event['payload'];
    switch (type) {
      case 'lobby:joined':
      case 'lobby:created':
        if (payload is Map) {
          final hostId = payload['hostId']?.toString();
          final lobby = payload['lobby'];
          if (lobby is Map) {
            final config = lobby['config'];
            if (config is Map) {
              gameConfig = LobbyGameConfig.fromMap(config);
            }
            final playersRaw = lobby['players'];
            if (playersRaw is List) {
              players
                ..clear()
                ..addAll(
                  playersRaw.whereType<Map>().map((raw) {
                    return LobbyPlayer(
                      id: raw['id']?.toString() ?? '',
                      name: raw['name']?.toString() ?? 'Joueur',
                      isHost: raw['isHost'] == true,
                      role: raw['role']?.toString(),
                      status: raw['status']?.toString() ?? 'active',
                    );
                  }),
                );
            }
          }
          playerId = payload['playerId']?.toString() ?? playerId;
          isHost = playerId != null && hostId != null && playerId == hostId;
        }
        connectionStatus = 'connected';
        error = null;
        _syncVoiceState();
        notifyListeners();
        return;
      case 'lobby:peer-joined':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null && players.every((p) => p.id != id)) {
            players.add(
              LobbyPlayer(
                id: id,
                name: payload['playerName']?.toString() ?? 'Joueur',
                isHost: false,
              ),
            );
            _syncVoiceState();
            notifyListeners();
          }
        }
        return;
      case 'lobby:peer-left':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null) {
            players.removeWhere((p) => p.id == id);
            _syncVoiceState();
            notifyListeners();
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
          if (chatMessages.length > 100) {
            chatMessages.removeRange(0, chatMessages.length - 100);
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
              players[idx] = players[idx].copyWith(
                role: changes['role']?.toString(),
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
        if (payload is Map) {
          error =
              payload['message']?.toString() ?? 'Erreur de creation de partie.';
        } else {
          error = 'Erreur de creation de partie.';
        }
        notifyListeners();
        return;
      case 'lobby:closed':
      case 'lobby:error':
        final message = payload?.toString() ?? 'Lobby indisponible.';
        error = message;
        if (message.toLowerCase().contains('lobby introuvable')) {
          // If lobby doesn't exist, code may correspond to an already running game.
          shouldOpenGameForCode = true;
        }
        connectionStatus = 'error';
        notifyListeners();
        return;
      default:
        return;
    }
  }

  void sendChat(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    _socketService.sendLobbyChat(trimmed);
  }

  void updateRole({required String targetPlayerId, required String? role}) {
    _socketService.sendRoleUpdate(playerId: targetPlayerId, role: role);
  }

  bool get canStartGame {
    final agents = players.where((p) => p.role == 'AGENT').length;
    final rogues = players.where((p) => p.role == 'ROGUE').length;
    return agents >= 1 && rogues >= 1;
  }

  void startGame() {
    final code = lobbyCode;
    if (code == null || !isHost || !canStartGame) return;
    _socketService.startGame(code);
  }

  void requestLatestState() => _socketService.requestLatestState();

  Future<void> toggleVoiceChat() async {
    isVoiceChatEnabled = !isVoiceChatEnabled;
    await _syncVoiceState();
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
      await _voiceChatService.enable(selfId: me, peerIds: peerIds);
      await _voiceChatService.setTransmissionActive(true);
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

  @override
  void dispose() {
    _messagesSub?.cancel();
    _voiceActivityGcTimer?.cancel();
    _voiceChatService.dispose();
    _socketService.dispose();
    super.dispose();
  }
}
