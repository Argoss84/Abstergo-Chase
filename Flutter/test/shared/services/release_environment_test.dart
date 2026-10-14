import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/shared/services/socket_environment_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('fresh release environment selects production', () async {
    final service = SocketEnvironmentService(defaultUseProduction: true);
    final config = await service.loadConfig();
    expect(config.useProduction, isTrue);
    expect(config.serverUrl, AppRuntimeConfig.signalingProductionUrl);
  });

  test('fresh debug environment keeps the local server', () async {
    final config = await SocketEnvironmentService().loadConfig();
    expect(config.useProduction, isFalse);
    expect(config.serverUrl, AppRuntimeConfig.signalingDevelopmentUrl);
  });

  test('an explicit environment choice survives a store update', () async {
    SharedPreferences.setMockInitialValues({
      'socket.environment.use_production': false,
    });
    final service = SocketEnvironmentService(defaultUseProduction: true);
    expect(await service.useProduction(), isFalse);
    await service.setUseProduction(true);
    expect(await service.useProduction(), isTrue);
  });

  test('release profiles use the production API', () async {
    final requests = <Uri>[];
    await http.runWithClient(
      () async {
        final profile = await AccountApiService(
          useProduction: true,
        ).getMyProfile('test-token');
        expect(profile.username, 'Agent');
      },
      () => MockClient((request) async {
        requests.add(request.url);
        return http.Response('{"user":{"username":"Agent"}}', 200);
      }),
    );
    expect(
      requests.single.toString(),
      '${AppRuntimeConfig.serverBddProductionUrl}/api/users/me',
    );
  });

  test('a production outage never falls back to localhost', () async {
    final requests = <Uri>[];
    await http.runWithClient(
      () => expectLater(
        AccountApiService(useProduction: true).getMyProfile('test-token'),
        throwsA(isA<http.ClientException>()),
      ),
      () => MockClient((request) async {
        requests.add(request.url);
        throw http.ClientException('offline', request.url);
      }),
    );
    expect(requests, hasLength(1));
    expect(
      requests.single.origin,
      Uri.parse(AppRuntimeConfig.serverBddProductionUrl).origin,
    );
  });

  test('debug profiles keep their localhost fallback', () async {
    final requests = <Uri>[];
    await http.runWithClient(
      () => AccountApiService().getMyProfile('test-token'),
      () => MockClient((request) async {
        requests.add(request.url);
        if (requests.length == 1) {
          throw http.ClientException('offline', request.url);
        }
        return http.Response('{"user":{"username":"Agent"}}', 200);
      }),
    );
    expect(requests.map((uri) => uri.origin), [
      Uri.parse(AppRuntimeConfig.serverBddDevelopmentUrl).origin,
      'http://localhost:5175',
    ]);
  });
}
