import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

const double _kOsmMaxZoom = 19;
const int _kOsmMaxNativeZoom = 19;

enum PlayerMarkerAura { none, selfBlue, allyGreen }

class PlayerMapMarker {
  const PlayerMapMarker({
    required this.point,
    required this.isAgent,
    this.aura = PlayerMarkerAura.none,
  });

  final GeoPoint point;
  final bool isAgent;
  final PlayerMarkerAura aura;
}

class MapPingMarker {
  const MapPingMarker({
    required this.point,
    required this.color,
    required this.playerName,
    required this.message,
    this.pulseValue = 0,
  });

  final GeoPoint point;
  final Color color;
  final String playerName;
  final String message;
  final double pulseValue;
}

class LobbyMapPreview extends StatelessWidget {
  const LobbyMapPreview({
    super.key,
    required this.center,
    required this.mapRadiusMeters,
    required this.outerStreetContour,
    required this.objectives,
    required this.agentStartZone,
    required this.rogueStartZone,
    required this.objectiveZoneRadiusMeters,
    this.startZoneRadiusMeters = CreateLobbyDefaults.startZoneRadius,
    this.showObjectives = true,
    this.showObjectiveMarkers = true,
    this.showObjectiveZones = true,
    this.objectiveMarkerIcon = Icons.adjust,
    this.objectiveMarkerColor = Colors.red,
    this.objectiveMarkerSize = 18,
    this.playerPositions = const <GeoPoint>[],
    this.playerMarkers = const <PlayerMapMarker>[],
    this.guidancePath = const <GeoPoint>[],
    this.guidancePathColor = Colors.deepPurple,
    this.guidancePathDotted = false,
    this.guidanceNeonPulse = 0,
    this.highlightObjectiveZones = const <GeoPoint>[],
    this.highlightObjectiveZoneRadiusMeters = 0,
    this.highlightObjectivePulse = 0,
    this.showCenterMarker = true,
    this.pingMarkers = const <MapPingMarker>[],
    this.onMapLongPress,
    this.onMapPointerDown,
    this.onMapPointerMove,
    this.onMapPointerUp,
    this.onMapPointerCancel,
    this.mapController,
    this.height = 260,
  });

  final GeoPoint center;
  final int mapRadiusMeters;
  final List<GeoPoint> outerStreetContour;
  final List<GeoPoint> objectives;
  final GeoPoint? agentStartZone;
  final GeoPoint? rogueStartZone;
  final int objectiveZoneRadiusMeters;
  final int startZoneRadiusMeters;
  final bool showObjectives;
  final bool showObjectiveMarkers;
  final bool showObjectiveZones;
  final IconData objectiveMarkerIcon;
  final Color objectiveMarkerColor;
  final double objectiveMarkerSize;
  final List<GeoPoint> playerPositions;
  final List<PlayerMapMarker> playerMarkers;
  final List<GeoPoint> guidancePath;
  final Color guidancePathColor;
  final bool guidancePathDotted;
  final double guidanceNeonPulse;
  final List<GeoPoint> highlightObjectiveZones;
  final int highlightObjectiveZoneRadiusMeters;
  final double highlightObjectivePulse;
  final bool showCenterMarker;
  final List<MapPingMarker> pingMarkers;
  final LongPressCallback? onMapLongPress;
  final PointerDownCallback? onMapPointerDown;
  final PointerMoveCallback? onMapPointerMove;
  final PointerUpCallback? onMapPointerUp;
  final PointerCancelCallback? onMapPointerCancel;
  final MapController? mapController;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final centerLatLng = LatLng(center.latitude, center.longitude);
    final objectiveLatLng = objectives
        .map((p) => LatLng(p.latitude, p.longitude))
        .toList(growable: false);
    final effectivePlayerMarkers = playerMarkers.isNotEmpty
        ? playerMarkers
        : playerPositions
              .map(
                (p) => PlayerMapMarker(
                  point: p,
                  isAgent: true,
                  aura: PlayerMarkerAura.none,
                ),
              )
              .toList(growable: false);
    final guidanceLatLng = guidancePath
        .map((p) => LatLng(p.latitude, p.longitude))
        .toList(growable: false);
    final contourLatLng = outerStreetContour
        .map((p) => LatLng(p.latitude, p.longitude))
        .toList(growable: false);
    final highlightLatLng = highlightObjectiveZones
        .map((p) => LatLng(p.latitude, p.longitude))
        .toList(growable: false);
    final agentLatLng = agentStartZone == null
        ? null
        : LatLng(agentStartZone!.latitude, agentStartZone!.longitude);
    final rogueLatLng = rogueStartZone == null
        ? null
        : LatLng(rogueStartZone!.latitude, rogueStartZone!.longitude);

    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: FlutterMap(
          mapController: mapController,
          options: MapOptions(
            initialCenter: centerLatLng,
            initialZoom: 15.5,
            maxZoom: _kOsmMaxZoom,
            onLongPress: onMapLongPress,
            onPointerDown: onMapPointerDown,
            onPointerMove: onMapPointerMove,
            onPointerUp: onMapPointerUp,
            onPointerCancel: onMapPointerCancel,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.brokenveilprotocol.app',
              maxNativeZoom: _kOsmMaxNativeZoom,
              maxZoom: _kOsmMaxZoom,
            ),
            CircleLayer(
              circles: [
                if (outerStreetContour.length < 3)
                  CircleMarker(
                    point: centerLatLng,
                    radius: mapRadiusMeters.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.blue.withValues(alpha: 0.1),
                    borderStrokeWidth: 2,
                    borderColor: Colors.blue,
                  ),
                if (showObjectives && showObjectiveZones)
                  ...objectiveLatLng.map(
                    (point) => CircleMarker(
                      point: point,
                      radius: objectiveZoneRadiusMeters.toDouble(),
                      useRadiusInMeter: true,
                      color: Colors.red.withValues(alpha: 0.08),
                      borderStrokeWidth: 1,
                      borderColor: Colors.red,
                    ),
                  ),
                if (showObjectives &&
                    showObjectiveZones &&
                    highlightObjectiveZoneRadiusMeters > 0)
                  ...highlightLatLng.map(
                    (point) => CircleMarker(
                      point: point,
                      radius: highlightObjectiveZoneRadiusMeters.toDouble(),
                      useRadiusInMeter: true,
                      color: Colors.orange.withValues(
                        alpha: 0.18 + (highlightObjectivePulse * 0.30),
                      ),
                      borderStrokeWidth: 2 + (highlightObjectivePulse * 1.4),
                      borderColor: Colors.deepOrangeAccent.withValues(
                        alpha: 0.65 + (highlightObjectivePulse * 0.35),
                      ),
                    ),
                  ),
                if (showObjectives &&
                    showObjectiveZones &&
                    highlightObjectiveZoneRadiusMeters > 0)
                  ...highlightLatLng.map(
                    (point) => CircleMarker(
                      point: point,
                      radius:
                          highlightObjectiveZoneRadiusMeters.toDouble() +
                          (18 + (highlightObjectivePulse * 55)),
                      useRadiusInMeter: true,
                      color: Colors.transparent,
                      borderStrokeWidth: 1.8 - (highlightObjectivePulse * 1.0),
                      borderColor: Colors.deepOrangeAccent.withValues(
                        alpha: 0.65 - (highlightObjectivePulse * 0.55),
                      ),
                    ),
                  ),
                if (agentLatLng != null)
                  CircleMarker(
                    point: agentLatLng,
                    radius: startZoneRadiusMeters.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.blue.withValues(alpha: 0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.blue,
                  ),
                if (rogueLatLng != null)
                  CircleMarker(
                    point: rogueLatLng,
                    radius: startZoneRadiusMeters.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.green.withValues(alpha: 0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.green,
                  ),
                ...pingMarkers.map(
                  (ping) => CircleMarker(
                    point: LatLng(ping.point.latitude, ping.point.longitude),
                    radius: 6 + (ping.pulseValue * 13),
                    useRadiusInMeter: true,
                    color: ping.color.withValues(
                      alpha: 0.10 + (ping.pulseValue * 0.28),
                    ),
                    borderStrokeWidth: 1.4 + (ping.pulseValue * 1.5),
                    borderColor: ping.color.withValues(
                      alpha: 0.65 + (ping.pulseValue * 0.35),
                    ),
                  ),
                ),
              ],
            ),
            if (contourLatLng.length >= 3)
              PolygonLayer(
                polygons: [
                  Polygon(
                    points: contourLatLng,
                    color: Colors.blue.withValues(alpha: 0.12),
                    borderColor: Colors.blue,
                    borderStrokeWidth: 2.5,
                  ),
                ],
              ),
            if (guidanceLatLng.length >= 2)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: guidanceLatLng,
                    strokeWidth: 9 + (guidanceNeonPulse * 3),
                    color: guidancePathColor.withValues(
                      alpha: 0.20 + (guidanceNeonPulse * 0.35),
                    ),
                  ),
                  Polyline(
                    points: guidanceLatLng,
                    strokeWidth: 4,
                    color: guidancePathColor.withValues(
                      alpha: 0.80 + (guidanceNeonPulse * 0.20),
                    ),
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                if (showCenterMarker)
                  Marker(
                    point: centerLatLng,
                    child: const Icon(
                      Icons.location_on,
                      color: Colors.red,
                      size: 34,
                    ),
                  ),
                if (showObjectives && showObjectiveMarkers)
                  ...objectiveLatLng.map(
                    (point) => Marker(
                      point: point,
                      child: Icon(
                        objectiveMarkerIcon,
                        color: objectiveMarkerColor,
                        size: objectiveMarkerSize,
                      ),
                    ),
                  ),
                if (agentLatLng != null)
                  Marker(
                    point: agentLatLng,
                    child: const Icon(
                      Icons.trip_origin,
                      color: Colors.blue,
                      size: 20,
                    ),
                  ),
                if (rogueLatLng != null)
                  Marker(
                    point: rogueLatLng,
                    child: const Icon(
                      Icons.trip_origin,
                      color: Colors.green,
                      size: 20,
                    ),
                  ),
                ...effectivePlayerMarkers.map(
                  (player) => Marker(
                    width: 56,
                    height: 56,
                    point: LatLng(
                      player.point.latitude,
                      player.point.longitude,
                    ),
                    child: _PlayerGpsPin(
                      isAgent: player.isAgent,
                      aura: player.aura,
                    ),
                  ),
                ),
                ...pingMarkers.map(
                  (ping) => Marker(
                    width: 180,
                    height: 66,
                    point: LatLng(ping.point.latitude, ping.point.longitude),
                    child: _RolePingMarkerWidget(ping: ping),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayerGpsPin extends StatelessWidget {
  const _PlayerGpsPin({required this.isAgent, required this.aura});

  final bool isAgent;
  final PlayerMarkerAura aura;

  @override
  Widget build(BuildContext context) {
    final auraColor = switch (aura) {
      PlayerMarkerAura.selfBlue => const Color(0xFF2EA8FF),
      PlayerMarkerAura.allyGreen => const Color(0xFF22C55E),
      PlayerMarkerAura.none => Colors.transparent,
    };
    final markerAsset = isAgent
        ? 'assets/images/agent_marker.png'
        : 'assets/images/rogue_marker.png';
    return SizedBox(
      width: 56,
      height: 56,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          if (aura != PlayerMarkerAura.none)
            Positioned(
              left: 10,
              right: 10,
              top: 10,
              child: Container(
                height: 36,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  boxShadow: <BoxShadow>[
                    BoxShadow(
                      color: auraColor.withValues(alpha: 0.85),
                      blurRadius: 14,
                      spreadRadius: 4,
                    ),
                  ],
                ),
              ),
            ),
          Positioned(
            left: 6,
            right: 6,
            top: 6,
            bottom: 6,
            child: Image.asset(
              markerAsset,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
              errorBuilder: (_, _, _) => Icon(
                Icons.location_on,
                color: isAgent ? Colors.cyanAccent : Colors.deepOrangeAccent,
                size: 34,
              ),
            ),
          ),
        ],
      ),
    );
  }

  class _RolePingMarkerWidget extends StatelessWidget {
    const _RolePingMarkerWidget({required this.ping});

    final MapPingMarker ping;

    @override
    Widget build(BuildContext context) {
      return IgnorePointer(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.72),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Column(
                children: [
                  Text(
                    ping.playerName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    ping.message,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 2),
            Icon(Icons.wifi_tethering, color: ping.color, size: 26),
          ],
        ),
      );
    }
  }
}
