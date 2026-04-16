import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

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
    this.showObjectives = true,
    this.showObjectiveMarkers = true,
    this.showObjectiveZones = true,
    this.objectiveMarkerIcon = Icons.adjust,
    this.objectiveMarkerColor = Colors.red,
    this.objectiveMarkerSize = 18,
    this.playerPositions = const <GeoPoint>[],
    this.guidancePath = const <GeoPoint>[],
    this.guidancePathColor = Colors.deepPurple,
    this.guidancePathDotted = false,
    this.guidanceNeonPulse = 0,
    this.highlightObjectiveZones = const <GeoPoint>[],
    this.highlightObjectiveZoneRadiusMeters = 0,
    this.highlightObjectivePulse = 0,
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
  final bool showObjectives;
  final bool showObjectiveMarkers;
  final bool showObjectiveZones;
  final IconData objectiveMarkerIcon;
  final Color objectiveMarkerColor;
  final double objectiveMarkerSize;
  final List<GeoPoint> playerPositions;
  final List<GeoPoint> guidancePath;
  final Color guidancePathColor;
  final bool guidancePathDotted;
  final double guidanceNeonPulse;
  final List<GeoPoint> highlightObjectiveZones;
  final int highlightObjectiveZoneRadiusMeters;
  final double highlightObjectivePulse;
  final MapController? mapController;
  final double? height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: FlutterMap(
          mapController: mapController,
          options: MapOptions(
            center: LatLng(center.latitude, center.longitude),
            zoom: 15.5,
            interactiveFlags: InteractiveFlag.drag | InteractiveFlag.pinchZoom,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.abstergo.chase',
            ),
            CircleLayer(
              circles: [
                if (outerStreetContour.length < 3)
                  CircleMarker(
                    point: LatLng(center.latitude, center.longitude),
                    radius: mapRadiusMeters.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.blue.withOpacity(0.1),
                    borderStrokeWidth: 2,
                    borderColor: Colors.blue,
                  ),
                if (showObjectives && showObjectiveZones)
                  ...objectives.map(
                    (p) => CircleMarker(
                      point: LatLng(p.latitude, p.longitude),
                      radius: objectiveZoneRadiusMeters.toDouble(),
                      useRadiusInMeter: true,
                      color: Colors.red.withOpacity(0.08),
                      borderStrokeWidth: 1,
                      borderColor: Colors.red,
                    ),
                  ),
                if (showObjectives &&
                    showObjectiveZones &&
                    highlightObjectiveZoneRadiusMeters > 0)
                  ...highlightObjectiveZones.map(
                    (p) => CircleMarker(
                      point: LatLng(p.latitude, p.longitude),
                      radius: highlightObjectiveZoneRadiusMeters.toDouble(),
                      useRadiusInMeter: true,
                      color: Colors.orange.withOpacity(
                        0.18 + (highlightObjectivePulse * 0.30),
                      ),
                      borderStrokeWidth: 2 + (highlightObjectivePulse * 1.4),
                      borderColor: Colors.deepOrangeAccent.withOpacity(
                        0.65 + (highlightObjectivePulse * 0.35),
                      ),
                    ),
                  ),
                if (showObjectives &&
                    showObjectiveZones &&
                    highlightObjectiveZoneRadiusMeters > 0)
                  ...highlightObjectiveZones.map(
                    (p) => CircleMarker(
                      point: LatLng(p.latitude, p.longitude),
                      radius:
                          highlightObjectiveZoneRadiusMeters.toDouble() +
                          (18 + (highlightObjectivePulse * 55)),
                      useRadiusInMeter: true,
                      color: Colors.transparent,
                      borderStrokeWidth: 1.8 - (highlightObjectivePulse * 1.0),
                      borderColor: Colors.deepOrangeAccent.withOpacity(
                        0.65 - (highlightObjectivePulse * 0.55),
                      ),
                    ),
                  ),
                if (agentStartZone != null)
                  CircleMarker(
                    point: LatLng(
                      agentStartZone!.latitude,
                      agentStartZone!.longitude,
                    ),
                    radius: CreateLobbyDefaults.startZoneRadius.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.blue.withOpacity(0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.blue,
                  ),
                if (rogueStartZone != null)
                  CircleMarker(
                    point: LatLng(
                      rogueStartZone!.latitude,
                      rogueStartZone!.longitude,
                    ),
                    radius: CreateLobbyDefaults.startZoneRadius.toDouble(),
                    useRadiusInMeter: true,
                    color: Colors.green.withOpacity(0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.green,
                  ),
              ],
            ),
            if (outerStreetContour.length >= 3)
              PolygonLayer(
                polygons: [
                  Polygon(
                    points: outerStreetContour
                        .map((p) => LatLng(p.latitude, p.longitude))
                        .toList(growable: false),
                    color: Colors.blue.withOpacity(0.12),
                    borderColor: Colors.blue,
                    borderStrokeWidth: 2.5,
                    isFilled: true,
                  ),
                ],
              ),
            if (guidancePath.length >= 2)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: guidancePath
                        .map((p) => LatLng(p.latitude, p.longitude))
                        .toList(growable: false),
                    strokeWidth: 9 + (guidanceNeonPulse * 3),
                    color: guidancePathColor.withOpacity(
                      0.20 + (guidanceNeonPulse * 0.35),
                    ),
                    isDotted: false,
                  ),
                  Polyline(
                    points: guidancePath
                        .map((p) => LatLng(p.latitude, p.longitude))
                        .toList(growable: false),
                    strokeWidth: 4,
                    color: guidancePathColor.withOpacity(
                      0.80 + (guidanceNeonPulse * 0.20),
                    ),
                    isDotted: guidancePathDotted,
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                Marker(
                  point: LatLng(center.latitude, center.longitude),
                  builder: (_) => const Icon(
                    Icons.location_on,
                    color: Colors.red,
                    size: 34,
                  ),
                ),
                if (showObjectives && showObjectiveMarkers)
                  ...objectives.map(
                    (p) => Marker(
                      point: LatLng(p.latitude, p.longitude),
                      builder: (_) => Icon(
                        objectiveMarkerIcon,
                        color: objectiveMarkerColor,
                        size: objectiveMarkerSize,
                      ),
                    ),
                  ),
                if (agentStartZone != null)
                  Marker(
                    point: LatLng(
                      agentStartZone!.latitude,
                      agentStartZone!.longitude,
                    ),
                    builder: (_) => const Icon(
                      Icons.trip_origin,
                      color: Colors.blue,
                      size: 20,
                    ),
                  ),
                if (rogueStartZone != null)
                  Marker(
                    point: LatLng(
                      rogueStartZone!.latitude,
                      rogueStartZone!.longitude,
                    ),
                    builder: (_) => const Icon(
                      Icons.trip_origin,
                      color: Colors.green,
                      size: 20,
                    ),
                  ),
                ...playerPositions.map(
                  (p) => Marker(
                    width: 40,
                    height: 44,
                    point: LatLng(p.latitude, p.longitude),
                    anchorPos: AnchorPos.align(AnchorAlign.bottom),
                    builder: (_) => const _PlayerGpsPin(),
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
  const _PlayerGpsPin();

  @override
  Widget build(BuildContext context) {
    // Material 'location_on' has internal padding; we push it down so the tip
    // sits exactly on the marker anchor (bottom-center).
    return const SizedBox(
      width: 40,
      height: 44,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 0,
            right: 0,
            bottom: -4,
            child: Icon(
              Icons.location_on,
              color: Colors.white,
              size: 38,
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: -4,
            child: Icon(
              Icons.location_on,
              color: Colors.orange,
              size: 34,
            ),
          ),
        ],
      ),
    );
  }
}
