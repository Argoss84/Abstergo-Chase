import 'dart:math';

import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
  final _formKey = GlobalKey<FormState>();
  final _scrollController = ScrollController();
  final _secondsKey = GlobalKey<FormFieldState<int>>();
  final _numberKeys = <String, GlobalKey<FormFieldState<String>>>{
    for (final id in [
      'objectives',
      'victory',
      'map',
      'start',
      'hack',
      'rogue',
      'agent',
    ])
      id: GlobalKey<FormFieldState<String>>(),
  };
  bool _showTerrain = false;
  bool _showRoles = false;
  bool _didApply = false;

  @override
  void initState() {
    super.initState();
    _form = widget.initialData;
    _durationMinutes = _form.duration ~/ 60;
    _durationSeconds = _form.duration % 60;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _apply() {
    FocusScope.of(context).unfocus();
    final invalid = _formKey.currentState!.validateGranularly();
    if (invalid.isEmpty) {
      Navigator.of(context).pop(CreateLobbyDetailsResult(form: _form));
      return;
    }
    setState(() {
      _didApply = true;
      if ([
        'map',
        'start',
      ].any((id) => invalid.contains(_numberKeys[id]!.currentState))) {
        _showTerrain = true;
      }
      if ([
        'hack',
        'rogue',
        'agent',
      ].any((id) => invalid.contains(_numberKeys[id]!.currentState))) {
        _showRoles = true;
      }
    });
    final firstError = invalid.first;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !firstError.mounted) return;
      Scrollable.ensureVisible(
        firstError.context,
        alignment: 0.1,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 200),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final scheme = Theme.of(context).colorScheme;
    final availableHeight = max(
      0.0,
      media.size.height - media.viewInsets.bottom - media.padding.vertical,
    );
    return AnimatedPadding(
      duration: media.disableAnimations
          ? Duration.zero
          : const Duration(milliseconds: 160),
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: min(740, availableHeight * 0.94),
          child: Form(
            key: _formKey,
            autovalidateMode: _didApply
                ? AutovalidateMode.onUserInteraction
                : AutovalidateMode.disabled,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 8, 16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Semantics(
                              header: true,
                              child: Text(
                                media.viewInsets.bottom > 0
                                    ? 'Paramètres'
                                    : 'Paramètres de la partie',
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                            ),
                            if (media.viewInsets.bottom == 0 &&
                                media.textScaler.scale(1) <= 1.3) ...[
                              const SizedBox(height: 4),
                              Text(
                                'Les modifications seront appliquées après validation.',
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(color: scheme.onSurfaceVariant),
                              ),
                            ],
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Fermer les paramètres',
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: SingleChildScrollView(
                    controller: _scrollController,
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _group(
                          title: 'Règles de victoire',
                          description:
                              'Définissez la durée et les objectifs de la partie.',
                          icon: Icons.flag_outlined,
                          children: [
                            _durationField(),
                            _numberField(
                              id: 'objectives',
                              label: "Nombre d'objectifs",
                              helper: 'Points à placer sur le terrain.',
                              value: _form.objectiveNumber,
                              onChanged: (v) =>
                                  _form = _form.copyWith(objectiveNumber: v),
                            ),
                            _numberField(
                              id: 'victory',
                              label: 'Objectifs à capturer',
                              helper:
                                  'Nombre nécessaire pour une victoire des Rogues.',
                              value: _form.victoryConditionObjectives,
                              onChanged: (v) => _form = _form.copyWith(
                                victoryConditionObjectives: v,
                              ),
                            ),
                          ],
                        ),
                        _group(
                          title: 'Terrain et distances',
                          description:
                              'Limites de la partie et zones de départ.',
                          icon: Icons.radar,
                          expanded: _showTerrain,
                          onToggle: () =>
                              setState(() => _showTerrain = !_showTerrain),
                          children: [
                            _numberField(
                              id: 'map',
                              label: 'Rayon du terrain',
                              unit: 'm',
                              helper:
                                  'Distance entre le centre et les limites de jeu.',
                              value: _form.mapRadius,
                              onChanged: (v) =>
                                  _form = _form.copyWith(mapRadius: v),
                            ),
                            _numberField(
                              id: 'start',
                              label: 'Rayon de départ',
                              unit: 'm',
                              helper:
                                  'Taille de la zone de rassemblement de chaque équipe.',
                              value: _form.startZoneRadius,
                              onChanged: (v) =>
                                  _form = _form.copyWith(startZoneRadius: v),
                            ),
                          ],
                        ),
                        _group(
                          title: 'Rôles et capture',
                          description:
                              'Temps du hack et portée de chaque rôle.',
                          icon: Icons.bolt_outlined,
                          expanded: _showRoles,
                          onToggle: () =>
                              setState(() => _showRoles = !_showRoles),
                          children: [
                            _hackField(),
                            _numberField(
                              id: 'rogue',
                              label: 'Portée Rogue',
                              unit: 'm',
                              helper:
                                  'Distance maximale pour hacker un objectif.',
                              value: _form.rogueRange,
                              onChanged: (v) =>
                                  _form = _form.copyWith(rogueRange: v),
                            ),
                            _numberField(
                              id: 'agent',
                              label: 'Portée Agent',
                              unit: 'm',
                              helper:
                                  'Distance maximale pour capturer un Rogue.',
                              value: _form.agentRange,
                              onChanged: (v) =>
                                  _form = _form.copyWith(agentRange: v),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 20, 12),
                  child: Row(
                    children: [
                      TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Annuler'),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          onPressed: _apply,
                          child: const Text('Appliquer'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _group({
    required String title,
    required String description,
    required IconData icon,
    required List<Widget> children,
    bool expanded = true,
    VoidCallback? onToggle,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: onToggle != null,
            expanded: onToggle != null ? expanded : null,
            child: InkWell(
              onTap: onToggle,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, size: 22, color: scheme.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            description,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    if (onToggle != null) ...[
                      const SizedBox(width: 8),
                      Icon(
                        expanded ? Icons.expand_less : Icons.expand_more,
                        color: scheme.onSurfaceVariant,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          // Retain form states and validation when an optional group is collapsed.
          Offstage(
            offstage: !expanded,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children,
              ),
            ),
          ),
        ],
      ),
    );
  }

  InputDecoration _decoration(String label, {String? helper, String? unit}) =>
      InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 3,
        errorMaxLines: 3,
        suffixText: unit,
      );

  Widget _numberField({
    required String id,
    required String label,
    required String helper,
    required int value,
    required ValueChanged<int> onChanged,
    String? unit,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: TextFormField(
      key: _numberKeys[id],
      initialValue: value.toString(),
      keyboardType: TextInputType.number,
      textInputAction: TextInputAction.next,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: _decoration(label, helper: helper, unit: unit),
      validator: (raw) {
        final number = int.tryParse(raw ?? '');
        if (number == null || number <= 0) {
          return 'Saisissez un nombre supérieur à zéro.';
        }
        final objectiveCount = int.tryParse(
          _numberKeys['objectives']!.currentState?.value ?? '',
        );
        if (id == 'victory' &&
            objectiveCount != null &&
            number > objectiveCount) {
          return 'Ne peut pas dépasser le nombre d’objectifs.';
        }
        return null;
      },
      onChanged: (raw) {
        final parsed = int.tryParse(raw);
        if (parsed != null) onChanged(parsed);
      },
    ),
  );

  Widget _hackField() {
    final whole = _form.hackDurationMs ~/ 1000;
    final fraction = (_form.hackDurationMs % 1000)
        .toString()
        .padLeft(3, '0')
        .replaceFirst(RegExp(r'0+$'), '');
    final seconds = fraction.isEmpty ? '$whole' : '$whole,$fraction';
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        key: _numberKeys['hack'],
        initialValue: seconds,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textInputAction: TextInputAction.next,
        inputFormatters: [
          TextInputFormatter.withFunction(
            (oldValue, newValue) =>
                RegExp(r'^\d*([.,]\d{0,3})?$').hasMatch(newValue.text)
                ? newValue
                : oldValue,
          ),
        ],
        decoration: _decoration(
          'Durée du hack',
          unit: 's',
          helper: 'Temps nécessaire pour capturer un objectif.',
        ),
        validator: (raw) {
          final milliseconds = _parseHackMilliseconds(raw ?? '');
          if (milliseconds == null || milliseconds <= 0) {
            return 'Saisissez une durée supérieure à zéro.';
          }
          return null;
        },
        onChanged: (raw) {
          final milliseconds = _parseHackMilliseconds(raw);
          if (milliseconds != null) {
            _form = _form.copyWith(hackDurationMs: milliseconds);
          }
        },
      ),
    );
  }

  int? _parseHackMilliseconds(String raw) {
    if (raw.isEmpty) return null;
    final parts = raw.replaceAll(',', '.').split('.');
    final whole = parts.first.isEmpty ? '0' : parts.first;
    final fraction = parts.length == 1 ? '000' : parts[1].padRight(3, '0');
    return int.tryParse('$whole$fraction');
  }

  Widget _durationField() {
    final minutes = DropdownButtonFormField<int>(
      isExpanded: true,
      initialValue: _durationMinutes,
      decoration: _decoration('Minutes'),
      items: List.generate(
        max(61, _durationMinutes + 1),
        (i) => DropdownMenuItem(
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
    );
    final seconds = DropdownButtonFormField<int>(
      key: _secondsKey,
      isExpanded: true,
      initialValue: _durationSeconds,
      decoration: _decoration('Secondes'),
      items: List.generate(
        60,
        (i) => DropdownMenuItem(
          value: i,
          child: Text(i.toString().padLeft(2, '0')),
        ),
      ),
      validator: (_) => _durationMinutes == 0 && _durationSeconds == 0
          ? 'La durée doit être supérieure à zéro.'
          : null,
      onChanged: (value) {
        if (value == null) return;
        setState(() {
          _durationSeconds = value;
          _applyDuration();
        });
      },
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Durée de la partie',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final compact =
                  constraints.maxWidth < 270 ||
                  MediaQuery.textScalerOf(context).scale(1) > 1.3;
              return compact
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [minutes, const SizedBox(height: 12), seconds],
                    )
                  : Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: minutes),
                        const SizedBox(width: 12),
                        Expanded(child: seconds),
                      ],
                    );
            },
          ),
        ],
      ),
    );
  }

  void _applyDuration() => _form = _form.copyWith(
    duration: _durationMinutes * 60 + _durationSeconds,
  );
}

class CreateLobbyDetailsResult {
  const CreateLobbyDetailsResult({required this.form});
  final CreateLobbyFormData form;
}
