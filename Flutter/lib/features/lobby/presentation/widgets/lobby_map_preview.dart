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
    this.playerPositions = const <GeoPoint>[],
    this.guidancePath = const <GeoPoint>[],
  });

  final GeoPoint center;
  final int mapRadiusMeters;
  final List<GeoPoint> outerStreetContour;
  final List<GeoPoint> objectives;
  final GeoPoint? agentStartZone;
  final GeoPoint? rogueStartZone;
  final int objectiveZoneRadiusMeters;
  final bool showObjectives;
  final List<GeoPoint> playerPositions;
  final List<GeoPoint> guidancePath;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 260,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: FlutterMap(
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
                if (showObjectives)
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
                    strokeWidth: 4,
                    color: Colors.deepPurple,
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
                if (showObjectives)
                  ...objectives.map(
                    (p) => Marker(
                      point: LatLng(p.latitude, p.longitude),
                      builder: (_) => const Icon(
                        Icons.adjust,
                        color: Colors.red,
                        size: 18,
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
                    point: LatLng(p.latitude, p.longitude),
                    builder: (_) => const Icon(
                      Icons.person_pin_circle,
                      color: Colors.orange,
                      size: 22,
                    ),
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
