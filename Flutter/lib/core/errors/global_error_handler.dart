import 'package:abstergo_chase/core/logging/app_logger.dart';
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
      );
    };

    PlatformDispatcher.instance.onError = (error, stackTrace) {
      AppLogger.error(
        'Unhandled platform error',
        error: error,
        stackTrace: stackTrace,
      );
      return true;
    };
  }

  static void onZoneError(Object error, StackTrace stackTrace) {
    AppLogger.error(
      'Unhandled zone error',
      error: error,
      stackTrace: stackTrace,
    );
  }
}
