import 'dart:convert';

import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:broken_veil_protocol/core/logging/error_journal.dart';
import 'package:broken_veil_protocol/core/logging/error_record.dart';
import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

class ErrorJournalPage extends StatefulWidget {
  const ErrorJournalPage({super.key, this.journal});

  static const routePath = '/error-journal';
  static const routeName = 'error-journal';
  final ErrorJournal? journal;

  @override
  State<ErrorJournalPage> createState() => _ErrorJournalPageState();
}

class _ErrorJournalPageState extends State<ErrorJournalPage> {
  late final ErrorJournal _journal = widget.journal ?? ErrorJournal.instance;
  List<ErrorRecord> _entries = [];
  List<Map<String, Object?>> _sessions = [];
  String? _sessionId;
  String? _error;
  int _pending = 0;
  int _limit = 100;
  bool _loading = true;
  bool _working = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await AppLogger.flush();
      final entries = await _journal.entries(
        sessionId: _sessionId,
        limit: _limit,
      );
      final sessions = await _journal.sessions();
      final pending = await _journal.pendingCount();
      if (!mounted) return;
      setState(() {
        _entries = entries;
        _sessions = sessions;
        _pending = pending;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Le journal ne peut pas être chargé. Réessayez.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _perform(Future<void> Function() action) async {
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _error = 'Cette action a échoué. Les erreurs restent conservées.',
        );
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _export({bool copy = false}) => _perform(() async {
    final box = context.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    await AppLogger.flush();
    final content = await _journal.exportJson(sessionId: _sessionId);
    if (!mounted) return;
    if (copy) {
      await Clipboard.setData(ClipboardData(text: content));
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Journal copié.')));
      }
      return;
    }
    final date = DateTime.now().toUtc().toIso8601String().replaceAll(
      RegExp(r'[:.]'),
      '-',
    );
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(utf8.encode(content), mimeType: 'application/json'),
        ],
        fileNameOverrides: ['abstergo-errors-$date.json'],
        subject: 'Journal des erreurs Abstergo-Chase',
        sharePositionOrigin: origin,
      ),
    );
  });

  Future<void> _upload() => _perform(() async {
    await AppLogger.flush();
    await _journal.uploadPending();
    await _load();
  });

  Future<void> _testCollection() => _perform(() async {
    await _journal.record(
      ErrorRecord.capture(
        sessionId: AppLogger.sessionId,
        message: 'Erreur de test volontaire pour vérifier la collecte.',
        source: 'diagnostics.test',
        error: StateError(
          'Ceci est un test du journal, sans effet sur la partie.',
        ),
        stackTrace: StackTrace.current,
        route: ErrorJournalPage.routePath,
        appVersion: AppLogger.appVersion.isEmpty
            ? 'unknown'
            : AppLogger.appVersion,
      ),
    );
    await _journal.uploadPending();
    await _load();
  });

  Future<void> _clear() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Effacer les erreurs locales ?'),
        content: Text(
          _sessionId == null
              ? 'Toutes les erreurs de cet appareil seront supprimées. Les copies déjà envoyées au serveur sont conservées.'
              : 'Les erreurs de cette session seront supprimées de cet appareil. Les copies déjà envoyées au serveur sont conservées.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Effacer'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _perform(() async {
      await AppLogger.flush();
      await _journal.clear(sessionId: _sessionId);
      _sessionId = null;
      await _load();
    });
  }

  String _date(DateTime date) {
    final local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }

  @override
  Widget build(BuildContext context) {
    final total = _sessions.fold<int>(
      0,
      (sum, session) => sum + (session['error_count']! as int),
    );
    final busy = _working || _loading;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Journal des erreurs'),
        actions: [
          IconButton(
            onPressed: busy ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Actualiser',
          ),
        ],
      ),
      body: AppPageBody(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                key: const PageStorageKey('error-journal-list'),
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    '$total erreur${total > 1 ? 's' : ''} enregistrée${total > 1 ? 's' : ''}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Les erreurs restent sur cet appareil après fermeture de l’application. Chaque session correspond à un lancement.',
                  ),
                  const SizedBox(height: 12),
                  if (_error != null) ...[
                    AppNotice(message: _error!, isError: true),
                    const SizedBox(height: 12),
                  ],
                  if (_journal.lastStorageError != null) ...[
                    AppNotice(
                      message: _journal.lastStorageError!,
                      isError: true,
                    ),
                    const SizedBox(height: 12),
                  ],
                  AppNotice(
                    message: !_journal.isCollectorConfigured
                        ? 'Collecte en ligne non configurée. Vous pouvez exporter le journal.'
                        : '$_pending erreur${_pending > 1 ? 's' : ''} en attente d’envoi au serveur.',
                  ),
                  if (_journal.lastUploadError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_journal.lastUploadError!),
                    ),
                  const SizedBox(height: 16),
                  InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Session de test',
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        isExpanded: true,
                        value: _sessionId ?? '',
                        items: [
                          const DropdownMenuItem(
                            value: '',
                            child: Text('Toutes les sessions'),
                          ),
                          ..._sessions.map((session) {
                            final id = session['session_id']! as String;
                            final current = id == AppLogger.sessionId
                                ? ' • actuelle'
                                : '';
                            return DropdownMenuItem(
                              value: id,
                              child: Text(
                                '${_date(DateTime.parse(session['first_error_at']! as String))} • ${session['error_count']}$current',
                                overflow: TextOverflow.ellipsis,
                              ),
                            );
                          }),
                        ],
                        onChanged: busy
                            ? null
                            : (value) {
                                _sessionId = value == '' ? null : value;
                                _limit = 100;
                                _load();
                              },
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: busy ? null : _testCollection,
                        icon: const Icon(Icons.fact_check_outlined),
                        label: const Text('Vérifier la collecte'),
                      ),
                      FilledButton.icon(
                        onPressed: busy || _entries.isEmpty
                            ? null
                            : () => _export(),
                        icon: const Icon(Icons.ios_share),
                        label: const Text('Exporter'),
                      ),
                      OutlinedButton.icon(
                        onPressed: busy || _entries.isEmpty
                            ? null
                            : () => _export(copy: true),
                        icon: const Icon(Icons.copy),
                        label: const Text('Copier'),
                      ),
                      if (_journal.isCollectorConfigured)
                        OutlinedButton.icon(
                          onPressed: busy ? null : _upload,
                          icon: const Icon(Icons.cloud_upload_outlined),
                          label: const Text('Envoyer au serveur'),
                        ),
                      TextButton.icon(
                        onPressed: busy || _entries.isEmpty ? null : _clear,
                        icon: const Icon(Icons.delete_outline),
                        label: const Text('Effacer'),
                      ),
                    ],
                  ),
                  if (_working)
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: LinearProgressIndicator(),
                    ),
                  const SizedBox(height: 16),
                  if (_entries.isEmpty && _error == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: Center(child: Text('Aucune erreur enregistrée.')),
                    ),
                  ..._entries.map(
                    (entry) => Card(
                      key: ValueKey(entry.id),
                      child: ExpansionTile(
                        key: PageStorageKey('error-${entry.id}'),
                        leading: Icon(
                          entry.uploadedAt == null
                              ? Icons.error_outline
                              : Icons.cloud_done_outlined,
                        ),
                        title: Text(entry.message),
                        subtitle: Text(
                          '${_date(entry.occurredAt)} • ${entry.source}',
                        ),
                        childrenPadding: const EdgeInsets.fromLTRB(
                          16,
                          0,
                          16,
                          16,
                        ),
                        expandedCrossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SelectableText(
                            // Expansion state and text scroll offsets use
                            // different PageStorage entries.
                            key: PageStorageKey('error-details-${entry.id}'),
                            [
                              'Session : ${entry.sessionId}',
                              'Version : ${entry.appVersion} • ${entry.platform} • ${entry.buildMode}',
                              'Environnement : ${entry.environment}',
                              if (entry.route != null) 'Écran : ${entry.route}',
                              if (entry.appState != null)
                                'État : ${entry.appState}',
                              'Envoi : ${entry.uploadedAt == null ? 'en attente' : _date(entry.uploadedAt!)}',
                              if (entry.error != null)
                                '\n${entry.errorType} : ${entry.error}',
                              if (entry.stackTrace != null)
                                '\n${entry.stackTrace}',
                            ].join('\n'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_entries.length == _limit)
                    TextButton(
                      onPressed: busy
                          ? null
                          : () {
                              _limit += 100;
                              _load();
                            },
                      child: const Text('Afficher plus'),
                    ),
                ],
              ),
      ),
    );
  }
}
