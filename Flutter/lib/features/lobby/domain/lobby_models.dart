import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';

class LobbyPlayer {
  static const Object _noRoleChange = Object();

  const LobbyPlayer({
    required this.id,
    required this.name,
    required this.isHost,
    this.role,
    this.status = 'active',
  });

  final String id;
  final String name;
  final bool isHost;
  final String? role;
  final String status;

  LobbyPlayer copyWith({
    String? id,
    String? name,
    bool? isHost,
    Object? role = _noRoleChange,
    String? status,
  }) {
    return LobbyPlayer(
      id: id ?? this.id,
      name: name ?? this.name,
      isHost: isHost ?? this.isHost,
      role: identical(role, _noRoleChange) ? this.role : role as String?,
      status: status ?? this.status,
    );
  }
}

class LobbyChatMessage {
  const LobbyChatMessage({
    required this.playerId,
    required this.playerName,
    required this.text,
    required this.timestampMs,
  });

  final String playerId;
  final String playerName;
  final String text;
  final int timestampMs;
}

class LobbyBootstrapData {
  const LobbyBootstrapData({
    required this.code,
    required this.serverUrl,
    required this.socketPath,
    required this.playerName,
    this.cognitoSub,
    this.previousPlayerId,
    this.reconnectAsHost = false,
    this.form,
    this.objectives = const <GeoPoint>[],
    this.agentStartZone,
    this.rogueStartZone,
    this.outerStreetContour = const <GeoPoint>[],
  });

  final String code;
  final String serverUrl;
  final String socketPath;
  final String playerName;
  final String? cognitoSub;
  final String? previousPlayerId;
  final bool reconnectAsHost;
  final CreateLobbyFormData? form;
  final List<GeoPoint> objectives;
  final GeoPoint? agentStartZone;
  final GeoPoint? rogueStartZone;
  final List<GeoPoint> outerStreetContour;

  LobbyBootstrapData copyWith({
    String? code,
    String? serverUrl,
    String? socketPath,
    String? playerName,
    Object? cognitoSub = _noChange,
    Object? previousPlayerId = _noChange,
    bool? reconnectAsHost,
    Object? form = _noChange,
    List<GeoPoint>? objectives,
    Object? agentStartZone = _noChange,
    Object? rogueStartZone = _noChange,
    List<GeoPoint>? outerStreetContour,
  }) {
    return LobbyBootstrapData(
      code: code ?? this.code,
      serverUrl: serverUrl ?? this.serverUrl,
      socketPath: socketPath ?? this.socketPath,
      playerName: playerName ?? this.playerName,
      cognitoSub: identical(cognitoSub, _noChange)
          ? this.cognitoSub
          : cognitoSub as String?,
      previousPlayerId: identical(previousPlayerId, _noChange)
          ? this.previousPlayerId
          : previousPlayerId as String?,
      reconnectAsHost: reconnectAsHost ?? this.reconnectAsHost,
      form: identical(form, _noChange)
          ? this.form
          : form as CreateLobbyFormData?,
      objectives: objectives ?? this.objectives,
      agentStartZone: identical(agentStartZone, _noChange)
          ? this.agentStartZone
          : agentStartZone as GeoPoint?,
      rogueStartZone: identical(rogueStartZone, _noChange)
          ? this.rogueStartZone
          : rogueStartZone as GeoPoint?,
      outerStreetContour: outerStreetContour ?? this.outerStreetContour,
    );
  }

  static const Object _noChange = Object();
}

class LobbyGameConfig {
  const LobbyGameConfig({
    required this.mapCenter,
    required this.mapRadius,
    required this.objectiveZoneRadius,
    required this.startZoneRadius,
    required this.durationSeconds,
    this.victoryConditionObjectives,
    required this.hackDurationMs,
    required this.rogueRange,
    required this.agentRange,
    required this.startZone,
    required this.rogueStartZone,
    this.objectives = const <GeoPoint>[],
    required this.mapStreets,
    this.mapStreetNetwork = const <List<GeoPoint>>[],
    this.captureTimeBonusSeconds = CreateLobbyDefaults.captureTimeBonusSeconds,
    this.objectiveIntrusionAlertsEnabled =
        CreateLobbyDefaults.objectiveIntrusionAlertsEnabled,
    this.rogueAgentPositionIntervalSeconds =
        CreateLobbyDefaults.rogueAgentPositionIntervalSeconds,
  });

  final GeoPoint mapCenter;
  final int mapRadius;
  final int objectiveZoneRadius;
  final int startZoneRadius;
  final int durationSeconds;
  final int? victoryConditionObjectives;
  final int hackDurationMs;
  final int rogueRange;
  final int agentRange;
  final GeoPoint? startZone;
  final GeoPoint? rogueStartZone;
  final List<GeoPoint> objectives;
  final List<GeoPoint> mapStreets;
  final List<List<GeoPoint>> mapStreetNetwork;
  final int captureTimeBonusSeconds;
  final bool objectiveIntrusionAlertsEnabled;
  final int rogueAgentPositionIntervalSeconds;

  factory LobbyGameConfig.fromMap(Map<dynamic, dynamic> raw) {
    GeoPoint? parsePair(Object? raw) {
      if (raw is! List || raw.length < 2) return null;
      return GeoPoint.tryParse(raw[0], raw[1]);
    }

    final center =
        GeoPoint.tryParse(
          raw['map_center_latitude'],
          raw['map_center_longitude'],
        ) ??
        const GeoPoint(latitude: 0, longitude: 0);

    final contour = <GeoPoint>[];
    final streets = raw['map_streets'];
    if (streets is List && streets.isNotEmpty) {
      final first = streets.first;
      if (first is List) {
        contour.addAll(first.map(parsePair).whereType<GeoPoint>());
      }
    }

    final network = <List<GeoPoint>>[];
    final rawNetwork = raw['street_network'];
    if (rawNetwork is List) {
      for (final segment in rawNetwork) {
        if (segment is! List) continue;
        final points = segment.map(parsePair).whereType<GeoPoint>().toList();
        if (points.length >= 2) {
          network.add(points);
        }
      }
    }

    final objectives = <GeoPoint>[];
    final rawObjectives = raw['objective_points'] ?? raw['objectives'];
    if (rawObjectives is List) {
      for (final rawPoint in rawObjectives) {
        final parsed = rawPoint is Map
            ? GeoPoint.tryParse(
                rawPoint['latitude'] ?? rawPoint['lat'],
                rawPoint['longitude'] ?? rawPoint['lng'] ?? rawPoint['lon'],
              )
            : parsePair(rawPoint);
        if (parsed != null) objectives.add(parsed);
      }
    }

    return LobbyGameConfig(
      mapCenter: center,
      mapRadius:
          int.tryParse(raw['map_radius']?.toString() ?? '') ??
          CreateLobbyDefaults.mapRadius,
      objectiveZoneRadius:
          int.tryParse(raw['objectiv_zone_radius']?.toString() ?? '') ??
          CreateLobbyDefaults.objectiveZoneRadius,
      startZoneRadius:
          int.tryParse(raw['start_zone_radius']?.toString() ?? '') ??
          CreateLobbyDefaults.startZoneRadius,
      durationSeconds:
          int.tryParse(raw['duration']?.toString() ?? '') ??
          CreateLobbyDefaults.durationSeconds,
      victoryConditionObjectives: int.tryParse(
        (raw['victory_condition_nb_objectivs'] ??
                    raw['victory_condition_nb_objectives'])
                ?.toString() ??
            '',
      ),
      hackDurationMs:
          int.tryParse(raw['hack_duration_ms']?.toString() ?? '') ?? 10000,
      rogueRange: int.tryParse(raw['rogue_range']?.toString() ?? '') ?? 120,
      agentRange:
          int.tryParse(raw['agent_range']?.toString() ?? '') ??
          CreateLobbyDefaults.agentRange,
      startZone: GeoPoint.tryParse(
        raw['start_zone_latitude'],
        raw['start_zone_longitude'],
      ),
      rogueStartZone: GeoPoint.tryParse(
        raw['start_zone_rogue_latitude'],
        raw['start_zone_rogue_longitude'],
      ),
      objectives: objectives,
      mapStreets: contour,
      mapStreetNetwork: network,
      captureTimeBonusSeconds:
          int.tryParse(
            raw['capture_time_bonus_seconds']?.toString() ?? '',
          )?.clamp(0, 3600) ??
          CreateLobbyDefaults.captureTimeBonusSeconds,
      objectiveIntrusionAlertsEnabled:
          raw['objective_intrusion_alerts_enabled'] is bool
          ? raw['objective_intrusion_alerts_enabled'] as bool
          : CreateLobbyDefaults.objectiveIntrusionAlertsEnabled,
      rogueAgentPositionIntervalSeconds:
          int.tryParse(
            raw['rogue_agent_position_interval_seconds']?.toString() ?? '',
          )?.clamp(0, 3600) ??
          CreateLobbyDefaults.rogueAgentPositionIntervalSeconds,
    );
  }
}
