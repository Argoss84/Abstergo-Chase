import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:abstergo_chase/app/config/app_runtime_config.dart';
import 'package:http/http.dart' as http;

class SessionInvalidatedException implements Exception {
  SessionInvalidatedException(this.message);

  final String message;

  @override
  String toString() => message;
}

class PlayerAccountProfile {
  const PlayerAccountProfile({
    required this.id,
    required this.cognitoSub,
    this.email,
    this.username,
    this.displayName,
    this.avatarUrl,
    this.bio,
    this.region,
  });

  final String id;
  final String cognitoSub;
  final String? email;
  final String? username;
  final String? displayName;
  final String? avatarUrl;
  final String? bio;
  final String? region;

  factory PlayerAccountProfile.fromJson(Map<String, dynamic> json) {
    return PlayerAccountProfile(
      id: json['id']?.toString() ?? '',
      cognitoSub: json['cognito_sub']?.toString() ?? '',
      email: json['email']?.toString(),
      username: json['username']?.toString(),
      displayName: json['display_name']?.toString(),
      avatarUrl: json['avatar_url']?.toString(),
      bio: json['bio']?.toString(),
      region: json['region']?.toString(),
    );
  }
}

class AccountApiService {
  AccountApiService();
  static const Duration _requestTimeout = Duration(seconds: 12);

  Future<(String preferred, String fallback)> _resolveBaseUrls() async {
    // Mon compte est temporairement force en environnement DEV uniquement.
    return (
      AppRuntimeConfig.serverBddDevelopmentUrl,
      'http://localhost:5175',
    );
  }

  bool _isTransportFailure(Object error) {
    return error is TimeoutException ||
        error is SocketException ||
        error is http.ClientException;
  }

  Never _throwIfSessionInvalidated(http.Response response) {
    final body = response.body;
    if (response.statusCode == 401 &&
        (body.contains('Session invalidee') ||
            body.contains('Session applicative absente') ||
            body.contains('Token invalide ou expir'))) {
      throw SessionInvalidatedException(
        'Votre session a été déconnectée car ce compte a été utilisé sur un autre appareil.',
      );
    }
    throw Exception(
      'Echec API (${response.statusCode}): ${response.body}',
    );
  }

  Future<T> _withBaseUrlFallback<T>(
    Future<T> Function(String baseUrl) action,
  ) async {
    final (preferred, fallback) = await _resolveBaseUrls();
    try {
      return await action(preferred);
    } catch (error) {
      if (!_isTransportFailure(error) || preferred == fallback) {
        rethrow;
      }
      return action(fallback);
    }
  }

  Future<void> syncUser(String accessToken, {String? username}) async {
    await _withBaseUrlFallback<void>((baseUrl) async {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/auth/sync'),
            headers: {
              'Authorization': 'Bearer $accessToken',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              if (username != null && username.trim().isNotEmpty)
                'username': username.trim(),
            }),
          )
          .timeout(_requestTimeout);
      if (response.statusCode >= 400) {
        _throwIfSessionInvalidated(response);
      }
    });
  }

  Future<PlayerAccountProfile> getMyProfile(String accessToken) async {
    return _withBaseUrlFallback<PlayerAccountProfile>((baseUrl) async {
      final response = await http
          .get(
            Uri.parse('$baseUrl/api/users/me'),
            headers: {
              'Authorization': 'Bearer $accessToken',
            },
          )
          .timeout(_requestTimeout);
      if (response.statusCode >= 400) {
        _throwIfSessionInvalidated(response);
      }
      final decoded = jsonDecode(response.body);
      return PlayerAccountProfile.fromJson(
        decoded['user'] as Map<String, dynamic>? ?? <String, dynamic>{},
      );
    });
  }

  Future<PlayerAccountProfile> updateMyProfile(
    String accessToken, {
    required String username,
    required String displayName,
    required String avatarUrl,
    required String bio,
    required String region,
  }) async {
    return _withBaseUrlFallback<PlayerAccountProfile>((baseUrl) async {
      final response = await http
          .patch(
            Uri.parse('$baseUrl/api/users/me'),
            headers: {
              'Authorization': 'Bearer $accessToken',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'username': username.trim(),
              'display_name': displayName.trim(),
              'avatar_url': avatarUrl.trim(),
              'bio': bio.trim(),
              'region': region.trim(),
            }),
          )
          .timeout(_requestTimeout);
      if (response.statusCode >= 400) {
        _throwIfSessionInvalidated(response);
      }
      final decoded = jsonDecode(response.body);
      return PlayerAccountProfile.fromJson(
        decoded['user'] as Map<String, dynamic>? ?? <String, dynamic>{},
      );
    });
  }

  Future<void> logout(String accessToken) async {
    await _withBaseUrlFallback<void>((baseUrl) async {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/auth/logout'),
            headers: {
              'Authorization': 'Bearer $accessToken',
              'Content-Type': 'application/json',
            },
          )
          .timeout(_requestTimeout);
      if (response.statusCode >= 400) {
        _throwIfSessionInvalidated(response);
      }
    });
  }
}
