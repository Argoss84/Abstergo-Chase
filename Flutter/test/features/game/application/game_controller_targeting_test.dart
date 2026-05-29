import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('does not expose rogue info when rogue is outside configured range', () {
    final controller = GameController();
    controller.playerRole = 'AGENT';
    controller.gameStarted = true;
    controller.myPosition = const GeoPoint(latitude: 48.8566, longitude: 2.3522);
    controller.bootstrap = LobbyBootstrapData(
      code: 'ABC123',
      serverUrl: 'http://localhost:3000',
      socketPath: '/socket.io',
      playerName: 'Agent',
      form: CreateLobbyFormData.initial().copyWith(agentRange: 5),
    );
    controller.players.add(
      const GamePlayer(
        id: 'rogue-1',
        name: 'Rogue',
        isHost: false,
        role: 'ROGUE',
        latitude: 48.8567,
        longitude: 2.3522,
      ),
    );

    final result = controller.getRogueTargetForHeading(0);

    expect(result.isValid, isFalse);
    expect(result.targetPlayerId, isNull);
    expect(result.targetPlayerName, isNull);
    expect(result.distanceMeters, isNull);
    expect(result.angularDeltaDeg, isNull);
    expect(result.reason, 'Aucun rogue détecté à proximité.');
  });

  test('keeps cone feedback for rogues inside configured range', () {
    final controller = GameController();
    controller.playerRole = 'AGENT';
    controller.gameStarted = true;
    controller.myPosition = const GeoPoint(latitude: 48.8566, longitude: 2.3522);
    controller.bootstrap = LobbyBootstrapData(
      code: 'ABC123',
      serverUrl: 'http://localhost:3000',
      socketPath: '/socket.io',
      playerName: 'Agent',
      form: CreateLobbyFormData.initial().copyWith(agentRange: 10),
    );
    controller.players.add(
      const GamePlayer(
        id: 'rogue-1',
        name: 'Rogue',
        isHost: false,
        role: 'ROGUE',
        latitude: 48.8566,
        longitude: 2.35224,
      ),
    );

    final result = controller.getRogueTargetForHeading(0);

    expect(result.isValid, isFalse);
    expect(result.targetPlayerId, 'rogue-1');
    expect(result.targetPlayerName, 'Rogue');
    expect(result.distanceMeters, isNotNull);
    expect(result.angularDeltaDeg, isNotNull);
    expect(result.reason, 'Rogue hors cône de visée.');
  });
}
