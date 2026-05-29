import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps initialPlayerPosition in game bootstrap data', () {
    const initialPosition = GeoPoint(latitude: 48.8566, longitude: 2.3522);
    const bootstrap = GameBootstrapData(
      lobby: LobbyBootstrapData(
        code: 'ABC123',
        serverUrl: 'http://localhost:3000',
        socketPath: '/socket.io',
        playerName: 'Player',
      ),
      playerId: 'p1',
      players: <LobbyPlayer>[],
      initialPlayerPosition: initialPosition,
    );

    expect(bootstrap.initialPlayerPosition, initialPosition);
  });
}
