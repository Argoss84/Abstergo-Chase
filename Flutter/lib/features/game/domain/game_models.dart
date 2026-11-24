import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';

double? normalizeHeadingDegrees(Object? value) {
  final heading = value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '');
  return heading != null && heading.isFinite ? heading % 360 : null;
}

class GamePlayer {
  const GamePlayer({
    required this.id,
    required this.name,
    required this.isHost,
    this.role,
    this.status = 'active',
    this.latitude,
    this.longitude,
    this.headingDegrees,
  });

  final String id;
  final String name;
  final bool isHost;
  final String? role;
  final String status;
  final double? latitude;
  final double? longitude;
  final double? headingDegrees;

  GamePlayer copyWith({
    String? name,
    bool? isHost,
    Object? role = _noRole,
    String? status,
    double? latitude,
    double? longitude,
    double? headingDegrees,
  }) {
    return GamePlayer(
      id: id,
      name: name ?? this.name,
      isHost: isHost ?? this.isHost,
      role: identical(role, _noRole) ? this.role : role as String?,
      status: status ?? this.status,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      headingDegrees: headingDegrees ?? this.headingDegrees,
    );
  }

  static const Object _noRole = Object();
}

class GameObjective {
  const GameObjective({
    required this.id,
    required this.point,
    this.name,
    this.state = 'VISIBLE',
  });

  final String id;
  final GeoPoint point;
  final String? name;
  final String state;

  bool get captured => state.toUpperCase() == 'CAPTURED';

  GameObjective copyWith({String? name, String? state}) {
    return GameObjective(
      id: id,
      point: point,
      name: name ?? this.name,
      state: state ?? this.state,
    );
  }
}

class GameBootstrapData {
  const GameBootstrapData({
    required this.lobby,
    required this.playerId,
    required this.players,
    this.gameConfig,
    this.codeOverride,
    this.fromCodeLookupFallback = false,
    this.initialPlayerPosition,
  });

  final LobbyBootstrapData lobby;
  final String playerId;
  final List<LobbyPlayer> players;
  final LobbyGameConfig? gameConfig;
  final String? codeOverride;
  final bool fromCodeLookupFallback;
  final GeoPoint? initialPlayerPosition;
}
