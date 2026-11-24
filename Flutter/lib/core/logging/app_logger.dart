import 'dart:async';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:broken_veil_protocol/core/logging/error_record.dart';
import 'package:flutter/foundation.dart';

class AppLogger {
  const AppLogger._();

  static final String sessionId = newErrorId();
  static String? currentRoute;
  static String? appState;
  static String appVersion = AppRuntimeConfig.appVersion;
  static Future<void> Function(ErrorRecord record)? _errorSink;
  static Future<void>? _pendingWrites;

  static void setErrorSink(Future<void> Function(ErrorRecord record)? sink) {
    _errorSink = sink;
  }

  static Future<void> flush() => _pendingWrites ?? Future.value();

  static void debug(String message) {
    _log('DEBUG', message);
  }

  static void info(String message) {
    _log('INFO', message);
  }

  static void warn(String message) {
    _log('WARN', message);
  }

  static void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    String source = 'application',
  }) {
    final record = ErrorRecord.capture(
      sessionId: sessionId,
      message: message,
      source: source,
      error: error,
      stackTrace: stackTrace ?? StackTrace.current,
      route: currentRoute,
      appState: appState,
      appVersion: appVersion.isEmpty ? 'unknown' : appVersion,
    );
    final buffer = StringBuffer(record.message);
    if (record.error != null) {
      buffer.write(' | error=${record.error}');
    }
    if (stackTrace != null) {
      buffer.write('\n${record.stackTrace}');
    }
    _log('ERROR', buffer.toString());
    final sink = _errorSink;
    if (sink != null) {
      final pending = (_pendingWrites ?? Future<void>.value())
          .then((_) => sink(record))
          .catchError((Object error) {
            // Do not recurse through global handlers when storage itself is unavailable.
            debugPrint(
              'Error journal write failed: ${sanitizeErrorText(error.toString())}',
            );
          });
      _pendingWrites = pending;
      unawaited(
        pending.whenComplete(() {
          if (identical(_pendingWrites, pending)) _pendingWrites = null;
        }),
      );
    }
  }

  static void _log(String level, String message) {
    final now = DateTime.now().toIso8601String();
    debugPrint('[$now][$level] $message');
  }
}
