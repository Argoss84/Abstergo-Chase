import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

class CreateLobbyService {
  CreateLobbyService();

  static final CreateLobbyService instance = CreateLobbyService();

  io.Socket? _socket;
  String? _connectedOrigin;
  String? _connectedPath;

  bool get isConnected => _socket?.connected == true;

  Future<void> _ensureConnected({
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
      final socket = io.io(
        origin,
        io.OptionBuilder()
            .setPath(socketPath)
            .setTransports(<String>['websocket'])
            .disableAutoConnect()
            .enableReconnection()
            .build(),
      );
      _socket = socket;
      _connectedOrigin = origin;
      _connectedPath = socketPath;
    }

    final socket = _socket!;
    if (socket.connected) {
      return;
    }

    final completer = Completer<void>();
    void onConnected(dynamic _) {
      if (!completer.isCompleted) {
        completer.complete();
      }
    }

    void onError(dynamic error) {
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion impossible: $error'));
      }
    }

    socket.on('connect', onConnected);
    socket.on('connect_error', onError);
    socket.connect();

    try {
      await completer.future.timeout(timeout);
    } finally {
      socket.off('connect', onConnected);
      socket.off('connect_error', onError);
    }
  }

  Future<String> createLobby({
    required String playerName,
    required Uri serverUrl,
    required String socketPath,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    await _ensureConnected(
      serverUrl: serverUrl,
      socketPath: socketPath,
      timeout: timeout,
    );

    final completer = Completer<String>();
    final socket = _socket!;

    void completeWithError(Object error) {
      if (!completer.isCompleted) {
        completer.completeError(error);
      }
    }

    void onMessage(dynamic data) {
      if (data is! Map) {
        return;
      }
      final type = data['type']?.toString();
      final payload = data['payload'];
      if (type == 'lobby:created' && payload is Map) {
        final code = payload['code']?.toString();
        if (code != null && code.isNotEmpty && !completer.isCompleted) {
          completer.complete(code);
        }
      }
      if (type == 'lobby:error') {
        completeWithError(Exception(payload?.toString() ?? 'Lobby error'));
      }
    }

    void onError(dynamic error) {
      completeWithError(Exception('Erreur socket: $error'));
    }

    socket.on('message', onMessage);
    socket.on('error', onError);

    socket.emit('message', <String, dynamic>{
      'type': 'lobby:create',
      'payload': <String, dynamic>{'playerName': playerName},
    });

    try {
      final code = await completer.future.timeout(timeout);
      return code;
    } finally {
      socket.off('message', onMessage);
      socket.off('error', onError);
    }
  }
}
