import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';

class GamePlayer {
  const GamePlayer({
    required this.id,
    required this.name,
    required this.isHost,
    this.role,
    this.status = 'active',
    this.latitude,
    this.longitude,
  });

  final String id;
  final String name;
  final bool isHost;
  final String? role;
  final String status;
  final double? latitude;
  final double? longitude;

  GamePlayer copyWith({
    String? name,
    bool? isHost,
    Object? role = _noRole,
    String? status,
    double? latitude,
    double? longitude,
  }) {
    return GamePlayer(
      id: id,
      name: name ?? this.name,
      isHost: isHost ?? this.isHost,
      role: identical(role, _noRole) ? this.role : role as String?,
      status: status ?? this.status,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
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

  GameObjective copyWith({
    String? name,
    String? state,
  }) {
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
  });

  final LobbyBootstrapData lobby;
  final String playerId;
  final List<LobbyPlayer> players;
  final LobbyGameConfig? gameConfig;
  final String? codeOverride;
}
