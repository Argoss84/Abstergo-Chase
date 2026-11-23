import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';

class CreateLobbyDefaults {
  const CreateLobbyDefaults._();

  static const String productionServerUrl =
      AppRuntimeConfig.signalingProductionUrl;
  static const String developmentServerUrl =
      AppRuntimeConfig.signalingDevelopmentUrl;
  static const String serverUrl = productionServerUrl;
  static const String socketPath = AppRuntimeConfig.socketPath;
  static const int objectiveNumber = 3;
  static const int durationSeconds = 600;
  static const int victoryConditionObjectives = 1;
  static const int hackDurationMs = 10000;
  static const int objectiveZoneRadius = 25;
  static const int startZoneRadius = 25;
  static const int rogueRange = 10;
  static const int agentRange = 80;
  static const int mapRadius = 125;
  static const int captureTimeBonusSeconds = 0;
  static const int suggestedCaptureTimeBonusSeconds = 30;
  static const bool objectiveIntrusionAlertsEnabled = true;
  static const int rogueAgentPositionIntervalSeconds = 0;
  static const int maxPlayerNameLength = 20;
}
