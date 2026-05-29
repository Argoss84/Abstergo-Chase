import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses agent_range from lobby game config', () {
    final config = LobbyGameConfig.fromMap(<String, dynamic>{
      'map_center_latitude': 48.8566,
      'map_center_longitude': 2.3522,
      'agent_range': 33,
    });

    expect(config.agentRange, 33);
  });

  test('falls back to default agent range when missing', () {
    final config = LobbyGameConfig.fromMap(<String, dynamic>{
      'map_center_latitude': 48.8566,
      'map_center_longitude': 2.3522,
    });

    expect(config.agentRange, CreateLobbyDefaults.agentRange);
  });
}
