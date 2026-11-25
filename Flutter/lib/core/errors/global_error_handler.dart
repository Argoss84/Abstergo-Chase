import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:flutter/foundation.dart';

class GlobalErrorHandler {
  const GlobalErrorHandler._();

  static void initialize() {
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      AppLogger.error(
        'Flutter framework error',
        error: details.exception,
        stackTrace: details.stack,
        source: 'flutter.framework',
      );
    };

    PlatformDispatcher.instance.onError = (error, stackTrace) {
      AppLogger.error(
        'Unhandled platform error',
        error: error,
        stackTrace: stackTrace,
        source: 'platform.unhandled',
      );
      return true;
    };
  }

  static void onZoneError(Object error, StackTrace stackTrace) {
    AppLogger.error(
      'Unhandled zone error',
      error: error,
      stackTrace: stackTrace,
      source: 'zone.unhandled',
    );
  }
}
