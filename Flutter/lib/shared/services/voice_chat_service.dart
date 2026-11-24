import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

typedef VoiceSignalSender =
    Future<void> Function(String targetId, Map<String, dynamic> signal);

enum VoicePeerStatus { connecting, connected, disconnected }

class VoiceChatService {
  VoiceChatService({
    required VoiceSignalSender signalSender,
    void Function(String peerId, bool active)? onVoiceActivity,
    VoidCallback? onConnectionChanged,
  }) : _signalSender = signalSender,
       _onVoiceActivity = onVoiceActivity,
       _onConnectionChanged = onConnectionChanged;

  final VoiceSignalSender _signalSender;
  final void Function(String peerId, bool active)? _onVoiceActivity;
  final VoidCallback? _onConnectionChanged;

  String? _selfId;
  final Map<String, RTCPeerConnection> _peers = <String, RTCPeerConnection>{};
  final Map<String, Future<RTCPeerConnection>> _peerInitFutures = {};
  final Map<String, Future<void>> _peerOperations = {};
  final Set<String> _awaitingAnswer = {};
  final Map<String, ({String offer, String? answer})> _offerReplies = {};
  final List<({String peerId, Map<String, dynamic> signal})> _earlySignals = [];
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
  VoicePeerStatus peerStatus(String id) =>
      switch (_peers[id]?.connectionState) {
        RTCPeerConnectionState.RTCPeerConnectionStateConnected =>
          VoicePeerStatus.connected,
        RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
        RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
        RTCPeerConnectionState.RTCPeerConnectionStateClosed =>
          VoicePeerStatus.disconnected,
        _ =>
          _enabled ? VoicePeerStatus.connecting : VoicePeerStatus.disconnected,
      };
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
      _peerOperations.clear();
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
      final earlySignals = [..._earlySignals];
      _earlySignals.clear();
      for (final entry in earlySignals) {
        await handleSignal(fromId: entry.peerId, signal: entry.signal);
      }
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
    final future = () async {
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
        await Helper.setAppleAudioIOMode(AppleAudioIOMode.localAndRemote);
      }
      final stream = await navigator.mediaDevices.getUserMedia(
        <String, dynamic>{
          'audio': <String, dynamic>{
            'echoCancellation': true,
            'noiseSuppression': true,
            'autoGainControl': true,
          },
          'video': false,
        },
      );
      if (_disposed) {
        await _disposeLocalStream(stream);
        throw StateError('Voice service disposed.');
      }
      _localStream = stream;
      _lastLocalStreamFailureAt = null;
      return stream;
    }();
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
    _peerOperations.clear();
    _earlySignals.clear();
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
  }) {
    if (_disposed || fromId.isEmpty) return Future.value();
    if (!_enabled) {
      if (_earlySignals.length < 128) {
        _earlySignals.add((peerId: fromId, signal: signal));
      }
      return Future.value();
    }
    return _queuePeerOperation(fromId, () async {
      final type = signal['type'];
      if (type == 'restart') {
        if (!_wantedPeers.contains(fromId)) return;
        await _disposePeer(fromId);
        await _connectPeer(fromId);
        return;
      }
      final pc = await _ensurePeer(fromId);
      if (type == 'offer') {
        final sdp = signal['sdp']?.toString();
        if (sdp == null ||
            sdp.isEmpty ||
            (_selfId ?? '').compareTo(fromId) < 0) {
          return;
        }
        final cached = _offerReplies[fromId];
        if (cached != null && cached.offer == sdp) {
          await _signalSender(fromId, {'type': 'answer', 'sdp': cached.answer});
          return;
        }
        await pc.setRemoteDescription(RTCSessionDescription(sdp, 'offer'));
        await _flushCandidates(fromId, pc);
        final answer = await pc.createAnswer(<String, dynamic>{});
        await pc.setLocalDescription(answer);
        _offerReplies[fromId] = (offer: sdp, answer: answer.sdp);
        await _signalSender(fromId, <String, dynamic>{
          'type': 'answer',
          'sdp': answer.sdp,
        });
        return;
      }
      if (type == 'answer') {
        final sdp = signal['sdp']?.toString();
        if (sdp == null || sdp.isEmpty || !_awaitingAnswer.contains(fromId)) {
          return;
        }
        await pc.setRemoteDescription(RTCSessionDescription(sdp, 'answer'));
        _awaitingAnswer.remove(fromId);
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
    }).catchError(_logNegotiationError);
  }

  Future<void> reconnect() async {
    if (!_enabled) return;
    await Future.wait([
      for (final id in _wantedPeers.toList())
        _queuePeerOperation(id, () async {
          if (!_wantedPeers.contains(id)) return;
          await _disposePeer(id);
          await _signalSender(id, {'type': 'restart'});
          await _connectPeer(id);
        }).catchError(_logNegotiationError),
    ]);
    _onConnectionChanged?.call();
  }

  Future<void> _queuePeerOperation(String id, Future<void> Function() work) {
    final generation = _generation;
    final previous = _peerOperations[id] ?? Future<void>.value();
    late final Future<void> next;
    next = previous
        .then<void>((_) {}, onError: (Object _, StackTrace _) {})
        .then((_) async {
          if (!_disposed && _enabled && generation == _generation) await work();
        })
        .whenComplete(() {
          if (identical(_peerOperations[id], next)) _peerOperations.remove(id);
        });
    return _peerOperations[id] = next;
  }

  void _logNegotiationError(Object error, StackTrace stackTrace) {
    if (_disposed || !_enabled) return;
    AppLogger.error(
      'Erreur de connexion au vocal',
      error: error,
      stackTrace: stackTrace,
    );
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
      await _queuePeerOperation(peerId, () => _disposePeer(peerId));
    }
    for (final peerId in _wantedPeers.toList(growable: false)) {
      if (_peers.containsKey(peerId)) continue;
      await _queuePeerOperation(peerId, () => _connectPeer(peerId));
    }
  }

  Future<void> _connectPeer(String peerId) async {
    if (!_enabled ||
        !_wantedPeers.contains(peerId) ||
        _peers.containsKey(peerId)) {
      return;
    }
    final pc = await _ensurePeer(peerId, requireWanted: true);
    if (!_enabled || _peers[peerId] != pc || !_wantedPeers.contains(peerId)) {
      return;
    }
    if ((_selfId ?? '').compareTo(peerId) >= 0) return;
    await _ensureMetaChannel(peerId, pc);
    final offer = await pc.createOffer(<String, dynamic>{});
    await pc.setLocalDescription(offer);
    if (_peers[peerId] != pc) return;
    _awaitingAnswer.add(peerId);
    await _signalSender(peerId, <String, dynamic>{
      'type': 'offer',
      'sdp': offer.sdp,
    });
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
    pc.onConnectionState = (_) {
      if (_peers[peerId] == pc) _onConnectionChanged?.call();
    };
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
    _awaitingAnswer.remove(peerId);
    _offerReplies.remove(peerId);
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
