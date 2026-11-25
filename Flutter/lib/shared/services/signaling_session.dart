import 'dart:async';

import 'package:flutter/foundation.dart';

class SignalingSession {
  SignalingSession._();
  static Future<String?> Function()? ticketProvider;

  static void authenticate(Uri server, void Function(Map) callback) {
    unawaited(_authenticate(server, callback));
  }

  static Future<void> _authenticate(
    Uri server,
    void Function(Map) callback,
  ) async {
    if (kReleaseMode && server.scheme != 'https' && server.scheme != 'wss') {
      callback({});
      return;
    }
    try {
      final ticket = await ticketProvider?.call();
      callback({if (ticket != null && ticket.isNotEmpty) 'ticket': ticket});
    } catch (_) {
      callback({});
    }
  }
}
