import 'package:shared_preferences/shared_preferences.dart';

enum VoiceTransmissionMode { voiceActivation, pushToTalk }

class VoiceSettings {
  const VoiceSettings({
    required this.enabled,
    required this.mode,
    required this.activationThreshold,
  });

  final bool enabled;
  final VoiceTransmissionMode mode;
  final double activationThreshold;
}

class VoiceSettingsService {
  static const String _enabledKey = 'voice.enabled';
  static const String _modeKey = 'voice.mode';
  static const String _thresholdKey = 'voice.activation.threshold';

  Future<VoiceSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_enabledKey) ?? false;
    final rawMode = prefs.getString(_modeKey);
    final rawThreshold = prefs.getDouble(_thresholdKey);
    final mode = VoiceTransmissionMode.values.firstWhere(
      (m) => m.name == rawMode,
      orElse: () => VoiceTransmissionMode.voiceActivation,
    );
    final threshold = (rawThreshold ?? 0.55).clamp(0.05, 1.0);
    return VoiceSettings(
      enabled: enabled,
      mode: mode,
      activationThreshold: threshold,
    );
  }

  Future<void> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, enabled);
  }

  Future<void> setMode(VoiceTransmissionMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_modeKey, mode.name);
  }

  Future<void> setActivationThreshold(double threshold) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_thresholdKey, threshold.clamp(0.05, 1.0));
  }
}
