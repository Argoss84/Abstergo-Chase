import 'package:abstergo_chase/shared/services/vibration_service.dart';
import 'package:abstergo_chase/shared/services/socket_environment_service.dart';
import 'package:abstergo_chase/shared/services/screen_awake_service.dart';
import 'package:abstergo_chase/shared/services/tts_service.dart';
import 'package:abstergo_chase/shared/services/voice_settings_service.dart';
import 'package:flutter/material.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  static const String routePath = '/settings';
  static const String routeName = 'settings';

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final VibrationService _vibrationService = VibrationService();
  final VoiceSettingsService _voiceSettingsService = VoiceSettingsService();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  final TtsService _ttsService = TtsService.instance;
  final ScreenAwakeService _screenAwakeService = ScreenAwakeService.instance;
  final TextEditingController _ttsTestController = TextEditingController(
    text: 'Test de la synthèse vocale',
  );
  Map<VibrationEvent, bool>? _settings;
  bool _voiceEnabled = false;
  VoiceTransmissionMode _voiceMode = VoiceTransmissionMode.voiceActivation;
  double _voiceThreshold = 0.55;
  double _testVoiceLevel = 0;
  bool _useProductionSignaling = true;
  bool _ttsEnabled = true;
  bool _preventScreenLock = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await _vibrationService.loadSettings();
    final voiceSettings = await _voiceSettingsService.load();
    final useProd = await _socketEnvironmentService.useProduction();
    final ttsEnabled = await _ttsService.isEnabled();
    final preventScreenLock = await _screenAwakeService.isPreventLockEnabled();
    if (!mounted) return;
    setState(() {
      _settings = settings;
      _voiceEnabled = voiceSettings.enabled;
      _voiceMode = voiceSettings.mode;
      _voiceThreshold = voiceSettings.activationThreshold;
      _useProductionSignaling = useProd;
      _ttsEnabled = ttsEnabled;
      _preventScreenLock = preventScreenLock;
    });
  }

  Future<void> _set(VibrationEvent event, bool value) async {
    setState(() {
      _settings = <VibrationEvent, bool>{...?_settings, event: value};
    });
    await _vibrationService.setEnabled(event, value);
    if (value) {
      await _vibrationService.vibrateIfEnabled(event);
    }
  }

  Future<void> _setVoiceMode(VoiceTransmissionMode mode) async {
    setState(() {
      _voiceMode = mode;
    });
    await _voiceSettingsService.setMode(mode);
  }

  Future<void> _setVoiceEnabled(bool enabled) async {
    setState(() {
      _voiceEnabled = enabled;
    });
    await _voiceSettingsService.setEnabled(enabled);
  }

  Future<void> _setVoiceThreshold(double value) async {
    setState(() {
      _voiceThreshold = value;
    });
    await _voiceSettingsService.setActivationThreshold(value);
  }

  Future<void> _setSignalingEnvironment(bool useProduction) async {
    setState(() {
      _useProductionSignaling = useProduction;
    });
    await _socketEnvironmentService.setUseProduction(useProduction);
  }

  Future<void> _setTtsEnabled(bool enabled) async {
    setState(() {
      _ttsEnabled = enabled;
    });
    await _ttsService.setEnabled(enabled);
  }

  Future<void> _testTts() async {
    await _ttsService.speakPreview(_ttsTestController.text);
  }

  Future<void> _setPreventScreenLock(bool enabled) async {
    setState(() {
      _preventScreenLock = enabled;
    });
    await _screenAwakeService.setPreventLockEnabled(enabled);
  }

  @override
  void dispose() {
    _ttsTestController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    return Scaffold(
      appBar: AppBar(title: const Text('Paramètres')),
      body: settings == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildCollapsibleSection(
                  title: 'Signaling',
                  subtitle: 'Choisissez le serveur signaling à utiliser.',
                  children: [
                    Row(
                      children: [
                        Text(
                          'Dev',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: !_useProductionSignaling
                                ? Colors.cyan
                                : Colors.white70,
                          ),
                        ),
                        Expanded(
                          child: Slider(
                            min: 0,
                            max: 1,
                            divisions: 1,
                            value: _useProductionSignaling ? 1 : 0,
                            onChanged: (value) {
                              _setSignalingEnvironment(value >= 0.5);
                            },
                          ),
                        ),
                        Text(
                          'Prod',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: _useProductionSignaling
                                ? Colors.cyan
                                : Colors.white70,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildCollapsibleSection(
                  title: 'Ecran',
                  subtitle:
                      'Empêche la mise en veille de l’écran pendant le jeu.',
                  children: [
                    SwitchListTile(
                      value: _preventScreenLock,
                      onChanged: _setPreventScreenLock,
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Empêcher le verrouillage écran'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildCollapsibleSection(
                  title: 'TTS',
                  subtitle: 'Active ou désactive la voix de synthèse.',
                  children: [
                    SwitchListTile(
                      value: _ttsEnabled,
                      onChanged: _setTtsEnabled,
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Activer le TTS'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _ttsTestController,
                      minLines: 1,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Texte de test',
                        hintText: 'Saisissez un texte à lire',
                      ),
                    ),
                    const SizedBox(height: 10),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: FilledButton.icon(
                        onPressed: _testTts,
                        icon: const Icon(Icons.volume_up),
                        label: const Text('Tester le TTS'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildCollapsibleSection(
                  title: 'Vocal',
                  subtitle: 'Mode d’émission et sensibilité de détection.',
                  children: [
                    SwitchListTile(
                      value: _voiceEnabled,
                      onChanged: _setVoiceEnabled,
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Activer le vocal'),
                      subtitle: const Text(
                        'Désactivé: aucune connexion au serveur vocal.',
                      ),
                    ),
                    const SizedBox(height: 8),
                    SegmentedButton<VoiceTransmissionMode>(
                      segments: const <ButtonSegment<VoiceTransmissionMode>>[
                        ButtonSegment<VoiceTransmissionMode>(
                          value: VoiceTransmissionMode.voiceActivation,
                          label: Text('Voice activation'),
                          icon: Icon(Icons.mic),
                        ),
                        ButtonSegment<VoiceTransmissionMode>(
                          value: VoiceTransmissionMode.pushToTalk,
                          label: Text('Push to Talk'),
                          icon: Icon(Icons.record_voice_over),
                        ),
                      ],
                      selected: <VoiceTransmissionMode>{_voiceMode},
                      onSelectionChanged: _voiceEnabled
                          ? (values) {
                              final selected = values.isEmpty
                                  ? VoiceTransmissionMode.voiceActivation
                                  : values.first;
                              _setVoiceMode(selected);
                            }
                          : null,
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Seuil de détection (voice activation)',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Slider(
                      value: _voiceThreshold,
                      min: 0.05,
                      max: 1.0,
                      divisions: 19,
                      label: '${(_voiceThreshold * 100).round()}%',
                      onChanged:
                          _voiceEnabled &&
                              _voiceMode ==
                                  VoiceTransmissionMode.voiceActivation
                          ? (v) => _setVoiceThreshold(v)
                          : null,
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Test rapide : maintenez le bouton ci-dessous pour valider le seuil choisi.',
                    ),
                    const SizedBox(height: 8),
                    Listener(
                      onPointerDown: _voiceEnabled
                          ? (_) {
                              setState(() {
                                _testVoiceLevel = 1.0;
                              });
                            }
                          : null,
                      onPointerUp: _voiceEnabled
                          ? (_) {
                              setState(() {
                                _testVoiceLevel = 0.0;
                              });
                            }
                          : null,
                      onPointerCancel: _voiceEnabled
                          ? (_) {
                              setState(() {
                                _testVoiceLevel = 0.0;
                              });
                            }
                          : null,
                      child: FilledButton.icon(
                        onPressed: _voiceEnabled ? () {} : null,
                        icon: const Icon(Icons.mic),
                        label: const Text('Maintenir pour tester'),
                      ),
                    ),
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        minHeight: 10,
                        value: _testVoiceLevel,
                        backgroundColor: Colors.grey.shade300,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          _testVoiceLevel >= _voiceThreshold
                              ? Colors.green
                              : Colors.orange,
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _testVoiceLevel >= _voiceThreshold
                          ? 'Voix détectée (au-dessus du seuil)'
                          : 'Voix non détectée (sous le seuil)',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: _testVoiceLevel >= _voiceThreshold
                            ? Colors.green
                            : Colors.orange.shade800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildCollapsibleSection(
                  title: 'Vibrations',
                  subtitle: 'Active/désactive les vibrations par situation.',
                  children: [
                    ..._vibrationService.orderedEvents().map((event) {
                      return SwitchListTile(
                        value: settings[event] ?? true,
                        onChanged: (value) => _set(event, value),
                        title: Text(_vibrationService.labelFor(event)),
                        contentPadding: EdgeInsets.zero,
                      );
                    }),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _buildCollapsibleSection({
    required String title,
    required String subtitle,
    required List<Widget> children,
    bool initiallyExpanded = false,
  }) {
    return Card(
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        initiallyExpanded: initiallyExpanded,
        title: Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(fontWeight: FontWeight.w500),
        ),
        children: children,
      ),
    );
  }
}
