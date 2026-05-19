import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

class GameSocketService {
  static const String _clientVersion = 'flutter-2026.04.13';

  io.Socket? _socket;
  String? _origin;
  String? _path;
  StreamController<Map<String, dynamic>>? _messages;

  Stream<Map<String, dynamic>> get messages {
    _messages ??= StreamController<Map<String, dynamic>>.broadcast();
    return _messages!.stream;
  }

  bool get isConnected => _socket?.connected == true;

  Future<void> connect({
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final origin = serverUrl.toString();
    final same = _origin == origin && _path == socketPath;
    if (_socket != null && _socket!.connected && same) return;
    if (_socket != null && !same) {
      _socket!.dispose();
      _socket = null;
    }
    if (_socket == null) {
      _socket = io.io(
        origin,
        io.OptionBuilder()
            .setPath(socketPath)
            .setTransports(<String>['websocket'])
            .enableForceNew()
            .disableMultiplex()
            .disableAutoConnect()
            .enableReconnection()
            .build(),
      );
      _origin = origin;
      _path = socketPath;
      _socket!.on('message', (data) {
        if (data is Map) {
          _messages?.add(
            Map<String, dynamic>.from(
              data.map((k, v) => MapEntry(k.toString(), v)),
            ),
          );
        }
      });
      _socket!.on('connect', (_) {
        _messages?.add(const <String, dynamic>{'type': 'socket:connected'});
      });
      _socket!.on('disconnect', (reason) {
        _messages?.add(<String, dynamic>{
          'type': 'socket:disconnected',
          'payload': reason?.toString(),
        });
      });
      _socket!.on('connect_error', (error) {
        _messages?.add(<String, dynamic>{
          'type': 'socket:connect_error',
          'payload': error?.toString(),
        });
      });
    }

    final socket = _socket!;
    if (socket.connected) return;
    final wait = Completer<void>();
    void onConnect(dynamic _) {
      if (!wait.isCompleted) wait.complete();
    }

    void onError(dynamic error) {
      if (!wait.isCompleted) {
        wait.completeError(Exception('Connexion impossible: $error'));
      }
    }

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();
    try {
      await wait.future.timeout(timeout);
    } finally {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    }
  }

  void joinGame({
    required String code,
    required String playerName,
    String? cognitoSub,
    String? previousPlayerId,
  }) {
    _emit(<String, dynamic>{
      'type': 'game:join',
      'payload': <String, dynamic>{
        'code': code.toUpperCase(),
        'playerName': playerName,
        if (cognitoSub != null && cognitoSub.isNotEmpty) 'cognitoSub': cognitoSub,
        if (previousPlayerId != null && previousPlayerId.isNotEmpty)
          'oldPlayerId': previousPlayerId,
      },
    });
  }

  void requestGameSync() {
    _emit(const <String, dynamic>{
      'type': 'game:request-resync',
      'payload': <String, dynamic>{},
    });
  }

  void pushState({
    required Map<String, dynamic> state,
    String? targetId,
  }) {
    _emit(<String, dynamic>{
      'type': 'game:state-sync-request',
      'payload': <String, dynamic>{
        'requestId': _requestId(),
        'payload': state,
        if (targetId != null && targetId.isNotEmpty) 'targetId': targetId,
      },
    });
  }

  void updateRemainingTime({
    required int remaining,
    required bool countdownStarted,
  }) {
    _emit(<String, dynamic>{
      'type': 'game:update-remaining-time-request',
      'payload': <String, dynamic>{
        'requestId': _requestId(),
        'remaining_time': remaining,
        'countdown_started': countdownStarted,
      },
    });
  }

  void updatePlayerStatus({
    required String playerId,
    required String status,
  }) {
    _emit(<String, dynamic>{
      'type': 'game:player-status-update-request',
      'payload': <String, dynamic>{
        'requestId': _requestId(),
        'playerId': playerId,
        'status': status,
      },
    });
  }

  void sendRoleChat({
    required String role,
    required String text,
  }) {
    final upper = role.toUpperCase();
    final type = upper == 'ROGUE' ? 'game:chat:rogue' : 'game:chat:agent';
    _emit(<String, dynamic>{
      'type': type,
      'payload': <String, dynamic>{'text': text},
    });
  }

  void sendGameAction(Map<String, dynamic> action) {
    _emit(<String, dynamic>{
      'type': 'game:action-relay',
      'payload': <String, dynamic>{'action': action},
    });
  }

  Future<void> sendGameSignal({
    required String targetId,
    required Map<String, dynamic> signal,
  }) async {
    _emit(<String, dynamic>{
      'type': 'game:signal',
      'payload': <String, dynamic>{
        'targetId': targetId,
        'signal': signal,
        'channel': 'voice',
      },
    });
  }

  Future<TurnCredentialsResult?> requestTurnCredentials({
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final wait = Completer<TurnCredentialsResult?>();
    late final StreamSubscription<Map<String, dynamic>> sub;
    final requestId = _requestId();
    sub = messages.listen((event) {
      final type = event['type']?.toString();
      if (type != 'turn:credentials') return;
      final payload = event['payload'];
      if (payload is! Map) return;
      if (payload['requestId']?.toString() != requestId) return;
      final urlsRaw = payload['urls'];
      final urls = urlsRaw is List
          ? urlsRaw.map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
          : const <String>[];
      final username = payload['username']?.toString();
      final credential = payload['credential']?.toString();
      if (!wait.isCompleted) {
        wait.complete(
          TurnCredentialsResult(
            urls: urls,
            username: username,
            credential: credential,
          ),
        );
      }
    });
    _emit(
      <String, dynamic>{
        'type': 'turn:credentials-request',
        'payload': <String, dynamic>{'requestId': requestId},
      },
    );
    try {
      return await wait.future.timeout(timeout);
    } catch (_) {
      return null;
    } finally {
      await sub.cancel();
    }
  }

  void leaveGame({
    required String code,
    required String playerId,
  }) {
    _emit(<String, dynamic>{
      'type': 'game:leave',
      'payload': <String, dynamic>{
        'gameCode': code.toUpperCase(),
        'playerId': playerId,
      },
    });
  }

  void _emit(Map<String, dynamic> message) {
    _socket?.emit('message', <String, dynamic>{
      ...message,
      'meta': <String, dynamic>{
        ...((message['meta'] is Map)
            ? Map<String, dynamic>.from(message['meta'] as Map)
            : const <String, dynamic>{}),
        'clientVersion': _clientVersion,
      },
    });
  }

  String _requestId() => DateTime.now().microsecondsSinceEpoch.toString();

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _messages?.close();
    _messages = null;
  }
}

class TurnCredentialsResult {
  const TurnCredentialsResult({
    required this.urls,
    required this.username,
    required this.credential,
  });

  final List<String> urls;
  final String? username;
  final String? credential;
}
