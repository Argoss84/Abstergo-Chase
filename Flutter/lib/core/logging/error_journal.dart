import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:broken_veil_protocol/core/logging/error_record.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

class ErrorJournal {
  ErrorJournal({
    DatabaseFactory? databaseFactoryOverride,
    String? databasePath,
    http.Client? client,
    String collectorUrl = AppRuntimeConfig.errorCollectorUrl,
    Future<String?> Function()? accessTokenProvider,
    bool allowInsecureTransport = !kReleaseMode,
  }) : _factoryOverride = databaseFactoryOverride,
       _databasePath = databasePath,
       _client = client ?? http.Client(),
       _collectorUrl = collectorUrl,
       _accessTokenProvider = accessTokenProvider,
       _allowInsecureTransport = allowInsecureTransport;

  static final ErrorJournal instance = ErrorJournal();
  static const databaseFileName = 'abstergo_errors.db';
  final DatabaseFactory? _factoryOverride;
  final String? _databasePath;
  final http.Client _client;
  final String _collectorUrl;
  final bool _allowInsecureTransport;
  Future<String?> Function()? _accessTokenProvider;
  bool Function()? _isAuthenticated;
  Future<Database>? _opening;
  Future<void>? _uploading;
  Timer? _uploadTimer;
  Timer? _scheduledUpload;
  bool _closed = false;
  String? lastUploadError;
  String? lastStorageError;
  DateTime? lastUploadedAt;

  bool get isCollectorConfigured => _collectorUrl.isNotEmpty;

  Future<Database> _open() {
    if (_closed) return Future.error(StateError('Journal fermé'));
    return _opening ??= _openDatabase().catchError((Object error) {
      _opening = null;
      throw error;
    });
  }

  Future<Database> _openDatabase() async {
    final factory = _factoryOverride ?? databaseFactory;
    final databasePath =
        _databasePath ??
        path.join(await factory.getDatabasesPath(), databaseFileName);
    return factory.openDatabase(
      databasePath,
      options: OpenDatabaseOptions(
        version: 2,
        onUpgrade: (db, _, _) => _createDiagnosticsOutbox(db),
        onCreate: (db, _) async {
          await db.execute('''CREATE TABLE error_events (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
          source TEXT NOT NULL, message TEXT NOT NULL, error_type TEXT,
          error_text TEXT, stack_trace TEXT, route TEXT, app_state TEXT,
          platform TEXT NOT NULL, build_mode TEXT NOT NULL,
          environment TEXT NOT NULL, app_version TEXT NOT NULL, uploaded_at TEXT
        )''');
          await db.execute(
            'CREATE INDEX error_events_session ON error_events(session_id, occurred_at_ms)',
          );
          await db.execute(
            'CREATE INDEX error_events_pending ON error_events(uploaded_at, occurred_at_ms)',
          );
          await _createDiagnosticsOutbox(db);
        },
      ),
    );
  }

  static Future<void> _createDiagnosticsOutbox(Database db) async {
    await db.execute(
      'ALTER TABLE error_events ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0',
    );
    await db.execute(
      'CREATE TABLE voice_outbox (id TEXT PRIMARY KEY, body_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL)',
    );
  }

  Future<void> initialize({
    Future<String?> Function()? accessTokenProvider,
    bool Function()? isAuthenticated,
  }) async {
    _isAuthenticated = isAuthenticated ?? _isAuthenticated;
    _accessTokenProvider = accessTokenProvider ?? _accessTokenProvider;
    await _open();
    if (isCollectorConfigured && _uploadTimer == null && !_closed) {
      _uploadTimer = Timer.periodic(
        const Duration(minutes: 1),
        (_) => unawaited(uploadPending()),
      );
      scheduleUpload();
    }
  }

  Future<void> record(ErrorRecord record) async {
    try {
      final db = await _open();
      await db.insert('error_events', {
        ...record.toDatabase(),
        'anonymous': _isAuthenticated?.call() == true ? 0 : 1,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
      lastStorageError = null;
      scheduleUpload();
    } catch (error) {
      lastStorageError =
          'Impossible d’enregistrer les erreurs sur cet appareil.';
      rethrow;
    }
  }

  Future<List<ErrorRecord>> entries({
    String? sessionId,
    int? limit = 200,
    int offset = 0,
    bool pendingOnly = false,
    bool? anonymous,
  }) async {
    final db = await _open();
    final conditions = <String>[
      if (sessionId != null) 'session_id = ?',
      if (pendingOnly) 'uploaded_at IS NULL',
      if (anonymous != null) 'anonymous = ?',
    ];
    final rows = await db.query(
      'error_events',
      where: conditions.isEmpty ? null : conditions.join(' AND '),
      whereArgs: [?sessionId, if (anonymous != null) anonymous ? 1 : 0],
      orderBy: pendingOnly
          ? 'occurred_at_ms ASC, rowid ASC'
          : 'occurred_at_ms DESC, rowid DESC',
      limit: limit,
      offset: limit == null ? null : offset,
    );
    return rows.map(ErrorRecord.fromDatabase).toList(growable: false);
  }

  Future<List<Map<String, Object?>>> sessions() async {
    final db = await _open();
    return db.rawQuery('''SELECT session_id, MIN(occurred_at) AS first_error_at,
      COUNT(*) AS error_count FROM error_events GROUP BY session_id
      ORDER BY MAX(occurred_at_ms) DESC LIMIT 200''');
  }

  Future<int> pendingCount() async {
    final db = await _open();
    return Sqflite.firstIntValue(
          await db.rawQuery(
            'SELECT COUNT(*) FROM error_events WHERE uploaded_at IS NULL',
          ),
        ) ??
        0;
  }

  Future<String> exportJson({String? sessionId}) async {
    final records = await entries(sessionId: sessionId, limit: null);
    return const JsonEncoder.withIndent('  ').convert({
      'schemaVersion': 1,
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'sessionId': sessionId,
      'events': records
          .map(
            (event) => {
              ...event.toJson(),
              'uploadedAt': event.uploadedAt?.toUtc().toIso8601String(),
            },
          )
          .toList(),
    });
  }

  Future<void> clear({String? sessionId}) async {
    // Wait for an ongoing upload so its acknowledgement cannot affect a later session.
    await _uploading;
    final db = await _open();
    await db.delete(
      'error_events',
      where: sessionId == null ? null : 'session_id = ?',
      whereArgs: sessionId == null ? null : [sessionId],
    );
  }

  void scheduleUpload() {
    if (!isCollectorConfigured || _closed || _scheduledUpload != null) return;
    _scheduledUpload = Timer(const Duration(seconds: 3), () {
      _scheduledUpload = null;
      unawaited(uploadPending());
    });
  }

  Future<void> uploadPending() {
    if (_closed || !isCollectorConfigured) return Future.value();
    return _uploading ??= _upload().whenComplete(() => _uploading = null);
  }

  Future<void> recordVoice({
    required String sessionId,
    required String phase,
    required Map<String, int> counters,
  }) async {
    if (!isCollectorConfigured || _closed) return;
    final now = DateTime.now().toUtc();
    final id = newErrorId();
    final db = await _open();
    await db.insert('voice_outbox', {
      'id': id,
      'created_at_ms': now.millisecondsSinceEpoch,
      'body_json': jsonEncode({
        'id': id,
        'sessionId': sessionId,
        'environment': AppRuntimeConfig.errorReportingEnvironment,
        'phase': phase,
        'occurredAt': now.toIso8601String(),
        ...counters,
      }),
    });
    scheduleUpload();
  }

  Future<void> _upload() async {
    try {
      final uri = Uri.parse(_collectorUrl);
      if (!uri.hasAuthority ||
          (uri.scheme != 'https' &&
              !(_allowInsecureTransport && uri.scheme == 'http')) ||
          uri.userInfo.isNotEmpty ||
          uri.hasQuery ||
          uri.hasFragment) {
        throw StateError('Adresse de collecte invalide.');
      }
      final token = await _accessTokenProvider?.call();
      final db = await _open();
      final cutoff = DateTime.now()
          .subtract(const Duration(days: 30))
          .millisecondsSinceEpoch;
      await db.delete(
        'voice_outbox',
        where: 'created_at_ms < ?',
        whereArgs: [cutoff],
      );
      for (final anonymous in [true, false]) {
        if (!anonymous && (token == null || token.isEmpty)) continue;
        final endpoint = anonymous
            ? uri.replace(pathSegments: [...uri.pathSegments, 'anonymous'])
            : uri;
        for (var batch = 0; batch < 10; batch++) {
          final records = await entries(
            pendingOnly: true,
            limit: 50,
            anonymous: anonymous,
          );
          if (records.isEmpty) break;
          final sentIds = records.map((record) => record.id).toSet();
          final accepted = await _sendBatch(
            endpoint,
            {'events': records.map((record) => record.toJson()).toList()},
            sentIds,
            anonymous ? null : token,
          );
          await db.update(
            'error_events',
            {'uploaded_at': DateTime.now().toUtc().toIso8601String()},
            where: 'id IN (${List.filled(accepted.length, '?').join(',')})',
            whereArgs: accepted,
          );
          if (accepted.length < sentIds.length) break;
        }
      }
      if (token != null && token.isNotEmpty) {
        final rows = await db.query(
          'voice_outbox',
          orderBy: 'created_at_ms',
          limit: 50,
        );
        if (rows.isNotEmpty) {
          final accepted = await _sendBatch(
            uri.replace(
              pathSegments: [
                ...uri.pathSegments.take(uri.pathSegments.length - 1),
                'voice-routes',
              ],
            ),
            {
              'samples': rows
                  .map((row) => jsonDecode(row['body_json']! as String))
                  .toList(),
            },
            rows.map((row) => row['id']! as String).toSet(),
            token,
          );
          await db.delete(
            'voice_outbox',
            where: 'id IN (${List.filled(accepted.length, '?').join(',')})',
            whereArgs: accepted,
          );
        }
      }
      lastUploadError = null;
    } catch (error) {
      // Keep the outbox intact whenever a request lacks an acknowledgement.
      lastUploadError = sanitizeErrorText(error.toString());
    }
  }

  Future<List<String>> _sendBatch(
    Uri uri,
    Map<String, Object?> body,
    Set<String> sentIds,
    String? bearer,
  ) async {
    final request = http.Request('POST', uri)
      ..followRedirects = false
      ..headers.addAll({
        'Content-Type': 'application/json',
        if (bearer != null) 'Authorization': 'Bearer $bearer',
      })
      ..body = jsonEncode(body);
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 202) {
      throw StateError(
        'Collecteur indisponible (HTTP ${response.statusCode}).',
      );
    }
    final decoded = jsonDecode(response.body);
    final accepted = decoded is Map ? decoded['acceptedIds'] : null;
    if (accepted is! List ||
        accepted.isEmpty ||
        accepted.any((id) => id is! String || !sentIds.contains(id))) {
      throw StateError('Accusé de réception du collecteur invalide.');
    }
    lastUploadedAt = DateTime.now().toUtc();
    return accepted.cast<String>().toSet().toList();
  }

  Future<void> close() async {
    _closed = true;
    _uploadTimer?.cancel();
    _scheduledUpload?.cancel();
    await _uploading;
    if (_opening != null) await (await _opening!).close();
    _client.close();
  }
}
