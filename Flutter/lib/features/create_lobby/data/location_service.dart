import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:geolocator/geolocator.dart';

class LocationService {
  const LocationService();

  Future<GeoPoint> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw Exception('La géolocalisation est désactivée.');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw Exception('Permission de localisation refusée.');
    }

    final position = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
      timeLimit: const Duration(seconds: 20),
    );
    return GeoPoint(
      latitude: position.latitude,
      longitude: position.longitude,
    );
  }
}
