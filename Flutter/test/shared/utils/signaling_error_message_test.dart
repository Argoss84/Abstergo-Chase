import 'package:broken_veil_protocol/shared/utils/signaling_error_message.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('extracts message from signaling payload maps', () {
    expect(
      signalingErrorMessage(<String, dynamic>{
        'message': 'Destinataire WebRTC introuvable.',
      }),
      'Destinataire WebRTC introuvable.',
    );
    expect(
      signalingErrorMessage(<String, dynamic>{'reason': 'Hors zone.'}),
      'Hors zone.',
    );
    expect(signalingErrorMessage('Lobby not found.'), 'Lobby not found.');
  });

  test('detects transient WebRTC recipient errors', () {
    expect(
      isTransientVoiceSignalingError('Destinataire WebRTC introuvable.'),
      isTrue,
    );
    expect(
      isTransientVoiceSignalingError(
        '{message: Destinataire WebRTC introuvable.}',
      ),
      isTrue,
    );
    expect(isTransientVoiceSignalingError('Partie introuvable.'), isFalse);
  });
}
