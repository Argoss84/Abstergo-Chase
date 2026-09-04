import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:geolocator/geolocator.dart';

abstract class BootstrapPermissionsService {
  Future<bool> ensureRequiredPermissions();
}

class DeviceBootstrapPermissionsService implements BootstrapPermissionsService {
  const DeviceBootstrapPermissionsService();

  @override
  Future<bool> ensureRequiredPermissions() async {
    final locationReady = await _ensureLocationPermission();
    final microphoneReady = await _ensureMicrophonePermission();
    return locationReady && microphoneReady;
  }

  Future<bool> _ensureLocationPermission() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return false;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse;
  }

  Future<bool> _ensureMicrophonePermission() async {
    MediaStream? stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(<String, dynamic>{
        'audio': true,
        'video': false,
      });
      return true;
    } catch (_) {
      return false;
    } finally {
      final tracks = stream?.getTracks() ?? const <MediaStreamTrack>[];
      for (final track in tracks) {
        await track.stop();
      }
      await stream?.dispose();
    }
  }
}
