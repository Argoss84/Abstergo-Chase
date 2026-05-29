import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  test('saveLastLobbyCode persists and normalizes lobby code', () async {
    final store = PlayerSessionStore();

    await store.saveLastLobbyCode(' ab12cd ');

    expect(await store.loadLastLobbyCode(), 'AB12CD');
  });

  test('saveLastLobbyCode ignores blank values', () async {
    final store = PlayerSessionStore();

    await store.saveLastLobbyCode('   ');

    expect(await store.loadLastLobbyCode(), isNull);
  });
}
