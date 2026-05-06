import 'dart:convert';

import 'package:abstergo_chase/app/config/app_runtime_config.dart';
import 'package:amazon_cognito_identity_dart_2/cognito.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CognitoAuthSession {
  const CognitoAuthSession({
    required this.username,
    required this.idToken,
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAtEpochSeconds,
  });

  final String username;
  final String idToken;
  final String accessToken;
  final String refreshToken;
  final int expiresAtEpochSeconds;
}

class CognitoAuthService {
  static const _kUsername = 'auth.cognito.username';
  static const _kIdToken = 'auth.cognito.id_token';
  static const _kAccessToken = 'auth.cognito.access_token';
  static const _kRefreshToken = 'auth.cognito.refresh_token';
  static const _kExpiresAt = 'auth.cognito.expires_at';

  final FlutterAppAuth _appAuth = const FlutterAppAuth();

  bool get isConfigured =>
      AppRuntimeConfig.cognitoUserPoolId.isNotEmpty &&
      AppRuntimeConfig.cognitoClientId.isNotEmpty;
  bool get isHostedUiConfigured =>
      isConfigured && AppRuntimeConfig.cognitoDomain.isNotEmpty;

  Future<CognitoAuthSession?> restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final username = prefs.getString(_kUsername);
    final idToken = prefs.getString(_kIdToken);
    final accessToken = prefs.getString(_kAccessToken);
    final refreshToken = prefs.getString(_kRefreshToken);
    final expiresAt = prefs.getInt(_kExpiresAt);

    if (username == null ||
        idToken == null ||
        accessToken == null ||
        refreshToken == null ||
        expiresAt == null) {
      return null;
    }
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (expiresAt <= nowSeconds + 30) {
      await clearSession();
      return null;
    }
    return CognitoAuthSession(
      username: username,
      idToken: idToken,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAtEpochSeconds: expiresAt,
    );
  }

  Future<CognitoAuthSession> signIn({
    required String username,
    required String password,
  }) async {
    if (!isConfigured) {
      throw Exception(
        'Cognito non configuré. Définissez COGNITO_USER_POOL_ID et COGNITO_CLIENT_ID.',
      );
    }
    final userPool = CognitoUserPool(
      AppRuntimeConfig.cognitoUserPoolId,
      AppRuntimeConfig.cognitoClientId,
    );
    final user = CognitoUser(username.trim(), userPool);
    final auth = AuthenticationDetails(
      username: username.trim(),
      password: password,
    );
    final session = await user.authenticateUser(auth);
    if (session == null) {
      throw Exception('Session Cognito invalide.');
    }
    final idToken = session.idToken.jwtToken;
    final accessToken = session.accessToken.jwtToken;
    final refreshToken = session.refreshToken?.token ?? '';
    if (idToken == null || accessToken == null) {
      throw Exception('Tokens Cognito manquants.');
    }
    final expiresAt = _extractExpiryEpochSeconds(accessToken);
    final authSession = CognitoAuthSession(
      username: username.trim(),
      idToken: idToken,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAtEpochSeconds: expiresAt,
    );
    await _saveSession(authSession);
    return authSession;
  }

  Future<CognitoAuthSession> signInWithGoogle() async {
    if (!isHostedUiConfigured) {
      throw Exception(
        'Hosted UI Cognito non configuré. Définissez COGNITO_DOMAIN.',
      );
    }

    final normalizedDomain = AppRuntimeConfig.cognitoDomain.endsWith('/')
        ? AppRuntimeConfig.cognitoDomain.substring(
            0,
            AppRuntimeConfig.cognitoDomain.length - 1,
          )
        : AppRuntimeConfig.cognitoDomain;

    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        AppRuntimeConfig.cognitoClientId,
        AppRuntimeConfig.cognitoRedirectUri,
        issuer:
            'https://cognito-idp.${AppRuntimeConfig.cognitoRegion}.amazonaws.com/'
            '${AppRuntimeConfig.cognitoUserPoolId}',
        scopes: const ['openid', 'email', 'profile'],
        additionalParameters: const {'identity_provider': 'Google'},
        serviceConfiguration: AuthorizationServiceConfiguration(
          authorizationEndpoint: '$normalizedDomain/oauth2/authorize',
          tokenEndpoint: '$normalizedDomain/oauth2/token',
          endSessionEndpoint: '$normalizedDomain/logout',
        ),
      ),
    );

    if (result.idToken == null || result.accessToken == null) {
      throw Exception('Echec de la connexion Google via Cognito.');
    }
    final expiry = result.accessTokenExpirationDateTime;
    if (expiry == null) {
      throw Exception('Echec de la connexion Google via Cognito.');
    }

    final username = _extractUsernameFromIdToken(result.idToken!) ?? 'google';
    final session = CognitoAuthSession(
      username: username,
      idToken: result.idToken!,
      accessToken: result.accessToken!,
      refreshToken: result.refreshToken ?? '',
      expiresAtEpochSeconds: expiry.millisecondsSinceEpoch ~/ 1000,
    );
    await _saveSession(session);
    return session;
  }

  Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kUsername);
    await prefs.remove(_kIdToken);
    await prefs.remove(_kAccessToken);
    await prefs.remove(_kRefreshToken);
    await prefs.remove(_kExpiresAt);
  }

  Future<String?> getAccessToken() async {
    final session = await restoreSession();
    return session?.accessToken;
  }

  Future<String?> getCurrentUserSub() async {
    final session = await restoreSession();
    if (session == null) return null;
    return _extractSubjectFromIdToken(session.idToken);
  }

  Future<void> _saveSession(CognitoAuthSession session) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUsername, session.username);
    await prefs.setString(_kIdToken, session.idToken);
    await prefs.setString(_kAccessToken, session.accessToken);
    await prefs.setString(_kRefreshToken, session.refreshToken);
    await prefs.setInt(_kExpiresAt, session.expiresAtEpochSeconds);
  }

  int _extractExpiryEpochSeconds(String jwt) {
    final parts = jwt.split('.');
    if (parts.length < 2) {
      throw Exception('Token Cognito invalide.');
    }
    final payload = parts[1];
    final normalized = base64Url.normalize(payload);
    final decoded = utf8.decode(base64Url.decode(normalized));
    final json = jsonDecode(decoded);
    if (json is! Map || json['exp'] == null) {
      throw Exception('Token Cognito sans expiration.');
    }
    return int.tryParse(json['exp'].toString()) ?? 0;
  }

  String? _extractUsernameFromIdToken(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length < 2) {
        return null;
      }
      final payload = parts[1];
      final normalized = base64Url.normalize(payload);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final json = jsonDecode(decoded);
      if (json is! Map) {
        return null;
      }
      final email = json['email']?.toString().trim();
      if (email != null && email.isNotEmpty) {
        return email;
      }
      final preferredUsername = json['preferred_username']?.toString().trim();
      if (preferredUsername != null && preferredUsername.isNotEmpty) {
        return preferredUsername;
      }
      final subject = json['sub']?.toString().trim();
      if (subject != null && subject.isNotEmpty) {
        return subject;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  String? _extractSubjectFromIdToken(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length < 2) return null;
      final payload = parts[1];
      final normalized = base64Url.normalize(payload);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final json = jsonDecode(decoded);
      if (json is! Map) return null;
      final subject = json['sub']?.toString().trim();
      if (subject == null || subject.isEmpty) return null;
      return subject;
    } catch (_) {
      return null;
    }
  }
}
