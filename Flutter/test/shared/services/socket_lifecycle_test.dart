import 'dart:convert';
import 'dart:io';

import 'package:broken_veil_protocol/features/create_lobby/data/create_lobby_service.dart';
import 'package:broken_veil_protocol/features/game/data/game_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:broken_veil_protocol/shared/services/signaling_session.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final local = Uri.parse('http://localhost:3000');

  test('creating a lobby authenticates every new connection with a fresh ticket', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final sockets = <WebSocket>[];
    final receivedTickets = <String?>[];
    final tickets = <String>['a' * 64, 'b' * 64];
    final previousProvider = SignalingSession.ticketProvider;
    var issuedTickets = 0;
    SignalingSession.ticketProvider = () async => tickets[issuedTickets++];
    final service = CreateLobbyService();
    addTearDown(() async {
      service.disconnect();
      SignalingSession.ticketProvider = previousProvider;
      for (final socket in sockets) {
        await socket.close();
      }
      await server.close(force: true);
    });

    server.listen((request) async {
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      socket.add(
        '0${jsonEncode({'sid': 'engine-${sockets.length}', 'upgrades': <String>[], 'pingInterval': 25000, 'pingTimeout': 20000, 'maxPayload': 1000000})}',
      );
      socket.listen((packet) {
        if (packet is! String) return;
        if (packet.startsWith('40')) {
          final auth = packet.length > 2
              ? jsonDecode(packet.substring(2))
              : <String, dynamic>{};
          final ticket = (auth as Map)['ticket'] as String?;
          receivedTickets.add(ticket);
          if (ticket != tickets[receivedTickets.length - 1]) {
            socket.add(
              '44${jsonEncode({'message': 'Connexion Cognito requise'})}',
            );
            return;
          }
          socket.add('40${jsonEncode({'sid': 'host'})}');
        }
        if (packet.startsWith('42')) {
          final event = jsonDecode(packet.substring(2)) as List;
          expect(event[0], 'message');
          expect(event[1]['type'], 'lobby:create');
          socket.add(
            '42${jsonEncode([
              'message',
              {
                'type': 'lobby:created',
                'payload': {'code': 'ABC123', 'playerId': 'host', 'hostId': 'host'},
              },
            ])}',
          );
        }
      });
    });

    for (var attempt = 0; attempt < tickets.length; attempt++) {
      final created = await service.createLobby(
        playerName: 'Host',
        serverUrl: Uri.parse('http://127.0.0.1:${server.port}'),
        socketPath: '/socket.io',
        timeout: const Duration(seconds: 3),
      );
      expect(created.code, 'ABC123');
      expect(created.playerId, 'host');
      service.disconnect();
    }
    expect(receivedTickets, tickets);
    expect(issuedTickets, 2);
  });

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
