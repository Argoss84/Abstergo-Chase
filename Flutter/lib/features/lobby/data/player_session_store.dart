import 'package:shared_preferences/shared_preferences.dart';

class PlayerSessionStore {
  static const String _keyPrefix = 'last_player_id_by_code_';
  static const String _lastLobbyCodeKey = 'last_lobby_code';
  static const String _lastLobbyCodeSavedAtKey = 'last_lobby_code_saved_at_ms';
  static const Duration _lastLobbyCodeMaxAge = Duration(hours: 2);

  String _normalizeCode(String code) => code.trim().toUpperCase();

  Future<String?> loadPlayerIdForCode(String code) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('$_keyPrefix${_normalizeCode(code)}');
  }

  Future<void> savePlayerIdForCode({
    required String code,
    required String playerId,
  }) async {
    final normalizedCode = _normalizeCode(code);
    final normalizedPlayerId = playerId.trim();
    if (normalizedCode.isEmpty || normalizedPlayerId.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_keyPrefix$normalizedCode',
      normalizedPlayerId,
    );
  }

  Future<String?> loadLastLobbyCode() async {
    final prefs = await SharedPreferences.getInstance();
    final storedCode = prefs.getString(_lastLobbyCodeKey);
    if (storedCode == null) return null;
    final code = _normalizeCode(storedCode);
    if (code.isEmpty) {
      await clearLastLobbyCode();
      return null;
    }
    final savedAtMs = prefs.getInt(_lastLobbyCodeSavedAtKey);
    if (savedAtMs == null) {
      await clearLastLobbyCode();
      return null;
    }
    final isExpired =
        DateTime.now().millisecondsSinceEpoch - savedAtMs >
        _lastLobbyCodeMaxAge.inMilliseconds;
    if (isExpired) {
      await clearLastLobbyCode();
      return null;
    }
    return code;
  }

  Future<void> saveLastLobbyCode(String code) async {
    final normalizedCode = _normalizeCode(code);
    if (normalizedCode.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastLobbyCodeKey, normalizedCode);
    await prefs.setInt(
      _lastLobbyCodeSavedAtKey,
      DateTime.now().millisecondsSinceEpoch,
    );
  }

  Future<void> clearLastLobbyCode() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_lastLobbyCodeKey);
    await prefs.remove(_lastLobbyCodeSavedAtKey);
  }
}
