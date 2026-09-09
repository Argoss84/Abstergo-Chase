import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const locationChannel = MethodChannel('flutter.baseflow.com/geolocator');
  const microphoneChannel = MethodChannel('FlutterWebRTC.Method');
  const microphoneEvents = MethodChannel('FlutterWebRTC.Event');
  const service = DeviceBootstrapPermissionsService();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late bool serviceEnabled;
  late LocationPermission permission;
  late LocationPermission requestedPermission;
  late List<String> locationCalls;
  late List<String> microphoneCalls;
  PlatformException? locationError;
  PlatformException? microphoneError;

  setUp(() {
    serviceEnabled = true;
    permission = LocationPermission.whileInUse;
    requestedPermission = LocationPermission.whileInUse;
    locationCalls = <String>[];
    microphoneCalls = <String>[];
    locationError = null;
    microphoneError = null;

    messenger.setMockMethodCallHandler(locationChannel, (call) async {
      locationCalls.add(call.method);
      switch (call.method) {
        case 'checkPermission':
          if (locationError != null) throw locationError!;
          return permission.index;
        case 'requestPermission':
          return requestedPermission.index;
        case 'isLocationServiceEnabled':
          return serviceEnabled;
        case 'openAppSettings':
        case 'openLocationSettings':
          return true;
        default:
          throw MissingPluginException(call.method);
      }
    });
    messenger.setMockMethodCallHandler(microphoneEvents, (_) async => null);
    messenger.setMockMethodCallHandler(microphoneChannel, (call) async {
      microphoneCalls.add(call.method);
      switch (call.method) {
        case 'initialize':
        case 'streamDispose':
          return null;
        case 'getUserMedia':
          if (microphoneError != null) throw microphoneError!;
          return <String, dynamic>{
            'streamId': 'test-stream',
            'audioTracks': <dynamic>[],
            'videoTracks': <dynamic>[],
          };
        default:
          throw MissingPluginException(call.method);
      }
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(locationChannel, null);
    messenger.setMockMethodCallHandler(microphoneChannel, null);
    messenger.setMockMethodCallHandler(microphoneEvents, null);
  });

  test('Reports disabled GPS separately from granted permissions', () async {
    serviceEnabled = false;

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.locationServiceDisabled);
    expect(result.granted, isFalse);
    expect(locationCalls, isNot(contains('requestPermission')));
    expect(microphoneCalls, containsAllInOrder(['getUserMedia', 'streamDispose']));
  });

  test('Requests location permission even when GPS is disabled', () async {
    serviceEnabled = false;
    permission = LocationPermission.denied;

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(locationCalls, <String>[
      'checkPermission',
      'requestPermission',
      'isLocationServiceEnabled',
    ]);
    expect(result.status, BootstrapPermissionsStatus.locationServiceDisabled);
    expect(microphoneCalls, contains('getUserMedia'));
  });

  test('Guides GPS activation if permission cannot be granted while off', () async {
    serviceEnabled = false;
    permission = LocationPermission.denied;
    requestedPermission = LocationPermission.denied;

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.locationServiceDisabled);
    expect(locationCalls, contains('requestPermission'));
  });

  test('Reports permission denial when GPS is enabled', () async {
    permission = LocationPermission.denied;
    requestedPermission = LocationPermission.denied;

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.denied);
    expect(result.granted, isFalse);
    expect(locationCalls, contains('requestPermission'));
  });

  test('Does not request permanently denied location permission', () async {
    permission = LocationPermission.deniedForever;

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.deniedForever);
    expect(locationCalls, isNot(contains('requestPermission')));
  });

  test('Does not request location permission during a passive check', () async {
    permission = LocationPermission.denied;

    final result = await service.ensureRequiredPermissions();

    expect(result.status, BootstrapPermissionsStatus.denied);
    expect(locationCalls, isNot(contains('requestPermission')));
  });

  for (final grantedPermission in [
    LocationPermission.whileInUse,
    LocationPermission.always,
  ]) {
    test('Grants access with $grantedPermission and GPS enabled', () async {
      permission = grantedPermission;

      final result = await service.ensureRequiredPermissions(forceRequest: true);

      expect(result.status, BootstrapPermissionsStatus.granted);
      expect(result.granted, isTrue);
      expect(locationCalls, isNot(contains('requestPermission')));
    });
  }

  test('Still requires microphone permission when location is ready', () async {
    microphoneError = PlatformException(
      code: 'NotAllowedError',
      message: 'Microphone permission denied',
    );

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.denied);
    expect(result.granted, isFalse);
  });

  test('Recognizes native location-service-disabled errors', () async {
    locationError = PlatformException(code: 'LOCATION_SERVICES_DISABLED');

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.locationServiceDisabled);
  });

  test('Preserves unexpected permission errors', () async {
    locationError = PlatformException(code: 'unexpected');

    final result = await service.ensureRequiredPermissions(forceRequest: true);

    expect(result.status, BootstrapPermissionsStatus.error);
  });

  test('Opens the appropriate device settings', () async {
    await service.openLocationSettings();
    await service.openAppSettings();

    expect(locationCalls, <String>['openLocationSettings', 'openAppSettings']);
  });
}
