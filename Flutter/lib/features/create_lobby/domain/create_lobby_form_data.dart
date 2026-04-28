import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';

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
    );
  }
}
