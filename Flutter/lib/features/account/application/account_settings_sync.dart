import 'dart:convert';

import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AccountSettingsSync {
  AccountSettingsSync._();
  static final instance = AccountSettingsSync._();

  static const _keys = {
    'voiceEnabled': 'voice.enabled',
    'voiceMode': 'voice.mode',
    'voiceThreshold': 'voice.activation.threshold',
    'ttsEnabled': 'tts.enabled',
    'preventScreenLock': 'screen.prevent_lock',
  };
  static const _lastAccount = 'account.settings.last';
  static const vibrationPrefix = 'vibration.enabled.';

  Future<void> _queue = Future.value();
  String? _account;
  AccountApiService? _api;
  Future<String?> Function()? _token;

  Future<void> _ordered(Future<void> Function() work) {
    final pending = _queue.then((_) => work());
    _queue = pending.catchError((Object _) {});
    return pending;
  }

  void unbind() {
    _account = null;
    _token = null;
    _api = null;
  }

  Future<void> bind(
    String account,
    AccountApiService api,
    Future<String?> Function() token,
  ) {
    _account = account;
    _api = api;
    _token = token;
    return _ordered(() async {
      if (_account != account) return;
      final prefs = await SharedPreferences.getInstance();
      final old = prefs.getString(_lastAccount);
      final bearer = await token();
      if (bearer == null || _account != account) return;
      final remote = await api.request(bearer, '/users/me/settings');
      if (_account != account) return;
      final settings = Map<String, dynamic>.from(remote['preferences'] as Map);
      final local = _pending(prefs, account);
      if (old == null && settings.isEmpty) {
        local.addAll(_localSettings(prefs));
        if (local.isNotEmpty) {
          await prefs.setString(_pendingKey(account), jsonEncode(local));
        }
      }
      _merge(settings, local);
      await _apply(prefs, settings);
      await prefs.setString(_lastAccount, account);
      await _flush(account, prefs);
    });
  }

  Future<void> record(String key, Object value) {
    final account = _account;
    if (account == null) return Future.value();
    return _ordered(() async {
      if (_account != account) return;
      final prefs = await SharedPreferences.getInstance();
      final patch = _pending(prefs, account);
      _merge(patch, {key: value});
      await prefs.setString(_pendingKey(account), jsonEncode(patch));
      try {
        await _flush(account, prefs);
      } on AccountApiException {
        // Keep the patch on the originating account until connectivity returns.
      }
    }).catchError((Object _) {});
  }

  Future<void> flush() {
    final account = _account;
    if (account == null) return Future.value();
    return _ordered(
      () async => _flush(account, await SharedPreferences.getInstance()),
    ).catchError((Object _) {});
  }

  Future<void> _flush(String account, SharedPreferences prefs) async {
    final api = _api;
    if (api == null || _account != account) return;
    final patch = _pending(prefs, account);
    if (patch.isEmpty) return;
    final bearer = await _token?.call();
    if (bearer == null || _account != account) return;
    await api.request(
      bearer,
      '/users/me/settings',
      method: 'PATCH',
      body: {'preferences': patch},
    );
    await prefs.remove(_pendingKey(account));
  }

  static Map<String, dynamic> _localSettings(SharedPreferences prefs) {
    final vibrations = {
      for (final key in prefs.getKeys().where(
        (key) => key.startsWith(vibrationPrefix),
      ))
        if (prefs.get(key) is bool)
          key.substring(vibrationPrefix.length): prefs.getBool(key),
    };
    return {
      for (final entry in _keys.entries)
        if (prefs.get(entry.value) != null) entry.key: prefs.get(entry.value),
      if (vibrations.isNotEmpty) 'vibrations': vibrations,
    };
  }

  static void _merge(Map<String, dynamic> target, Map<String, dynamic> patch) {
    final vibrations = target['vibrations'];
    target.addAll(patch);
    if (patch['vibrations'] is Map) {
      target['vibrations'] = {
        if (vibrations is Map) ...vibrations,
        ...patch['vibrations'] as Map,
      };
    }
  }

  static Future<void> _apply(
    SharedPreferences prefs,
    Map<String, dynamic> values,
  ) async {
    for (final entry in _keys.entries) {
      final value = values[entry.key];
      switch (value) {
        case bool value:
          await prefs.setBool(entry.value, value);
        case String value:
          await prefs.setString(entry.value, value);
        case num value:
          await prefs.setDouble(entry.value, value.toDouble());
        default:
          await prefs.remove(entry.value);
      }
    }
    final vibrationKeys = prefs
        .getKeys()
        .where((key) => key.startsWith(vibrationPrefix))
        .toList();
    for (final key in vibrationKeys) {
      await prefs.remove(key);
    }
    final vibrations = values['vibrations'];
    if (vibrations is Map) {
      for (final entry in vibrations.entries) {
        if (entry.key is String && entry.value is bool) {
          await prefs.setBool(
            vibrationPrefix + (entry.key as String),
            entry.value as bool,
          );
        }
      }
    }
  }

  static String _pendingKey(String account) =>
      'account.settings.pending.$account';

  static Map<String, dynamic> _pending(
    SharedPreferences prefs,
    String account,
  ) {
    final value = prefs.getString(_pendingKey(account));
    if (value == null) return {};
    try {
      return Map<String, dynamic>.from(jsonDecode(value) as Map);
    } catch (_) {
      return {};
    }
  }
}
