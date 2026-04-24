import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:flutter/material.dart';

class CreateLobbyDetailsSheet extends StatefulWidget {
  const CreateLobbyDetailsSheet({super.key, required this.initialData});

  final CreateLobbyFormData initialData;

  @override
  State<CreateLobbyDetailsSheet> createState() =>
      _CreateLobbyDetailsSheetState();
}

class _CreateLobbyDetailsSheetState extends State<CreateLobbyDetailsSheet> {
  late CreateLobbyFormData _form;
  late int _durationMinutes;
  late int _durationSeconds;

  @override
  void initState() {
    super.initState();
    _form = widget.initialData;
    _durationMinutes = _form.duration ~/ 60;
    _durationSeconds = _form.duration % 60;
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
            _durationField(),
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
              label: 'Rayon zone départ (m)',
              value: _form.startZoneRadius,
              onChanged: (v) => _form = _form.copyWith(startZoneRadius: v),
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
              onPressed: () => Navigator.of(
                context,
              ).pop(CreateLobbyDetailsResult(form: _form)),
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

  Widget _durationField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InputDecorator(
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          labelText: 'Durée (minutes + secondes)',
        ),
        child: Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _durationMinutes,
                decoration: const InputDecoration(
                  labelText: 'Minutes',
                  border: OutlineInputBorder(),
                ),
                items: List.generate(
                  61,
                  (i) => DropdownMenuItem<int>(
                    value: i,
                    child: Text(i.toString().padLeft(2, '0')),
                  ),
                ),
                onChanged: (value) {
                  if (value == null) return;
                  setState(() {
                    _durationMinutes = value;
                    _applyDuration();
                  });
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _durationSeconds,
                decoration: const InputDecoration(
                  labelText: 'Secondes',
                  border: OutlineInputBorder(),
                ),
                items: List.generate(
                  60,
                  (i) => DropdownMenuItem<int>(
                    value: i,
                    child: Text(i.toString().padLeft(2, '0')),
                  ),
                ),
                onChanged: (value) {
                  if (value == null) return;
                  setState(() {
                    _durationSeconds = value;
                    _applyDuration();
                  });
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _applyDuration() {
    final total = (_durationMinutes * 60) + _durationSeconds;
    _form = _form.copyWith(duration: total <= 0 ? 1 : total);
  }
}

class CreateLobbyDetailsResult {
  const CreateLobbyDetailsResult({required this.form});

  final CreateLobbyFormData form;
}
