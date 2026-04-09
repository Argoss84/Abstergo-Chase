import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:flutter/material.dart';

class CreateLobbyDetailsSheet extends StatefulWidget {
  const CreateLobbyDetailsSheet({
    super.key,
    required this.initialData,
  });

  final CreateLobbyFormData initialData;

  @override
  State<CreateLobbyDetailsSheet> createState() =>
      _CreateLobbyDetailsSheetState();
}

class _CreateLobbyDetailsSheetState extends State<CreateLobbyDetailsSheet> {
  late CreateLobbyFormData _form;

  @override
  void initState() {
    super.initState();
    _form = widget.initialData;
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
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(_form),
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
}
