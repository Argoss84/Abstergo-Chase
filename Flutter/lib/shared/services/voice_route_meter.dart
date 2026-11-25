import 'package:flutter_webrtc/flutter_webrtc.dart';

enum VoiceRoute { p2p, ownTurn, otherTurn, unknown }

class VoiceRouteCounts {
  final Map<VoiceRoute, int> _bytes = {};
  int measuredIntervals = 0;
  int unmeasurableIntervals = 0;

  bool get hasIntervals => measuredIntervals + unmeasurableIntervals > 0;

  void add(VoiceRoute route, int bytes) {
    _bytes.update(route, (previous) => previous + bytes, ifAbsent: () => bytes);
    measuredIntervals++;
  }

  void merge(VoiceRouteCounts other) {
    for (final entry in other._bytes.entries) {
      _bytes.update(
        entry.key,
        (value) => value + entry.value,
        ifAbsent: () => entry.value,
      );
    }
    measuredIntervals += other.measuredIntervals;
    unmeasurableIntervals += other.unmeasurableIntervals;
  }

  Map<String, int> toJson() => {
    for (final route in VoiceRoute.values)
      '${route.name}Bytes': _bytes[route] ?? 0,
    'measuredIntervals': measuredIntervals,
    'unmeasurableIntervals': unmeasurableIntervals,
  };
}

class VoiceRouteMeter {
  VoiceRouteMeter(Set<String> ownedRelayHosts)
    : _ownedRelayHosts = ownedRelayHosts.map(_normalize).toSet();

  final Set<String> _ownedRelayHosts;
  Map<String, ({int bytes, String? pairId, VoiceRoute route})> _previous = {};

  VoiceRouteCounts observe(List<StatsReport> stats) {
    final counts = VoiceRouteCounts();
    final reports = {for (final stat in stats) stat.id: stat};
    final pairs = stats.where((stat) => stat.type == 'candidate-pair');
    final selected = pairs
        .where((stat) => stat.values['selected'] == true)
        .toList();
    final nominated = pairs
        .where(
          (stat) =>
              stat.values['nominated'] == true &&
              stat.values['state'] == 'succeeded',
        )
        .toList();
    final fallback = selected.length == 1
        ? selected.single
        : (selected.isEmpty && nominated.length == 1 ? nominated.single : null);
    final current = <String, ({int bytes, String? pairId, VoiceRoute route})>{};

    for (final stream in stats.where((stat) => stat.type == 'outbound-rtp')) {
      final codec = reports[stream.values['codecId']]?.values['mimeType'];
      final kind = stream.values['kind'] ?? stream.values['mediaType'];
      if (kind != 'audio' &&
          (codec is! String || !codec.startsWith('audio/'))) {
        continue;
      }
      final bytes = stream.values['bytesSent'];
      if (bytes is! num || !bytes.isFinite || bytes < 0) {
        counts.unmeasurableIntervals++;
        continue;
      }
      final transport = reports[stream.values['transportId']];
      final pairId = transport?.values['selectedCandidatePairId'];
      final pair = pairId is String ? reports[pairId] : fallback;
      final local = reports[pair?.values['localCandidateId']];
      final remote = reports[pair?.values['remoteCandidateId']];
      final route = _route(local, remote);
      final value = (bytes: bytes.toInt(), pairId: pair?.id, route: route);
      current[stream.id] = value;
      final before = _previous[stream.id];
      if (before == null) continue;
      final delta = value.bytes - before.bytes;
      if (delta < 0) {
        counts.unmeasurableIntervals++;
      } else {
        counts.add(
          before.pairId == value.pairId && before.route == route
              ? route
              : VoiceRoute.unknown,
          delta,
        );
      }
    }
    if (current.isEmpty && counts.unmeasurableIntervals == 0) {
      counts.unmeasurableIntervals++;
    }
    _previous = current;
    return counts;
  }

  VoiceRoute _route(StatsReport? local, StatsReport? remote) {
    final types = [
      local?.values['candidateType'],
      remote?.values['candidateType'],
    ];
    const direct = {'host', 'srflx', 'prflx'};
    final relays = [
      if (types[0] == 'relay' && local != null) local,
      if (types[1] == 'relay' && remote != null) remote,
    ];
    if (relays.isEmpty) {
      return types.every(direct.contains) ? VoiceRoute.p2p : VoiceRoute.unknown;
    }
    var verifiedOther = 0;
    for (final relay in relays) {
      final url = relay.values['url'];
      final host = url is String ? _turnHost(url) : null;
      final address = relay.values['address'] ?? relay.values['ip'];
      if ((host != null && _ownedRelayHosts.contains(host)) ||
          (address is String &&
              _ownedRelayHosts.contains(_normalize(address)))) {
        return VoiceRoute.ownTurn;
      }
      // Browser statistics may omit the TURN URL for a remote candidate.
      if (host != null && _ownedRelayHosts.isNotEmpty) verifiedOther++;
    }
    return types.every((type) => type == 'relay' || direct.contains(type)) &&
            verifiedOther == relays.length
        ? VoiceRoute.otherTurn
        : VoiceRoute.unknown;
  }

  static String _normalize(String value) =>
      value.trim().toLowerCase().replaceAll(RegExp(r'^\[|\]$'), '');

  static String? _turnHost(String url) {
    final host = RegExp(
      r'^turns?:(?://)?(\[[^\]]+\]|[^:/?\s]+)',
      caseSensitive: false,
    ).firstMatch(url)?.group(1);
    return host == null ? null : _normalize(host);
  }
}
