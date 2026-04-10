import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

class CreateLobbyMap extends StatelessWidget {
  const CreateLobbyMap({
    super.key,
    required this.currentPosition,
    required this.selectedPosition,
    required this.mapRadiusMeters,
    required this.objectiveZoneRadiusMeters,
    required this.streets,
    required this.outerStreetContour,
    required this.objectives,
    required this.agentStartZone,
    required this.rogueStartZone,
    required this.onTap,
  });

  final GeoPoint currentPosition;
  final GeoPoint? selectedPosition;
  final int mapRadiusMeters;
  final int objectiveZoneRadiusMeters;
  final List<List<GeoPoint>> streets;
  final List<GeoPoint> outerStreetContour;
  final List<GeoPoint> objectives;
  final GeoPoint? agentStartZone;
  final GeoPoint? rogueStartZone;
  final ValueChanged<GeoPoint> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 300,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: FlutterMap(
          options: MapOptions(
            center: LatLng(currentPosition.latitude, currentPosition.longitude),
            zoom: 16,
            onTap: (_, point) {
              onTap(
                GeoPoint(latitude: point.latitude, longitude: point.longitude),
              );
            },
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.abstergo.chase',
            ),
            MarkerLayer(
              markers: [
                Marker(
                  point: LatLng(
                      currentPosition.latitude, currentPosition.longitude),
                  builder: (_) => const Icon(
                    Icons.my_location,
                    color: Colors.blue,
                    size: 32,
                  ),
                ),
                if (selectedPosition != null)
                  Marker(
                    point: LatLng(
                      selectedPosition!.latitude,
                      selectedPosition!.longitude,
                    ),
                    builder: (_) => const Icon(
                      Icons.location_on,
                      color: Colors.red,
                      size: 36,
                    ),
                  ),
                ...objectives.map(
                  (point) => Marker(
                    point: LatLng(point.latitude, point.longitude),
                    builder: (_) => const Icon(
                      Icons.adjust,
                      color: Colors.red,
                      size: 20,
                    ),
                  ),
                ),
                if (agentStartZone != null)
                  Marker(
                    point: LatLng(
                        agentStartZone!.latitude, agentStartZone!.longitude),
                    builder: (_) => const Icon(
                      Icons.trip_origin,
                      color: Colors.blue,
                      size: 22,
                    ),
                  ),
                if (rogueStartZone != null)
                  Marker(
                    point: LatLng(
                        rogueStartZone!.latitude, rogueStartZone!.longitude),
                    builder: (_) => const Icon(
                      Icons.trip_origin,
                      color: Colors.green,
                      size: 22,
                    ),
                  ),
              ],
            ),
            PolylineLayer(
              polylines: streets
                  .where((street) => street.length >= 2)
                  .map(
                    (street) => Polyline(
                      points: street
                          .map((p) => LatLng(p.latitude, p.longitude))
                          .toList(growable: false),
                      color: Colors.grey.shade700,
                      strokeWidth: 2,
                    ),
                  )
                  .toList(growable: false),
            ),
            CircleLayer(
              circles: [
                if (outerStreetContour.length < 3)
                  if (selectedPosition != null)
                    CircleMarker(
                      point: LatLng(selectedPosition!.latitude,
                          selectedPosition!.longitude),
                      radius: mapRadiusMeters.toDouble(),
                      color: Colors.blue.withOpacity(0.12),
                      borderStrokeWidth: 2,
                      borderColor: Colors.blue,
                      useRadiusInMeter: true,
                    ),
                ...objectives.map(
                  (point) => CircleMarker(
                    point: LatLng(point.latitude, point.longitude),
                    radius: objectiveZoneRadiusMeters.toDouble(),
                    color: Colors.red.withOpacity(0.08),
                    borderStrokeWidth: 1,
                    borderColor: Colors.red,
                    useRadiusInMeter: true,
                  ),
                ),
                if (agentStartZone != null)
                  CircleMarker(
                    point: LatLng(
                        agentStartZone!.latitude, agentStartZone!.longitude),
                    radius: CreateLobbyDefaults.startZoneRadius.toDouble(),
                    color: Colors.blue.withOpacity(0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.blue,
                    useRadiusInMeter: true,
                  ),
                if (rogueStartZone != null)
                  CircleMarker(
                    point: LatLng(
                        rogueStartZone!.latitude, rogueStartZone!.longitude),
                    radius: CreateLobbyDefaults.startZoneRadius.toDouble(),
                    color: Colors.green.withOpacity(0.1),
                    borderStrokeWidth: 1.5,
                    borderColor: Colors.green,
                    useRadiusInMeter: true,
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
          ],
        ),
      ),
    );
  }
}
