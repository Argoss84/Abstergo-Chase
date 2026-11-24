import 'package:keep_screen_on/keep_screen_on.dart';
import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:broken_veil_protocol/features/account/application/account_settings_sync.dart';

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
    unawaited(
      AccountSettingsSync.instance.record('preventScreenLock', enabled),
    );
    await _apply(enabled);
  }

  Future<void> applySavedSetting() async {
    final enabled = await isPreventLockEnabled();
    await _apply(enabled);
  }

  Future<void> _apply(bool enabled) async {
    if (enabled) {
      await KeepScreenOn.turnOn();
    } else {
      await KeepScreenOn.turnOff();
    }
  }
}
