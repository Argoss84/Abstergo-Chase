import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';

class LobbyPlayer {
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
    String? role,
    String? status,
  }) {
    return LobbyPlayer(
      id: id ?? this.id,
      name: name ?? this.name,
      isHost: isHost ?? this.isHost,
      role: role ?? this.role,
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
