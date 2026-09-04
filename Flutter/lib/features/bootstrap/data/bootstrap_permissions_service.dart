import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:geolocator/geolocator.dart';

enum BootstrapPermissionsStatus { granted, denied, deniedForever, error }

class BootstrapPermissionsResult {
  const BootstrapPermissionsResult(this.status);

  final BootstrapPermissionsStatus status;

  bool get granted => status == BootstrapPermissionsStatus.granted;
}

abstract class BootstrapPermissionsService {
  Future<BootstrapPermissionsResult> ensureRequiredPermissions();

  Future<void> openAppSettings();
}

class DeviceBootstrapPermissionsService implements BootstrapPermissionsService {
  const DeviceBootstrapPermissionsService();

  @override
  Future<BootstrapPermissionsResult> ensureRequiredPermissions() async {
    final locationReady = await _ensureLocationPermission();
    final microphoneReady = await _ensureMicrophonePermission();
    if (locationReady == _PermissionCheck.error ||
        microphoneReady == _PermissionCheck.error) {
      return const BootstrapPermissionsResult(BootstrapPermissionsStatus.error);
    }
    if (locationReady == _PermissionCheck.deniedForever) {
      return const BootstrapPermissionsResult(
        BootstrapPermissionsStatus.deniedForever,
      );
    }
    if (microphoneReady == _PermissionCheck.deniedForever) {
      return const BootstrapPermissionsResult(
        BootstrapPermissionsStatus.deniedForever,
      );
    }
    if (locationReady == _PermissionCheck.granted &&
        microphoneReady == _PermissionCheck.granted) {
      return const BootstrapPermissionsResult(BootstrapPermissionsStatus.granted);
    }
    return const BootstrapPermissionsResult(BootstrapPermissionsStatus.denied);
  }

  @override
  Future<void> openAppSettings() async {
    await Geolocator.openAppSettings();
  }

  Future<_PermissionCheck> _ensureLocationPermission() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        return _PermissionCheck.denied;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        return _PermissionCheck.deniedForever;
      }
      return permission == LocationPermission.always ||
              permission == LocationPermission.whileInUse
          ? _PermissionCheck.granted
          : _PermissionCheck.denied;
    } catch (_) {
      return _PermissionCheck.error;
    }
  }

  Future<_PermissionCheck> _ensureMicrophonePermission() async {
    MediaStream? stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(<String, dynamic>{
        'audio': true,
        'video': false,
      });
      return _PermissionCheck.granted;
    } catch (error) {
      return _microphonePermissionCheckFromError(error);
    } finally {
      final tracks = stream?.getTracks() ?? const <MediaStreamTrack>[];
      for (final track in tracks) {
        await Future.sync(() => track.stop());
      }
      await stream?.dispose();
    }
  }

  _PermissionCheck _microphonePermissionCheckFromError(Object error) {
    final message = error.toString().toLowerCase();
    if (message.contains('denied forever') || message.contains('permanently')) {
      return _PermissionCheck.deniedForever;
    }
    if (message.contains('permission') ||
        message.contains('notallowed') ||
        message.contains('denied')) {
      return _PermissionCheck.denied;
    }
    return _PermissionCheck.error;
  }
}

enum _PermissionCheck { granted, denied, deniedForever, error }
