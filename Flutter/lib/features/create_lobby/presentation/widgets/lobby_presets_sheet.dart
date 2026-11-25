import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LobbyPresetsSheet extends ConsumerStatefulWidget {
  const LobbyPresetsSheet({super.key, required this.form});
  final CreateLobbyFormData form;

  @override
  ConsumerState<LobbyPresetsSheet> createState() => _LobbyPresetsSheetState();
}

class _LobbyPresetsSheetState extends ConsumerState<LobbyPresetsSheet> {
  final _name = TextEditingController();
  late Future<Map<String, dynamic>> _presets;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _presets = _request();
  }

  Future<Map<String, dynamic>> _request({
    String method = 'GET',
    Map<String, Object?>? body,
    String? id,
  }) async {
    final auth = ref.read(authControllerProvider);
    final token = await auth.getAccessToken();
    if (token == null) throw StateError('Reconnecte-toi à ton compte.');
    return auth.accountApi.request(
      token,
      '/users/me/lobby-presets${id == null ? '' : '/$id'}',
      method: method,
      body: body,
    );
  }

  Future<void> _change({String? id}) async {
    if (_saving || (id == null && _name.text.trim().isEmpty)) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (id == null) {
        await _request(
          method: 'PUT',
          body: {'name': _name.text.trim(), 'config': widget.form.toPreset()},
        );
      } else {
        await _request(method: 'DELETE', id: id);
      }
      if (mounted) {
        _name.clear();
        setState(() => _presets = _request());
      }
    } catch (failure) {
      if (mounted) setState(() => _error = failure.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: FutureBuilder<Map<String, dynamic>>(
        future: _presets,
        builder: (context, snapshot) => ListView(
          shrinkWrap: true,
          children: [
            Text(
              'Préréglages de salon',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (snapshot.hasError) Text(snapshot.error.toString()),
            if (!snapshot.hasData && !snapshot.hasError)
              const Center(child: CircularProgressIndicator()),
            for (final preset
                in (snapshot.data?['presets'] as List? ?? []).whereType<Map>())
              ListTile(
                title: Text(preset['name'].toString()),
                onTap: () => Navigator.pop(
                  context,
                  widget.form.withPreset(
                    Map<String, dynamic>.from(preset['config_json'] as Map),
                  ),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Supprimer le préréglage',
                  onPressed: _saving
                      ? null
                      : () => _change(id: preset['id'].toString()),
                ),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              maxLength: 60,
              decoration: const InputDecoration(labelText: 'Nom du préréglage'),
            ),
            if (_error != null) Text(_error!),
            FilledButton(
              onPressed: _saving ? null : _change,
              child: const Text('Enregistrer les réglages actuels'),
            ),
          ],
        ),
      ),
    ),
  );
}
