import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

typedef VoiceSignalSender =
    Future<void> Function(String targetId, Map<String, dynamic> signal);

class VoiceChatService {
  VoiceChatService({
    required VoiceSignalSender signalSender,
    void Function(String peerId, bool active)? onVoiceActivity,
  }) : _signalSender = signalSender,
       _onVoiceActivity = onVoiceActivity;

  final VoiceSignalSender _signalSender;
  final void Function(String peerId, bool active)? _onVoiceActivity;

  String? _selfId;
  final Map<String, RTCPeerConnection> _peers = <String, RTCPeerConnection>{};
  final Map<String, Future<RTCPeerConnection>> _peerInitFutures = {};
  final Map<String, List<RTCIceCandidate>> _pendingCandidates = {};
  final Set<String> _remoteDescriptionSet = {};
  final Map<String, RTCDataChannel> _metaChannels = <String, RTCDataChannel>{};
  final Set<String> _wantedPeers = <String>{};
  MediaStream? _localStream;
  Future<MediaStream>? _localStreamInitFuture;
  bool _enabled = false;
  bool _disposed = false;
  int _generation = 0;
  bool get isEnabled => _enabled;
  bool _transmissionActive = true;
  DateTime? _lastLocalStreamFailureAt;
  List<Map<String, dynamic>> _iceServers = <Map<String, dynamic>>[
    <String, dynamic>{'urls': AppRuntimeConfig.defaultStunUrl},
  ];

  void configureIceServers(List<Map<String, dynamic>> servers) {
    if (servers.isEmpty) return;
    _iceServers = servers;
  }

  Future<void> enable({
    required String selfId,
    required List<String> peerIds,
  }) async {
    if (_disposed) return;
    final identityChanged = _selfId != null && _selfId != selfId;
    if (identityChanged) {
      _generation++;
      _peerInitFutures.clear();
    }
    final generation = _generation;
    try {
      _selfId = selfId;
      _wantedPeers
        ..clear()
        ..addAll(peerIds.where((id) => id.isNotEmpty && id != selfId));
      if (identityChanged) await _disposeAllPeers();
      if (_disposed || generation != _generation) return;
      final stream = await _ensureLocalStream();
      if (_disposed || generation != _generation) {
        if (!_disposed && !_enabled) await _setLocalAudioEnabled(false);
        return;
      }
      _localStream = stream;
      _enabled = true;
      await _setLocalAudioEnabled(_transmissionActive);
      await _syncPeers();
    } catch (_) {
      if (_disposed || generation != _generation) return;
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
    final future = navigator.mediaDevices
        .getUserMedia(<String, dynamic>{
          'audio': <String, dynamic>{
            'echoCancellation': true,
            'noiseSuppression': true,
            'autoGainControl': true,
          },
          'video': false,
        })
        .then((stream) async {
          if (_disposed) {
            await _disposeLocalStream(stream);
            throw StateError('Voice service disposed.');
          }
          _localStream = stream;
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
    _generation++;
    _peerInitFutures.clear();
    _enabled = false;
    _wantedPeers.clear();
    await _disposeAllPeers();
    await _setLocalAudioEnabled(false);
  }

  Future<void> setTransmissionActive(bool active) async {
    _transmissionActive = active;
    await _setLocalAudioEnabled(_enabled && active);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await disable();
    final stream = _localStream;
    _localStream = null;
    if (stream != null) await _disposeLocalStream(stream);
  }

  Future<void> _disposeLocalStream(MediaStream stream) async {
    final tracks = stream.getTracks();
    for (final track in tracks) {
      try {
        await track.stop();
      } catch (_) {
        // Continue releasing the remaining native resources.
      }
    }
    try {
      await stream.dispose();
    } catch (_) {
      // A native stream can already be closed when the app leaves the page.
    }
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
      if (_disposed || !_enabled) return;
      final type = signal['type']?.toString();
      if (type == null || fromId.isEmpty) return;
      final pc = await _ensurePeer(fromId);
      if (type == 'offer') {
        final sdp = signal['sdp']?.toString();
        if (sdp == null || sdp.isEmpty) return;
        await pc.setRemoteDescription(RTCSessionDescription(sdp, 'offer'));
        await _flushCandidates(fromId, pc);
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
        await pc.setRemoteDescription(RTCSessionDescription(sdp, 'answer'));
        await _flushCandidates(fromId, pc);
        return;
      }
      if (type == 'candidate') {
        final candidate = signal['candidate']?.toString();
        if (candidate == null || candidate.isEmpty) return;
        final sdpMid = signal['sdpMid']?.toString();
        final sdpMLineIndex = int.tryParse(
          signal['sdpMLineIndex']?.toString() ?? '',
        );
        final iceCandidate = RTCIceCandidate(candidate, sdpMid, sdpMLineIndex);
        if (_remoteDescriptionSet.contains(fromId)) {
          await pc.addCandidate(iceCandidate);
        } else {
          final pending = _pendingCandidates[fromId] ??= [];
          if (pending.length < 64) pending.add(iceCandidate);
        }
      }
    } catch (_) {
      return;
    }
  }

  Future<void> _flushCandidates(String peerId, RTCPeerConnection pc) async {
    if (_disposed || !_enabled || _peers[peerId] != pc) return;
    _remoteDescriptionSet.add(peerId);
    final pending = _pendingCandidates.remove(peerId) ?? const [];
    for (final candidate in pending) {
      await pc.addCandidate(candidate);
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
        unawaited(
          channel.send(RTCDataChannelMessage(payload)).catchError((Object _) {
            // A channel can close between its state check and the native send.
          }),
        );
      }
    }
  }

  Future<void> _syncPeers() async {
    final toRemove = _peers.keys
        .where((id) => !_wantedPeers.contains(id))
        .toList();
    for (final peerId in toRemove) {
      await _disposePeer(peerId);
    }
    final self = _selfId ?? '';
    for (final peerId in _wantedPeers.toList(growable: false)) {
      if (_disposed || !_enabled || !_wantedPeers.contains(peerId)) continue;
      if (_peers.containsKey(peerId)) continue;
      final pc = await _ensurePeer(peerId, requireWanted: true);
      if (_disposed || !_enabled || !_wantedPeers.contains(peerId)) continue;
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

  Future<RTCPeerConnection> _ensurePeer(
    String peerId, {
    bool requireWanted = false,
  }) {
    final existing = _peers[peerId];
    if (existing != null) return Future.value(existing);
    final pending = _peerInitFutures[peerId];
    if (pending != null) return pending;
    late final Future<RTCPeerConnection> future;
    future = _createPeer(peerId, requireWanted: requireWanted).whenComplete(() {
      if (identical(_peerInitFutures[peerId], future)) {
        _peerInitFutures.remove(peerId);
      }
    });
    return _peerInitFutures[peerId] = future;
  }

  Future<RTCPeerConnection> _createPeer(
    String peerId, {
    required bool requireWanted,
  }) async {
    final generation = _generation;
    final pc = await createPeerConnection(<String, dynamic>{
      'iceServers': _iceServers,
    });
    if (_disposed ||
        !_enabled ||
        generation != _generation ||
        (requireWanted && !_wantedPeers.contains(peerId))) {
      try {
        await pc.close();
      } finally {
        await pc.dispose();
      }
      throw StateError('Peer initialization cancelled.');
    }
    _peers[peerId] = pc;
    final local = _localStream;
    if (local != null) {
      for (final track in local.getAudioTracks()) {
        await pc.addTrack(track, local);
      }
    }
    pc.onIceCandidate = (candidate) async {
      if (_disposed || generation != _generation || _peers[peerId] != pc) {
        return;
      }
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
      if (_disposed || generation != _generation || _peers[peerId] != pc) {
        unawaited(channel.close().catchError((Object _) {}));
        return;
      }
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
    if (_disposed || !_enabled) {
      unawaited(channel.close().catchError((Object _) {}));
      return;
    }
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
    final pc = _peers.remove(peerId);
    _pendingCandidates.remove(peerId);
    _remoteDescriptionSet.remove(peerId);
    try {
      await channel?.close();
    } catch (_) {
      // Closing one channel must not prevent other peers from being released.
    }
    try {
      await pc?.close();
    } catch (_) {
      // The peer may have closed after a network interruption.
    } finally {
      try {
        await pc?.dispose();
      } catch (_) {
        // Native disposal remains best-effort.
      }
    }
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
