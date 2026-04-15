import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';

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
  final String? previousPlayerId;
  final bool reconnectAsHost;
  final CreateLobbyFormData? form;
  final List<GeoPoint> objectives;
  final GeoPoint? agentStartZone;
  final GeoPoint? rogueStartZone;
  final List<GeoPoint> outerStreetContour;
}

class LobbyGameConfig {
  const LobbyGameConfig({
    required this.mapCenter,
    required this.mapRadius,
    required this.objectiveZoneRadius,
    required this.durationSeconds,
    required this.startZone,
    required this.rogueStartZone,
    required this.mapStreets,
    this.mapStreetNetwork = const <List<GeoPoint>>[],
  });

  final GeoPoint mapCenter;
  final int mapRadius;
  final int objectiveZoneRadius;
  final int durationSeconds;
  final GeoPoint? startZone;
  final GeoPoint? rogueStartZone;
  final List<GeoPoint> mapStreets;
  final List<List<GeoPoint>> mapStreetNetwork;

  factory LobbyGameConfig.fromMap(Map<dynamic, dynamic> raw) {
    GeoPoint? parsePoint(dynamic lat, dynamic lng) {
      final latitude = double.tryParse(lat?.toString() ?? '');
      final longitude = double.tryParse(lng?.toString() ?? '');
      if (latitude == null || longitude == null) return null;
      return GeoPoint(latitude: latitude, longitude: longitude);
    }

    final center = parsePoint(
          raw['map_center_latitude'],
          raw['map_center_longitude'],
        ) ??
        const GeoPoint(latitude: 0, longitude: 0);

    final contour = <GeoPoint>[];
    final streets = raw['map_streets'];
    if (streets is List && streets.isNotEmpty) {
      final first = streets.first;
      if (first is List) {
        for (final pair in first) {
          if (pair is List && pair.length >= 2) {
            final lat = double.tryParse(pair[0].toString());
            final lng = double.tryParse(pair[1].toString());
            if (lat != null && lng != null) {
              contour.add(GeoPoint(latitude: lat, longitude: lng));
            }
          }
        }
      }
    }

    final network = <List<GeoPoint>>[];
    final rawNetwork = raw['street_network'];
    if (rawNetwork is List) {
      for (final segment in rawNetwork) {
        if (segment is! List) continue;
        final points = <GeoPoint>[];
        for (final pair in segment) {
          if (pair is List && pair.length >= 2) {
            final lat = double.tryParse(pair[0].toString());
            final lng = double.tryParse(pair[1].toString());
            if (lat != null && lng != null) {
              points.add(GeoPoint(latitude: lat, longitude: lng));
            }
          }
        }
        if (points.length >= 2) {
          network.add(points);
        }
      }
    }

    return LobbyGameConfig(
      mapCenter: center,
      mapRadius: int.tryParse(raw['map_radius']?.toString() ?? '') ?? 1000,
      objectiveZoneRadius:
          int.tryParse(raw['objectiv_zone_radius']?.toString() ?? '') ?? 50,
      durationSeconds: int.tryParse(raw['duration']?.toString() ?? '') ?? 900,
      startZone: parsePoint(raw['start_zone_latitude'], raw['start_zone_longitude']),
      rogueStartZone: parsePoint(
        raw['start_zone_rogue_latitude'],
        raw['start_zone_rogue_longitude'],
      ),
      mapStreets: contour,
      mapStreetNetwork: network,
    );
  }
}
