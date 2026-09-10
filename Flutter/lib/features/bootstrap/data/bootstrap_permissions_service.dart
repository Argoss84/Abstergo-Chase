import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:geolocator/geolocator.dart';

enum BootstrapPermissionsStatus {
  granted,
  denied,
  deniedForever,
  locationServiceDisabled,
  error,
}

class BootstrapPermissionsResult {
  const BootstrapPermissionsResult(this.status);

  final BootstrapPermissionsStatus status;

  bool get granted => status == BootstrapPermissionsStatus.granted;
}

abstract class BootstrapPermissionsService {
  Future<BootstrapPermissionsResult> ensureRequiredPermissions({
    bool forceRequest = false,
  });

  Future<void> openAppSettings();

  Future<void> openLocationSettings();
}

class DeviceBootstrapPermissionsService implements BootstrapPermissionsService {
  const DeviceBootstrapPermissionsService();

  @override
  Future<BootstrapPermissionsResult> ensureRequiredPermissions({
    bool forceRequest = false,
  }) async {
    final locationReady = await _ensureLocationPermission(
      forceRequest: forceRequest,
    );
    final microphoneReady = await _ensureMicrophonePermission();
    if (locationReady == _PermissionCheck.error ||
        microphoneReady == _PermissionCheck.error) {
      return const BootstrapPermissionsResult(BootstrapPermissionsStatus.error);
    }
    if (locationReady == _PermissionCheck.locationServiceDisabled) {
      return const BootstrapPermissionsResult(
        BootstrapPermissionsStatus.locationServiceDisabled,
      );
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

  @override
  Future<void> openLocationSettings() async {
    await Geolocator.openLocationSettings();
  }

  Future<_PermissionCheck> _ensureLocationPermission({
    required bool forceRequest,
  }) async {
    try {
      var permission = await Geolocator.checkPermission();
      final isGranted =
          permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
      if (!isGranted &&
          permission != LocationPermission.deniedForever &&
          forceRequest) {
        permission = await Geolocator.requestPermission();
      }
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        return _PermissionCheck.locationServiceDisabled;
      }
      if (permission == LocationPermission.deniedForever) {
        return _PermissionCheck.deniedForever;
      }
      return permission == LocationPermission.always ||
              permission == LocationPermission.whileInUse
          ? _PermissionCheck.granted
          : _PermissionCheck.denied;
    } on LocationServiceDisabledException {
      return _PermissionCheck.locationServiceDisabled;
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

enum _PermissionCheck {
  granted,
  denied,
  deniedForever,
  locationServiceDisabled,
  error,
}
