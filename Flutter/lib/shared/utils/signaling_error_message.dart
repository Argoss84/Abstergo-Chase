String signalingErrorMessage(
  dynamic payload, {
  String fallback = 'Erreur',
}) {
  if (payload is Map) {
    final message = payload['message']?.toString().trim();
    if (message != null && message.isNotEmpty) return message;
    final reason = payload['reason']?.toString().trim();
    if (reason != null && reason.isNotEmpty) return reason;
  }
  final raw = payload?.toString().trim();
  if (raw == null || raw.isEmpty) return fallback;
  return raw;
}

bool isTransientVoiceSignalingError(String? message) {
  if (message == null || message.isEmpty) return false;
  return message.contains('Destinataire WebRTC introuvable');
}
