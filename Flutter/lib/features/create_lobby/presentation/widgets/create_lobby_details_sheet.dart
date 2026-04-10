import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:flutter/material.dart';

class CreateLobbyDetailsSheet extends StatefulWidget {
  const CreateLobbyDetailsSheet({
    super.key,
    required this.initialData,
    required this.initialServerUrl,
    required this.initialSocketPath,
  });

  final CreateLobbyFormData initialData;
  final String initialServerUrl;
  final String initialSocketPath;

  @override
  State<CreateLobbyDetailsSheet> createState() =>
      _CreateLobbyDetailsSheetState();
}

class _CreateLobbyDetailsSheetState extends State<CreateLobbyDetailsSheet> {
  late CreateLobbyFormData _form;
  late final TextEditingController _serverController;
  late final TextEditingController _socketPathController;

  @override
  void initState() {
    super.initState();
    _form = widget.initialData;
    _serverController = TextEditingController(text: widget.initialServerUrl);
    _socketPathController =
        TextEditingController(text: widget.initialSocketPath);
  }

  @override
  void dispose() {
    _serverController.dispose();
    _socketPathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            const Text(
              'Paramètres de la partie',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            _numberField(
              label: "Nombre d'objectifs",
              value: _form.objectiveNumber,
              onChanged: (v) => _form = _form.copyWith(objectiveNumber: v),
            ),
            _numberField(
              label: 'Durée (secondes)',
              value: _form.duration,
              onChanged: (v) => _form = _form.copyWith(duration: v),
            ),
            _numberField(
              label: "Objectifs pour victoire",
              value: _form.victoryConditionObjectives,
              onChanged: (v) =>
                  _form = _form.copyWith(victoryConditionObjectives: v),
            ),
            _numberField(
              label: 'Durée hack (ms)',
              value: _form.hackDurationMs,
              onChanged: (v) => _form = _form.copyWith(hackDurationMs: v),
            ),
            _numberField(
              label: 'Rayon zone objectifs',
              value: _form.objectiveZoneRadius,
              onChanged: (v) => _form = _form.copyWith(objectiveZoneRadius: v),
            ),
            _numberField(
              label: 'Portée Rogue',
              value: _form.rogueRange,
              onChanged: (v) => _form = _form.copyWith(rogueRange: v),
            ),
            _numberField(
              label: 'Portée Agent',
              value: _form.agentRange,
              onChanged: (v) => _form = _form.copyWith(agentRange: v),
            ),
            _numberField(
              label: 'Rayon carte (m)',
              value: _form.mapRadius,
              onChanged: (v) => _form = _form.copyWith(mapRadius: v),
            ),
            _textField(
              label: 'URL serveur',
              controller: _serverController,
            ),
            _textField(
              label: 'Socket path',
              controller: _socketPathController,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(
                CreateLobbyDetailsResult(
                  form: _form,
                  serverUrl: _serverController.text.trim(),
                  socketPath: _socketPathController.text.trim(),
                ),
              ),
              child: const Text('Appliquer'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _numberField({
    required String label,
    required int value,
    required ValueChanged<int> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: value.toString(),
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          labelText: label,
        ),
        onChanged: (raw) => onChanged(int.tryParse(raw) ?? value),
      ),
    );
  }

  Widget _textField({
    required String label,
    required TextEditingController controller,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          labelText: label,
        ),
      ),
    );
  }
}

class CreateLobbyDetailsResult {
  const CreateLobbyDetailsResult({
    required this.form,
    required this.serverUrl,
    required this.socketPath,
  });

  final CreateLobbyFormData form;
  final String serverUrl;
  final String socketPath;
}
