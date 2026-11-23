import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';

class CreateLobbyFormData {
  const CreateLobbyFormData({
    required this.objectiveNumber,
    required this.duration,
    required this.victoryConditionObjectives,
    required this.hackDurationMs,
    required this.objectiveZoneRadius,
    required this.startZoneRadius,
    required this.rogueRange,
    required this.agentRange,
    required this.mapCenterLatitude,
    required this.mapCenterLongitude,
    required this.mapRadius,
    this.captureTimeBonusSeconds = CreateLobbyDefaults.captureTimeBonusSeconds,
    this.objectiveIntrusionAlertsEnabled =
        CreateLobbyDefaults.objectiveIntrusionAlertsEnabled,
    this.rogueAgentPositionIntervalSeconds =
        CreateLobbyDefaults.rogueAgentPositionIntervalSeconds,
  });

  factory CreateLobbyFormData.initial() {
    return const CreateLobbyFormData(
      objectiveNumber: CreateLobbyDefaults.objectiveNumber,
      duration: CreateLobbyDefaults.durationSeconds,
      victoryConditionObjectives:
          CreateLobbyDefaults.victoryConditionObjectives,
      hackDurationMs: CreateLobbyDefaults.hackDurationMs,
      objectiveZoneRadius: CreateLobbyDefaults.objectiveZoneRadius,
      startZoneRadius: CreateLobbyDefaults.startZoneRadius,
      rogueRange: CreateLobbyDefaults.rogueRange,
      agentRange: CreateLobbyDefaults.agentRange,
      mapCenterLatitude: '',
      mapCenterLongitude: '',
      mapRadius: CreateLobbyDefaults.mapRadius,
    );
  }

  final int objectiveNumber;
  final int duration;
  final int victoryConditionObjectives;
  final int hackDurationMs;
  final int objectiveZoneRadius;
  final int startZoneRadius;
  final int rogueRange;
  final int agentRange;
  final String mapCenterLatitude;
  final String mapCenterLongitude;
  final int mapRadius;
  final int captureTimeBonusSeconds;
  final bool objectiveIntrusionAlertsEnabled;
  final int rogueAgentPositionIntervalSeconds;

  Map<String, dynamic> toGameSettings() => <String, dynamic>{
    'objectif_number': objectiveNumber,
    'duration': duration > 0 ? duration : CreateLobbyDefaults.durationSeconds,
    'victory_condition_nb_objectivs': victoryConditionObjectives,
    'hack_duration_ms': hackDurationMs,
    'start_zone_radius': startZoneRadius,
    'rogue_range': rogueRange,
    'agent_range': agentRange,
    'map_center_latitude': mapCenterLatitude,
    'map_center_longitude': mapCenterLongitude,
    'map_radius': mapRadius,
    'capture_time_bonus_seconds': captureTimeBonusSeconds,
    'objective_intrusion_alerts_enabled': objectiveIntrusionAlertsEnabled,
    'rogue_agent_position_interval_seconds': rogueAgentPositionIntervalSeconds,
  };

  CreateLobbyFormData copyWith({
    int? objectiveNumber,
    int? duration,
    int? victoryConditionObjectives,
    int? hackDurationMs,
    int? objectiveZoneRadius,
    int? startZoneRadius,
    int? rogueRange,
    int? agentRange,
    String? mapCenterLatitude,
    String? mapCenterLongitude,
    int? mapRadius,
    int? captureTimeBonusSeconds,
    bool? objectiveIntrusionAlertsEnabled,
    int? rogueAgentPositionIntervalSeconds,
  }) {
    return CreateLobbyFormData(
      objectiveNumber: objectiveNumber ?? this.objectiveNumber,
      duration: duration ?? this.duration,
      victoryConditionObjectives:
          victoryConditionObjectives ?? this.victoryConditionObjectives,
      hackDurationMs: hackDurationMs ?? this.hackDurationMs,
      objectiveZoneRadius: objectiveZoneRadius ?? this.objectiveZoneRadius,
      startZoneRadius: startZoneRadius ?? this.startZoneRadius,
      rogueRange: rogueRange ?? this.rogueRange,
      agentRange: agentRange ?? this.agentRange,
      mapCenterLatitude: mapCenterLatitude ?? this.mapCenterLatitude,
      mapCenterLongitude: mapCenterLongitude ?? this.mapCenterLongitude,
      mapRadius: mapRadius ?? this.mapRadius,
      captureTimeBonusSeconds:
          captureTimeBonusSeconds ?? this.captureTimeBonusSeconds,
      objectiveIntrusionAlertsEnabled:
          objectiveIntrusionAlertsEnabled ??
          this.objectiveIntrusionAlertsEnabled,
      rogueAgentPositionIntervalSeconds:
          rogueAgentPositionIntervalSeconds ??
          this.rogueAgentPositionIntervalSeconds,
    );
  }
}
