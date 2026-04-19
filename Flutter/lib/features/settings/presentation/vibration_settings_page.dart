import 'package:abstergo_chase/shared/services/vibration_service.dart';
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
  Map<VibrationEvent, bool>? _settings;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await _vibrationService.loadSettings();
    if (!mounted) return;
    setState(() {
      _settings = settings;
    });
  }

  Future<void> _set(VibrationEvent event, bool value) async {
    setState(() {
      _settings = <VibrationEvent, bool>{
        ...?_settings,
        event: value,
      };
    });
    await _vibrationService.setEnabled(event, value);
    if (value) {
      await _vibrationService.vibrateIfEnabled(event);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Paramètres'),
      ),
      body: settings == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Vibrations',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Active/désactive les vibrations par situation.',
                          style: TextStyle(fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 6),
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
                  ),
                ),
              ],
            ),
    );
  }
}
