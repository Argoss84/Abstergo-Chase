import 'package:shared_preferences/shared_preferences.dart';

class PlayerSessionStore {
  static const String _keyPrefix = 'last_player_id_by_code_';
  static const String _lastLobbyCodeKey = 'last_lobby_code';

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
    String? code;
    final prefs = await SharedPreferences.getInstance();
    final storedCode = prefs.getString(_lastLobbyCodeKey);
    if (storedCode != null) {
      code = _normalizeCode(storedCode);
    }
    if (code == null || code.isEmpty) return null;
    return code;
  }

  Future<void> saveLastLobbyCode(String code) async {
    final normalizedCode = _normalizeCode(code);
    if (normalizedCode.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastLobbyCodeKey, normalizedCode);
  }
}
