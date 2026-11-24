import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class AccountApiException implements Exception {
  const AccountApiException(this.message, this.status);
  final String message;
  final int status;

  @override
  String toString() => message;
}

class SessionInvalidatedException extends AccountApiException {
  const SessionInvalidatedException(String message) : super(message, 401);
}

class BackendUnavailableException extends AccountApiException {
  const BackendUnavailableException(String message) : super(message, 503);
}

class PlayerAccountProfile {
  const PlayerAccountProfile({
    required this.id,
    required this.cognitoSub,
    this.publicId,
    this.email,
    this.username,
    this.displayName,
    this.avatarUrl,
    this.bio,
    this.region,
  });

  final String id;
  final String cognitoSub;
  final String? publicId;
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
      publicId: json['public_id']?.toString(),
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
  AccountApiService({
    bool useProduction = kReleaseMode,
    http.Client? client,
    String? baseUrl,
  }) : _useProduction = useProduction,
       _baseUrl =
           baseUrl ??
           (useProduction
               ? AppRuntimeConfig.serverBddProductionUrl
               : AppRuntimeConfig.serverBddDevelopmentUrl),
       _client = client ?? http.Client();

  final bool _useProduction;
  final String _baseUrl;
  final http.Client _client;

  bool get isConfigured => _endpoints.isNotEmpty;

  List<Uri> get _endpoints {
    final uri = Uri.tryParse(_baseUrl);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.scheme != 'https' && (_useProduction || uri.scheme != 'http'))) {
      return const [];
    }
    return [
      uri,
      if (!_useProduction && uri.host == '10.0.2.2')
        uri.replace(host: 'localhost'),
    ];
  }

  Future<Map<String, dynamic>> request(
    String accessToken,
    String path, {
    String method = 'GET',
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) async {
    for (final uri in _endpoints) {
      final endpoint = uri.replace(
        pathSegments: [
          ...uri.pathSegments.where((part) => part.isNotEmpty),
          'api',
          ...path.split('/').where((part) => part.isNotEmpty),
        ],
        queryParameters: query,
      );
      try {
        final request = http.Request(method, endpoint)
          ..followRedirects = false
          ..headers['Authorization'] = 'Bearer $accessToken';
        if (body != null) {
          request.headers['Content-Type'] = 'application/json';
          request.body = jsonEncode(body);
        }
        final response = await _client
            .send(request)
            .then(http.Response.fromStream)
            .timeout(const Duration(seconds: 12));
        final value = response.body.isEmpty ? null : _decode(response.body);
        if (response.statusCode == 401) {
          throw const SessionInvalidatedException(
            'Session invalide. Reconnecte-toi.',
          );
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          final message = value?['error'];
          throw AccountApiException(
            message is String ? message : 'Service temporairement indisponible',
            response.statusCode,
          );
        }
        return value ?? {};
      } on TimeoutException {
        continue;
      } on SocketException {
        continue;
      } on http.ClientException {
        continue;
      }
    }
    throw const BackendUnavailableException(
      'API du compte inaccessible ou adresse HTTPS à configurer.',
    );
  }

  static Map<String, dynamic>? _decode(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> syncUser(String accessToken, {String? username}) async {
    await request(
      accessToken,
      '/auth/sync',
      method: 'POST',
      body: {'username': ?username},
    );
  }

  Future<PlayerAccountProfile> getMyProfile(String accessToken) async {
    final result = await request(accessToken, '/users/me');
    return PlayerAccountProfile.fromJson(
      Map<String, dynamic>.from(result['user'] as Map),
    );
  }

  Future<PlayerAccountProfile> updateMyProfile(
    String accessToken, {
    String? username,
    String? displayName,
    String? avatarUrl,
    String? bio,
    String? region,
  }) async {
    final result = await request(
      accessToken,
      '/users/me',
      method: 'PATCH',
      body: {
        if (username != null && username.trim().isNotEmpty)
          'username': username,
        'display_name': ?displayName,
        'avatar_url': ?avatarUrl,
        'bio': ?bio,
        'region': ?region,
      },
    );
    return PlayerAccountProfile.fromJson(
      Map<String, dynamic>.from(result['user'] as Map),
    );
  }

  Future<void> logout(String accessToken) async {
    await request(accessToken, '/auth/logout', method: 'POST', body: {});
  }
}
