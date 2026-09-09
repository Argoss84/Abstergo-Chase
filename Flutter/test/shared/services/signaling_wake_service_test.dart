import 'package:broken_veil_protocol/shared/services/signaling_wake_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  const productionUrl = 'http://35.181.228.185';
  const wakeUrl = 'https://example.lambda-url.eu-west-3.on.aws/';

  test('skips wake for local signaling', () {
    final service = SignalingWakeService(
      wakeUrl: wakeUrl,
      wakeToken: 'token',
      productionUrl: productionUrl,
    );

    expect(service.appliesTo(Uri.parse('http://10.0.2.2:5174')), isFalse);
    expect(service.appliesTo(Uri.parse('http://localhost:5174')), isFalse);
    expect(service.appliesTo(Uri.parse(productionUrl)), isTrue);
  });

  test('skips wake when wake URL is empty', () {
    final service = SignalingWakeService(
      wakeUrl: '',
      wakeToken: 'token',
      productionUrl: productionUrl,
    );

    expect(service.appliesTo(Uri.parse(productionUrl)), isFalse);
  });

  test('returns as soon as the stack is ready', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls += 1;
      expect(request.method, 'POST');
      expect(request.headers['X-Wake-Token'], 'token');
      if (calls == 1) {
        return http.Response(
          '{"ready":false,"status":"WAKING","message":"starting"}',
          202,
        );
      }
      return http.Response(
        '{"ready":true,"status":"AWAKE","message":"ready"}',
        200,
      );
    });
    final service = SignalingWakeService(
      httpClient: client,
      wakeUrl: wakeUrl,
      wakeToken: 'token',
      productionUrl: productionUrl,
      timeout: const Duration(seconds: 8),
      pollInterval: const Duration(milliseconds: 10),
    );

    await service.ensureAwake(Uri.parse(productionUrl));
    expect(calls, 2);
  });

  test('throws after timeout while still waking', () async {
    final client = MockClient((request) async {
      return http.Response(
        '{"ready":false,"status":"WAKING","message":"starting"}',
        202,
      );
    });
    final service = SignalingWakeService(
      httpClient: client,
      wakeUrl: wakeUrl,
      wakeToken: 'token',
      productionUrl: productionUrl,
      timeout: const Duration(milliseconds: 40),
      pollInterval: const Duration(milliseconds: 10),
    );

    await expectLater(
      service.ensureAwake(Uri.parse(productionUrl)),
      throwsA(
        isA<SignalingWakeException>().having(
          (error) => error.message,
          'message',
          contains('pas démarré à temps'),
        ),
      ),
    );
  });

  test('throws on unauthorized wake token', () async {
    final client = MockClient((request) async {
      return http.Response('{"error":"unauthorized"}', 401);
    });
    final service = SignalingWakeService(
      httpClient: client,
      wakeUrl: wakeUrl,
      wakeToken: 'token',
      productionUrl: productionUrl,
      timeout: const Duration(milliseconds: 30),
      pollInterval: const Duration(milliseconds: 5),
    );

    await expectLater(
      service.ensureAwake(Uri.parse(productionUrl)),
      throwsA(
        isA<SignalingWakeException>().having(
          (error) => error.message,
          'message',
          contains('identifiant invalide'),
        ),
      ),
    );
  });
}
