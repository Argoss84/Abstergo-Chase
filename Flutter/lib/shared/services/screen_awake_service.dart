import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

class ScreenAwakeService {
  ScreenAwakeService._();

  static final ScreenAwakeService instance = ScreenAwakeService._();
  static const String _preventLockKey = 'screen.prevent_lock';

  Future<bool> isPreventLockEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_preventLockKey) ?? false;
  }

  Future<void> setPreventLockEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_preventLockKey, enabled);
    await _apply(enabled);
  }

  Future<void> applySavedSetting() async {
    final enabled = await isPreventLockEnabled();
    await _apply(enabled);
  }

  Future<void> _apply(bool enabled) async {
    if (enabled) {
      await WakelockPlus.enable();
    } else {
      await WakelockPlus.disable();
    }
  }
}
