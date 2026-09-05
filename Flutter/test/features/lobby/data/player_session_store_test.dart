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

  test('loadLastLobbyCode clears stale code after 2 hours', () async {
    final now = DateTime.now().millisecondsSinceEpoch;
    SharedPreferences.setMockInitialValues(<String, Object>{
      'last_lobby_code': 'AB12CD',
      'last_lobby_code_saved_at_ms':
          now - const Duration(hours: 2, seconds: 1).inMilliseconds,
    });
    final store = PlayerSessionStore();

    expect(await store.loadLastLobbyCode(), isNull);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('last_lobby_code'), isNull);
    expect(prefs.getInt('last_lobby_code_saved_at_ms'), isNull);
  });

  test('clearLastLobbyCode removes stored code and timestamp', () async {
    final store = PlayerSessionStore();

    await store.saveLastLobbyCode('AB12CD');
    await store.clearLastLobbyCode();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('last_lobby_code'), isNull);
    expect(prefs.getInt('last_lobby_code_saved_at_ms'), isNull);
  });
}
