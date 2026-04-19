import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

class LobbySocketService {
  LobbySocketService();
  static const String _clientVersion = 'flutter-2026.04.10';

  io.Socket? _socket;
  String? _connectedOrigin;
  String? _connectedPath;
  StreamController<Map<String, dynamic>>? _messageController;

  Stream<Map<String, dynamic>> get messages {
    _messageController ??= StreamController<Map<String, dynamic>>.broadcast();
    return _messageController!.stream;
  }

  Future<void> connect({
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final origin = serverUrl.toString();
    final sameEndpoint =
        _connectedOrigin == origin && _connectedPath == socketPath;

    if (_socket != null && _socket!.connected && sameEndpoint) {
      return;
    }

    if (_socket != null && !sameEndpoint) {
      _socket!.dispose();
      _socket = null;
    }

    if (_socket == null) {
      _socket = io.io(
        origin,
        io.OptionBuilder()
            .setPath(socketPath)
            .setTransports(<String>['websocket'])
            .disableAutoConnect()
            .enableReconnection()
            .build(),
      );
      _connectedOrigin = origin;
      _connectedPath = socketPath;
      _socket!.on('message', (data) {
        if (data is Map) {
          final normalized = Map<String, dynamic>.from(
            data.map((key, value) => MapEntry(key.toString(), value)),
          );
          _messageController?.add(normalized);
        }
      });
    }

    final socket = _socket!;
    if (socket.connected) {
      return;
    }

    final completer = Completer<void>();
    void onConnect(dynamic _) {
      if (!completer.isCompleted) {
        completer.complete();
      }
    }

    void onError(dynamic error) {
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion impossible: $error'));
      }
    }

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();

    try {
      await completer.future.timeout(timeout);
    } finally {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    }
  }

  Future<JoinLobbyResult> joinLobby({
    required String code,
    required String playerName,
    String? previousPlayerId,
    bool reconnectAsHost = false,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      throw Exception('Connexion au lobby indisponible.');
    }
    final wait = Completer<JoinLobbyResult>();
    late final StreamSubscription<Map<String, dynamic>> sub;
    sub = messages.listen((event) {
      final type = event['type']?.toString();
      final payload = event['payload'];
      if (type == 'lobby:error') {
        if (!wait.isCompleted) {
          wait.completeError(
            Exception(payload?.toString() ?? 'Erreur lobby'),
          );
        }
      }
      if (type == 'lobby:joined' && payload is Map) {
        final joinedCode = payload['code']?.toString();
        final playerId = payload['playerId']?.toString();
        final hostId = payload['hostId']?.toString();
        if (joinedCode != null && playerId != null && hostId != null) {
          if (!wait.isCompleted) {
            wait.complete(
              JoinLobbyResult(
                code: joinedCode,
                playerId: playerId,
                hostId: hostId,
              ),
            );
          }
        }
      }
    });

    final envelope = reconnectAsHost
        ? <String, dynamic>{
            'type': 'lobby:rejoin-host',
            'payload': <String, dynamic>{
              'code': code.toUpperCase(),
              'playerName': playerName,
              'playerId': previousPlayerId,
            },
          }
        : <String, dynamic>{
            'type': 'lobby:join',
            'payload': <String, dynamic>{
              'code': code.toUpperCase(),
              'playerName': playerName,
              if (previousPlayerId != null && previousPlayerId.isNotEmpty)
                'oldPlayerId': previousPlayerId,
            },
          };
    _emitMessage(envelope);

    try {
      return await wait.future.timeout(timeout);
    } finally {
      await sub.cancel();
    }
  }

  void sendLobbyChat(String text) {
    _emitMessage(
      <String, dynamic>{
      'type': 'lobby:chat',
      'payload': <String, dynamic>{'text': text},
      },
    );
  }

  void sendRoleUpdate({
    required String playerId,
    required String? role,
  }) {
    _emitMessage(
      <String, dynamic>{
      'type': 'lobby:role-update-request',
      'payload': <String, dynamic>{
        'playerId': playerId,
        'role': role,
        'requestId': _newRequestId(),
      },
      },
    );
  }

  void requestLatestState() {
    _emitMessage(
      const <String, dynamic>{
      'type': 'lobby:request-resync',
      'payload': <String, dynamic>{},
      },
    );
  }

  void startGame(String code) {
    _emitMessage(
      <String, dynamic>{
      'type': 'lobby:start-game-request',
      'payload': <String, dynamic>{
        'code': code.toUpperCase(),
        'requestId': _newRequestId(),
      },
      },
    );
  }

  String _newRequestId() {
    return '${DateTime.now().microsecondsSinceEpoch}-${(DateTime.now().millisecondsSinceEpoch % 997)}';
  }

  void leaveLobby({
    required String code,
    required String playerId,
  }) {
    _emitMessage(
      <String, dynamic>{
      'type': 'lobby:leave',
      'payload': <String, dynamic>{
        'lobbyCode': code.toUpperCase(),
        'playerId': playerId,
      },
      },
    );
  }

  void _emitMessage(Map<String, dynamic> message) {
    final meta = <String, dynamic>{
      ...((message['meta'] is Map)
          ? Map<String, dynamic>.from(message['meta'] as Map)
          : const <String, dynamic>{}),
      'clientVersion': _clientVersion,
    };
    final envelope = <String, dynamic>{
      ...message,
      'meta': meta,
    };
    _socket?.emit('message', envelope);
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _messageController?.close();
    _messageController = null;
  }
}

class JoinLobbyResult {
  const JoinLobbyResult({
    required this.code,
    required this.playerId,
    required this.hostId,
  });

  final String code;
  final String playerId;
  final String hostId;
}
