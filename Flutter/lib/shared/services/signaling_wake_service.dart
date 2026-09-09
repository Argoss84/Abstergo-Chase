import 'dart:convert';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:http/http.dart' as http;

class SignalingWakeException implements Exception {
  SignalingWakeException(this.message, {this.retryable = true});

  final String message;
  final bool retryable;

  @override
  String toString() => message;
}

class SignalingWakeStatus {
  const SignalingWakeStatus({
    required this.ready,
    required this.status,
    required this.message,
  });

  factory SignalingWakeStatus.fromJson(Map<String, dynamic> json) {
    return SignalingWakeStatus(
      ready: json['ready'] == true,
      status: json['status']?.toString() ?? 'UNKNOWN',
      message: json['message']?.toString() ?? '',
    );
  }

  final bool ready;
  final String status;
  final String message;
}

class SignalingWakeService {
  SignalingWakeService({
    http.Client? httpClient,
    String? wakeUrl,
    String? wakeToken,
    String? productionUrl,
    this.timeout = const Duration(minutes: 3),
    this.pollInterval = const Duration(seconds: 2),
  }) : _client = httpClient ?? http.Client(),
       _wakeUrl = wakeUrl ?? AppRuntimeConfig.signalingWakeUrl,
       _wakeToken = wakeToken ?? AppRuntimeConfig.signalingWakeToken,
       _productionUrl = productionUrl ?? AppRuntimeConfig.signalingProductionUrl;

  static final SignalingWakeService instance = SignalingWakeService();

  final http.Client _client;
  final String _wakeUrl;
  final String _wakeToken;
  final String _productionUrl;
  final Duration timeout;
  final Duration pollInterval;

  bool appliesTo(Uri signalingUrl) {
    if (_wakeUrl.trim().isEmpty) {
      return false;
    }
    final productionHost = Uri.tryParse(_productionUrl)?.host ?? '';
    if (productionHost.isEmpty) {
      return false;
    }
    return signalingUrl.host == productionHost;
  }

  Future<void> ensureAwake(Uri signalingUrl) async {
    if (!appliesTo(signalingUrl)) {
      return;
    }
    final wakeUri = Uri.tryParse(_wakeUrl.trim());
    if (wakeUri == null ||
        (wakeUri.scheme != 'https' && wakeUri.scheme != 'http')) {
      throw SignalingWakeException(
        'Démarrage du serveur de jeu impossible : URL de réveil invalide.',
      );
    }
    if (_wakeToken.trim().isEmpty) {
      throw SignalingWakeException(
        'Démarrage du serveur de jeu impossible : jeton de réveil manquant.',
      );
    }

    final deadline = DateTime.now().add(timeout);
    Object? lastError;
    while (DateTime.now().isBefore(deadline)) {
      try {
        final status = await _requestWake(wakeUri);
        if (status.ready) {
          return;
        }
      } on SignalingWakeException catch (error) {
        if (!error.retryable) {
          rethrow;
        }
        lastError = error;
      } catch (error) {
        lastError = error;
      }
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) {
        break;
      }
      final wait = remaining < pollInterval ? remaining : pollInterval;
      await Future<void>.delayed(wait);
    }

    if (lastError != null) {
      throw SignalingWakeException(lastError.toString());
    }
    throw SignalingWakeException(
      'Le serveur de jeu n\'a pas démarré à temps. Réessayez.',
    );
  }

  Future<SignalingWakeStatus> _requestWake(Uri wakeUri) async {
    final response = await _client
        .post(
          wakeUri,
          headers: <String, String>{
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Wake-Token': _wakeToken,
          },
          body: '{}',
        )
        .timeout(const Duration(seconds: 20));

    if (response.statusCode == 401) {
      throw SignalingWakeException(
        'Démarrage du serveur de jeu impossible : identifiant invalide.',
        retryable: false,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw SignalingWakeException(
        'Démarrage du serveur de jeu impossible (${response.statusCode}).',
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw SignalingWakeException(
        'Démarrage du serveur de jeu impossible : réponse invalide.',
      );
    }
    return SignalingWakeStatus.fromJson(
      Map<String, dynamic>.from(decoded),
    );
  }
}
