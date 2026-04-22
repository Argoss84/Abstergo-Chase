import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';

typedef VoiceSignalSender = Future<void> Function(
  String targetId,
  Map<String, dynamic> signal,
);

class VoiceChatService {
  VoiceChatService({
    required VoiceSignalSender signalSender,
    void Function(String peerId, bool active)? onVoiceActivity,
  })  : _signalSender = signalSender,
        _onVoiceActivity = onVoiceActivity;

  final VoiceSignalSender _signalSender;
  final void Function(String peerId, bool active)? _onVoiceActivity;

  String? _selfId;
  final Map<String, RTCPeerConnection> _peers = <String, RTCPeerConnection>{};
  final Map<String, RTCDataChannel> _metaChannels = <String, RTCDataChannel>{};
  final Set<String> _wantedPeers = <String>{};
  MediaStream? _localStream;
  Future<MediaStream>? _localStreamInitFuture;
  bool _enabled = false;
  bool _transmissionActive = true;
  DateTime? _lastLocalStreamFailureAt;
  List<Map<String, dynamic>> _iceServers = <Map<String, dynamic>>[
    <String, dynamic>{'urls': 'stun:13.37.68.16:3478'},
  ];

  void configureIceServers(List<Map<String, dynamic>> servers) {
    if (servers.isEmpty) return;
    _iceServers = servers;
  }

  Future<void> enable({
    required String selfId,
    required List<String> peerIds,
  }) async {
    try {
      _selfId = selfId;
      _wantedPeers
        ..clear()
        ..addAll(peerIds.where((id) => id.isNotEmpty && id != selfId));
      _localStream = await _ensureLocalStream();
      _enabled = true;
      await _syncPeers();
      await _setLocalAudioEnabled(true);
    } catch (_) {
      // Never crash gameplay/lobby because of voice stack failures.
      _enabled = false;
      await _disposeAllPeers();
      await _setLocalAudioEnabled(false);
    }
  }

  Future<MediaStream> _ensureLocalStream() async {
    final current = _localStream;
    if (current != null) return current;
    final lastFailureAt = _lastLocalStreamFailureAt;
    if (lastFailureAt != null &&
        DateTime.now().difference(lastFailureAt) < const Duration(seconds: 3)) {
      throw StateError('Microphone initialization in cooldown.');
    }
    final inFlight = _localStreamInitFuture;
    if (inFlight != null) {
      return inFlight;
    }
    final future = navigator.mediaDevices.getUserMedia(
      <String, dynamic>{
        'audio': <String, dynamic>{
          'echoCancellation': true,
          'noiseSuppression': true,
          'autoGainControl': true,
        },
        'video': false,
      },
    ).then((stream) {
      _lastLocalStreamFailureAt = null;
      return stream;
    });
    _localStreamInitFuture = future;
    try {
      return await future;
    } catch (_) {
      _lastLocalStreamFailureAt = DateTime.now();
      rethrow;
    } finally {
      _localStreamInitFuture = null;
    }
  }

  Future<void> disable() async {
    _enabled = false;
    _wantedPeers.clear();
    await _disposeAllPeers();
    await _setLocalAudioEnabled(false);
  }

  Future<void> setTransmissionActive(bool active) async {
    _transmissionActive = active;
    await _setLocalAudioEnabled(active);
  }

  Future<void> dispose() async {
    await disable();
    final tracks = _localStream?.getTracks() ?? const <MediaStreamTrack>[];
    for (final track in tracks) {
      await track.stop();
    }
    await _localStream?.dispose();
    _localStream = null;
  }

  Future<void> updatePeers(List<String> peerIds) async {
    if (!_enabled) return;
    final self = _selfId;
    if (self == null || self.isEmpty) return;
    _wantedPeers
      ..clear()
      ..addAll(peerIds.where((id) => id.isNotEmpty && id != self));
    await _syncPeers();
  }

  Future<void> handleSignal({
    required String fromId,
    required Map<String, dynamic> signal,
  }) async {
    try {
      if (!_enabled) return;
      final type = signal['type']?.toString();
      if (type == null || fromId.isEmpty) return;
      final pc = await _ensurePeer(fromId);
      if (type == 'offer') {
        final sdp = signal['sdp']?.toString();
        if (sdp == null || sdp.isEmpty) return;
        await pc.setRemoteDescription(
          RTCSessionDescription(sdp, 'offer'),
        );
        final answer = await pc.createAnswer(<String, dynamic>{});
        await pc.setLocalDescription(answer);
        await _signalSender(fromId, <String, dynamic>{
          'type': 'answer',
          'sdp': answer.sdp,
        });
        return;
      }
      if (type == 'answer') {
        final sdp = signal['sdp']?.toString();
        if (sdp == null || sdp.isEmpty) return;
        await pc.setRemoteDescription(
          RTCSessionDescription(sdp, 'answer'),
        );
        return;
      }
      if (type == 'candidate') {
        final candidate = signal['candidate']?.toString();
        if (candidate == null || candidate.isEmpty) return;
        final sdpMid = signal['sdpMid']?.toString();
        final sdpMLineIndex =
            int.tryParse(signal['sdpMLineIndex']?.toString() ?? '');
        await pc.addCandidate(
          RTCIceCandidate(candidate, sdpMid, sdpMLineIndex),
        );
      }
    } catch (_) {
      return;
    }
  }

  void broadcastVoiceActivity({
    required bool forceInactive,
    required double level,
  }) {
    if (!_enabled) return;
    final payload = jsonEncode(<String, dynamic>{
      'type': 'voice-activity',
      'active': forceInactive ? false : _transmissionActive,
      'level': level.clamp(0.0, 1.0),
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    for (final channel in _metaChannels.values) {
      if (channel.state == RTCDataChannelState.RTCDataChannelOpen) {
        channel.send(RTCDataChannelMessage(payload));
      }
    }
  }

  Future<void> _syncPeers() async {
    final toRemove =
        _peers.keys.where((id) => !_wantedPeers.contains(id)).toList();
    for (final peerId in toRemove) {
      await _disposePeer(peerId);
    }
    final self = _selfId ?? '';
    for (final peerId in _wantedPeers) {
      if (_peers.containsKey(peerId)) continue;
      final pc = await _ensurePeer(peerId);
      final amInitiator = self.compareTo(peerId) < 0;
      if (amInitiator) {
        await _ensureMetaChannel(peerId, pc);
        final offer = await pc.createOffer(<String, dynamic>{});
        await pc.setLocalDescription(offer);
        await _signalSender(peerId, <String, dynamic>{
          'type': 'offer',
          'sdp': offer.sdp,
        });
      }
    }
  }

  Future<RTCPeerConnection> _ensurePeer(String peerId) async {
    final existing = _peers[peerId];
    if (existing != null) return existing;
    final pc = await createPeerConnection(
      <String, dynamic>{'iceServers': _iceServers},
    );
    _peers[peerId] = pc;
    final local = _localStream;
    if (local != null) {
      for (final track in local.getAudioTracks()) {
        await pc.addTrack(track, local);
      }
    }
    pc.onIceCandidate = (candidate) async {
      final c = candidate.candidate;
      if (c == null || c.isEmpty) return;
      await _signalSender(peerId, <String, dynamic>{
        'type': 'candidate',
        'candidate': c,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };
    pc.onDataChannel = (channel) {
      _bindMetaChannel(peerId, channel);
    };
    return pc;
  }

  Future<void> _ensureMetaChannel(String peerId, RTCPeerConnection pc) async {
    if (_metaChannels.containsKey(peerId)) return;
    final channel = await pc.createDataChannel(
      'voice-meta',
      RTCDataChannelInit()..ordered = false,
    );
    _bindMetaChannel(peerId, channel);
  }

  void _bindMetaChannel(String peerId, RTCDataChannel channel) {
    _metaChannels[peerId] = channel;
    channel.onMessage = (msg) {
      if (msg.isBinary) return;
      try {
        final decoded = jsonDecode(msg.text);
        if (decoded is! Map) return;
        if (decoded['type']?.toString() != 'voice-activity') return;
        final active = decoded['active'] == true;
        _onVoiceActivity?.call(peerId, active);
      } catch (_) {
        return;
      }
    };
  }

  Future<void> _disposePeer(String peerId) async {
    final channel = _metaChannels.remove(peerId);
    await channel?.close();
    final pc = _peers.remove(peerId);
    await pc?.close();
  }

  Future<void> _disposeAllPeers() async {
    final ids = _peers.keys.toList(growable: false);
    for (final id in ids) {
      await _disposePeer(id);
    }
  }

  Future<void> _setLocalAudioEnabled(bool enabled) async {
    final stream = _localStream;
    if (stream == null) return;
    for (final track in stream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }
}
