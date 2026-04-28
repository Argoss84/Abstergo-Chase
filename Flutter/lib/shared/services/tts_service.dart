import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TtsService {
  TtsService._();

  static final TtsService instance = TtsService._();
  static const String _enabledKey = 'tts.enabled';

  final FlutterTts _tts = FlutterTts();

  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? true;
  }

  Future<void> setEnabled(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, value);
  }

  Future<void> speakIfEnabled(String text) async {
    if (!await isEnabled()) return;
    await _speak(text);
  }

  Future<void> speakPreview(String text) async {
    if (text.trim().isEmpty) return;
    await _speak(text);
  }

  Future<void> _speak(String text) async {
    try {
      await _tts.setLanguage('fr-FR');
      await _tts.setSpeechRate(0.48);
      await _tts.setPitch(1.0);
      await _tts.stop();
      await _tts.speak(text.trim());
    } catch (_) {
      // Keep UI/game flow resilient if TTS engine is unavailable.
    }
  }
}
