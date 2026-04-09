import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

class CreateLobbyMap extends StatelessWidget {
  const CreateLobbyMap({
    super.key,
    required this.currentPosition,
    required this.selectedPosition,
    required this.onTap,
  });

  final GeoPoint currentPosition;
  final GeoPoint selectedPosition;
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
                Marker(
                  point: LatLng(
                    selectedPosition.latitude,
                    selectedPosition.longitude,
                  ),
                  builder: (_) => const Icon(
                    Icons.location_on,
                    color: Colors.red,
                    size: 36,
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
