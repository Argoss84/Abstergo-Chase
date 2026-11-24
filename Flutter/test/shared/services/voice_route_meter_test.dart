import 'package:broken_veil_protocol/shared/services/voice_route_meter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

List<StatsReport> stats(
  int bytes, {
  String pair = 'pair',
  String localType = 'host',
  String remoteType = 'srflx',
  String? localUrl,
  String? remoteAddress,
}) => [
  StatsReport('audio', 'outbound-rtp', 0, {
    'kind': 'audio',
    'bytesSent': bytes,
    'transportId': 'transport',
  }),
  StatsReport('inbound', 'inbound-rtp', 0, {
    'kind': 'audio',
    'bytesReceived': bytes,
  }),
  StatsReport('data', 'data-channel', 0, {'bytesSent': bytes}),
  StatsReport('transport', 'transport', 0, {'selectedCandidatePairId': pair}),
  StatsReport(pair, 'candidate-pair', 0, {
    'localCandidateId': 'l',
    'remoteCandidateId': 'r',
  }),
  StatsReport('l', 'local-candidate', 0, {
    'candidateType': localType,
    'url': localUrl,
  }),
  StatsReport('r', 'remote-candidate', 0, {
    'candidateType': remoteType,
    'address': remoteAddress,
  }),
];

void main() {
  test(
    'outbound bytes are counted once and changes in ICE pair are attributed to unknown',
    () {
      final meter = VoiceRouteMeter({'turn.example.com', '203.0.113.1'});
      expect(meter.observe(stats(10)).hasIntervals, false);
      expect(meter.observe(stats(20)).toJson()['p2pBytes'], 10);
      const relay = 'turns:turn.example.com:5349?transport=tcp';
      final transition = meter.observe(
        stats(30, pair: 'relay', localType: 'relay', localUrl: relay),
      );
      expect(transition.toJson()['unknownBytes'], 10);
      final steady = meter.observe(
        stats(45, pair: 'relay', localType: 'relay', localUrl: relay),
      );
      expect(steady.toJson()['ownTurnBytes'], 15);
    },
  );

  test('the other participant may be using the project relay', () {
    final meter = VoiceRouteMeter({'203.0.113.1'});
    meter.observe(stats(0, remoteType: 'relay', remoteAddress: '203.0.113.1'));
    final counts = meter.observe(
      stats(35, remoteType: 'relay', remoteAddress: '203.0.113.1'),
    );
    expect(counts.toJson()['ownTurnBytes'], 35);
  });

  test(
    'unidentified remote relay and negative counter deltas are explicit',
    () {
      final meter = VoiceRouteMeter({'203.0.113.1'});
      meter.observe(stats(5, remoteType: 'relay'));
      expect(
        meter.observe(stats(15, remoteType: 'relay')).toJson()['unknownBytes'],
        10,
      );
      expect(
        meter.observe(stats(2, remoteType: 'relay')).unmeasurableIntervals,
        1,
      );
    },
  );
}
