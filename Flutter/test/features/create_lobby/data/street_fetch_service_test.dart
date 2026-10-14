import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/data/street_fetch_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _ClosingClient extends MockClient {
  _ClosingClient(super.handler, this.onClose);
  final void Function() onClose;
  bool closed = false;

  @override
  void close() {
    if (closed) return;
    closed = true;
    onClose();
    super.close();
  }
}

void main() {
  const service = StreetFetchService();
  const center = GeoPoint(latitude: 45, longitude: 4);

  test('cancellation before loading never sends an HTTP request', () async {
    var requests = 0;
    final cancellation = StreetFetchCancellation()..cancel();
    await http.runWithClient(
      () => expectLater(
        service.fetchWalkableStreets(
          center: center,
          mapRadiusMeters: 200,
          cancellation: cancellation,
        ),
        throwsStateError,
      ),
      () => MockClient((_) async {
        requests++;
        return http.Response('', 200);
      }),
    );
    expect(requests, 0);
  });

  test(
    'cancelling an obsolete terrain closes its active HTTP request without retries',
    () async {
      final cancellation = StreetFetchCancellation();
      final response = Completer<http.Response>();
      var requests = 0;
      final client = _ClosingClient((_) {
        requests++;
        return response.future;
      }, () => response.completeError(http.ClientException('cancelled')));
      await http.runWithClient(() async {
        final pending = service.fetchWalkableStreets(
          center: center,
          mapRadiusMeters: 200,
          cancellation: cancellation,
        );
        await Future<void>.delayed(Duration.zero);
        cancellation.cancel();
        await expectLater(pending, throwsA(isA<http.ClientException>()));
      }, () => client);
      expect(client.closed, isTrue);
      expect(requests, 1);
    },
  );

  test(
    'large OSM responses preserve the street geometry when parsed in the background',
    () async {
      final body =
          '''<osm version="0.6">
<node id="1" lat="45" lon="4"/><node id="2" lat="45.001" lon="4.001"/>
<way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way>
<way id="2"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="area" v="yes"/></way>
<!-- ${'padding' * 10000} -->
</osm>''';
      final result = await http.runWithClient(
        () =>
            service.fetchWalkableStreets(center: center, mapRadiusMeters: 200),
        () => MockClient((_) async => http.Response(body, 200)),
      );
      expect(result, hasLength(1));
      expect(result.single.map((p) => (p.latitude, p.longitude)), [
        (45.0, 4.0),
        (45.001, 4.001),
      ]);
    },
  );
}
