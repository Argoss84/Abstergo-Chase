import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum VibrationEvent {
  rogueObjectiveInRange,
  selfEnteredStartZone,
  hostSawPlayerEnterStartZone,
  gameStartCountdown,
  lobbyPlayerJoined,
  outOfGameZone,
}

class VibrationService {
  static const Map<VibrationEvent, bool> _defaults = <VibrationEvent, bool>{
    VibrationEvent.rogueObjectiveInRange: true,
    VibrationEvent.selfEnteredStartZone: true,
    VibrationEvent.hostSawPlayerEnterStartZone: true,
    VibrationEvent.gameStartCountdown: true,
    VibrationEvent.lobbyPlayerJoined: true,
    VibrationEvent.outOfGameZone: true,
  };

  static const Map<VibrationEvent, String> _labels = <VibrationEvent, String>{
    VibrationEvent.rogueObjectiveInRange:
        'Rogue: objectif à portée de hacking',
    VibrationEvent.selfEnteredStartZone:
        'Entrée personnelle dans zone de départ',
    VibrationEvent.hostSawPlayerEnterStartZone:
        'Host: un joueur entre dans sa zone de départ',
    VibrationEvent.gameStartCountdown: 'Décompte de démarrage de partie',
    VibrationEvent.lobbyPlayerJoined: 'Lobby: un joueur rejoint',
    VibrationEvent.outOfGameZone: 'Joueur hors zone de jeu',
  };

  static String _keyFor(VibrationEvent event) =>
      'vibration.enabled.${event.name}';

  Future<Map<VibrationEvent, bool>> loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final out = <VibrationEvent, bool>{};
    for (final entry in _defaults.entries) {
      out[entry.key] = prefs.getBool(_keyFor(entry.key)) ?? entry.value;
    }
    return out;
  }

  Future<void> setEnabled(VibrationEvent event, bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyFor(event), enabled);
  }

  Future<bool> isEnabled(VibrationEvent event) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyFor(event)) ?? (_defaults[event] ?? true);
  }

  Future<void> vibrateIfEnabled(VibrationEvent event) async {
    if (!await isEnabled(event)) return;
    switch (event) {
      case VibrationEvent.gameStartCountdown:
        await HapticFeedback.selectionClick();
        return;
      case VibrationEvent.outOfGameZone:
        await HapticFeedback.heavyImpact();
        return;
      default:
        await HapticFeedback.mediumImpact();
        return;
    }
  }

  String labelFor(VibrationEvent event) => _labels[event] ?? event.name;

  List<VibrationEvent> orderedEvents() => VibrationEvent.values;
}
