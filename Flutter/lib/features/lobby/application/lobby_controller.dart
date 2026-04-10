import 'dart:async';
import 'dart:math';

import 'package:abstergo_chase/features/lobby/data/lobby_socket_service.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:flutter/foundation.dart';

class LobbyController extends ChangeNotifier {
  LobbyController({LobbySocketService? socketService})
      : _socketService = socketService ?? LobbySocketService();

  final LobbySocketService _socketService;
  StreamSubscription<Map<String, dynamic>>? _messagesSub;

  bool isLoading = true;
  String? error;
  String? lobbyCode;
  String? playerId;
  bool isHost = false;
  bool gameStarted = false;
  final List<LobbyPlayer> players = <LobbyPlayer>[];
  final List<LobbyChatMessage> chatMessages = <LobbyChatMessage>[];
  String connectionStatus = 'idle';
  LobbyBootstrapData? bootstrapData;
  final List<String> objectiveNames = <String>[];

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

  Future<void> initialize({
    required LobbyBootstrapData bootstrap,
  }) async {
    bootstrapData = bootstrap;
    lobbyCode = bootstrap.code.toUpperCase();
    isLoading = true;
    error = null;
    connectionStatus = 'connecting';
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
      ..addAll(_pickRandomObjectives(
        bootstrapData?.form?.objectiveNumber ?? 0,
      ));
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
            final playersRaw = lobby['players'];
            if (playersRaw is List) {
              players
                ..clear()
                ..addAll(playersRaw.whereType<Map>().map((raw) {
                  return LobbyPlayer(
                    id: raw['id']?.toString() ?? '',
                    name: raw['name']?.toString() ?? 'Joueur',
                    isHost: raw['isHost'] == true,
                  );
                }));
            }
          }
          playerId = payload['playerId']?.toString() ?? playerId;
          isHost = playerId != null && hostId != null && playerId == hostId;
        }
        connectionStatus = 'connected';
        error = null;
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
            notifyListeners();
          }
        }
        return;
      case 'lobby:peer-left':
        if (payload is Map) {
          final id = payload['playerId']?.toString();
          if (id != null) {
            players.removeWhere((p) => p.id == id);
            notifyListeners();
          }
        }
        return;
      case 'lobby:host-reconnected':
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
      case 'game:started':
      case 'game:created':
        gameStarted = true;
        notifyListeners();
        return;
      case 'lobby:closed':
      case 'lobby:error':
        error = payload?.toString() ?? 'Lobby indisponible.';
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

  void updateRole({
    required String targetPlayerId,
    required String? role,
  }) {
    _socketService.sendRoleUpdate(
      playerId: targetPlayerId,
      role: role,
    );
    final idx = players.indexWhere((p) => p.id == targetPlayerId);
    if (idx != -1) {
      players[idx] = players[idx].copyWith(role: role);
      notifyListeners();
    }
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
    _socketService.dispose();
    super.dispose();
  }
}
