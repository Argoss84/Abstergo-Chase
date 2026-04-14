import 'package:shared_preferences/shared_preferences.dart';

class PlayerSessionStore {
  static const String _keyPrefix = 'last_player_id_by_code_';

  Future<String?> loadPlayerIdForCode(String code) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('$_keyPrefix${code.toUpperCase()}');
  }

  Future<void> savePlayerIdForCode({
    required String code,
    required String playerId,
  }) async {
    final normalizedCode = code.trim().toUpperCase();
    final normalizedPlayerId = playerId.trim();
    if (normalizedCode.isEmpty || normalizedPlayerId.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_keyPrefix$normalizedCode',
      normalizedPlayerId,
    );
  }
}
