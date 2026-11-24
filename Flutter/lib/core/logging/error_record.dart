import 'dart:math';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:flutter/foundation.dart';

String newErrorId() {
  final random = Random.secure();
  return List.generate(
    16,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

String sanitizeErrorText(String value, {int maximum = 8192}) {
  var result = value
      .replaceAll(
        RegExp(r'\bBearer\s+[A-Za-z0-9._~+/=-]+', caseSensitive: false),
        'Bearer [REDACTED]',
      )
      .replaceAll(
        RegExp(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b'),
        '[REDACTED JWT]',
      );
  result = result.replaceAllMapped(
    RegExp(
      r'''((?:access[_-]?token|id[_-]?token|refresh[_-]?token|password|client[_-]?secret|authorization)["']?\s*[:=]\s*["']?)([^"'\s,;}\]]+)''',
      caseSensitive: false,
    ),
    (match) => '${match[1]}[REDACTED]',
  );
  return result.length <= maximum
      ? result
      : '${result.substring(0, maximum - 14)}… [truncated]';
}

class ErrorRecord {
  const ErrorRecord({
    required this.id,
    required this.sessionId,
    required this.occurredAt,
    required this.source,
    required this.message,
    required this.platform,
    required this.buildMode,
    required this.environment,
    required this.appVersion,
    this.errorType,
    this.error,
    this.stackTrace,
    this.route,
    this.appState,
    this.uploadedAt,
  });

  factory ErrorRecord.capture({
    required String sessionId,
    required String message,
    required String source,
    Object? error,
    StackTrace? stackTrace,
    String? route,
    String? appState,
    String? appVersion,
  }) => ErrorRecord(
    id: newErrorId(),
    sessionId: sessionId,
    occurredAt: DateTime.now().toUtc(),
    source: sanitizeErrorText(source, maximum: 255),
    message: sanitizeErrorText(message, maximum: 4096),
    errorType: error == null
        ? null
        : sanitizeErrorText(error.runtimeType.toString(), maximum: 255),
    error: error == null ? null : sanitizeErrorText(error.toString()),
    stackTrace: stackTrace == null
        ? null
        : sanitizeErrorText(stackTrace.toString(), maximum: 32768),
    route: route == null ? null : sanitizeErrorText(route, maximum: 255),
    appState: appState,
    platform: kIsWeb ? 'web' : defaultTargetPlatform.name,
    buildMode: kReleaseMode ? 'release' : (kProfileMode ? 'profile' : 'debug'),
    environment: sanitizeErrorText(
      AppRuntimeConfig.errorReportingEnvironment,
      maximum: 32,
    ),
    appVersion: sanitizeErrorText(appVersion ?? 'unknown', maximum: 64),
  );

  factory ErrorRecord.fromDatabase(Map<String, Object?> row) => ErrorRecord(
    id: row['id']! as String,
    sessionId: row['session_id']! as String,
    occurredAt: DateTime.parse(row['occurred_at']! as String),
    source: row['source']! as String,
    message: row['message']! as String,
    platform: row['platform']! as String,
    buildMode: row['build_mode']! as String,
    environment: row['environment']! as String,
    appVersion: row['app_version']! as String,
    errorType: row['error_type'] as String?,
    error: row['error_text'] as String?,
    stackTrace: row['stack_trace'] as String?,
    route: row['route'] as String?,
    appState: row['app_state'] as String?,
    uploadedAt: row['uploaded_at'] == null
        ? null
        : DateTime.parse(row['uploaded_at']! as String),
  );

  final String id;
  final String sessionId;
  final DateTime occurredAt;
  final String source;
  final String message;
  final String platform;
  final String buildMode;
  final String environment;
  final String appVersion;
  final String? errorType;
  final String? error;
  final String? stackTrace;
  final String? route;
  final String? appState;
  final DateTime? uploadedAt;

  Map<String, Object?> toJson() => {
    'id': id,
    'sessionId': sessionId,
    'occurredAt': occurredAt.toUtc().toIso8601String(),
    'source': source,
    'message': message,
    'errorType': errorType,
    'error': error,
    'stackTrace': stackTrace,
    'route': route,
    'appState': appState,
    'platform': platform,
    'buildMode': buildMode,
    'environment': environment,
    'appVersion': appVersion,
  };

  Map<String, Object?> toDatabase() => {
    'id': id,
    'session_id': sessionId,
    'occurred_at': occurredAt.toUtc().toIso8601String(),
    'occurred_at_ms': occurredAt.millisecondsSinceEpoch,
    'source': source,
    'message': message,
    'error_type': errorType,
    'error_text': error,
    'stack_trace': stackTrace,
    'route': route,
    'app_state': appState,
    'platform': platform,
    'build_mode': buildMode,
    'environment': environment,
    'app_version': appVersion,
    'uploaded_at': uploadedAt?.toUtc().toIso8601String(),
  };
}
