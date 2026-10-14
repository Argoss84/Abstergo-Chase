import 'package:broken_veil_protocol/features/create_lobby/data/create_lobby_service.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final local = Uri.parse('http://localhost:3000');

  test(
    'a disposed game socket cannot connect after its async preparation',
    () async {
      final service = GameSocketService();
      final pending = service.connect(
        serverUrl: local,
        socketPath: '/socket.io',
      );
      service.dispose();
      await expectLater(pending, throwsStateError);
      expect(service.isConnected, isFalse);
      expect(await service.requestTurnCredentials(), isNull);
    },
  );

  test(
    'a disposed lobby socket cannot connect after its async preparation',
    () async {
      final service = LobbySocketService();
      final pending = service.connect(
        serverUrl: local,
        socketPath: '/socket.io',
      );
      service.dispose();
      await expectLater(pending, throwsStateError);
      expect(service.isConnected, isFalse);
      expect(await service.requestTurnCredentials(), isNull);
    },
  );

  test(
    'cancelling creation prevents a late socket and lobby from being created',
    () async {
      final service = CreateLobbyService();
      final pending = service.createLobby(
        playerName: 'Host',
        serverUrl: local,
        socketPath: '/socket.io',
      );
      service.disconnect();
      await expectLater(pending, throwsStateError);
      expect(service.isConnected, isFalse);
    },
  );
}
