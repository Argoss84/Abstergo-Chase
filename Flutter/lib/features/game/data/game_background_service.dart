import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class GameBackgroundService {
  const GameBackgroundService();

  static const _channel = MethodChannel('brokenveil/game_background');

  Future<void> setVoiceActive(bool active) async {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      await _invoke('setVoiceActive', active);
    }
  }

  Future<void> prepareAlerts() => _invoke('prepareAlerts');

  Future<void> notifyObjectiveIntrusion(String objective) =>
      _invoke('notifyObjectiveIntrusion', objective);

  Future<void> _invoke(String method, [Object? argument]) async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      return;
    }
    try {
      await _channel.invokeMethod<void>(method, argument);
    } on MissingPluginException {
      // The in-game alert remains available without the mobile bridge.
    } on PlatformException catch (error, stackTrace) {
      AppLogger.error(
        'Communication en arrière-plan indisponible',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}
