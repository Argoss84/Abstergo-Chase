import 'package:abstergo_chase/features/account/data/account_api_service.dart';
import 'package:abstergo_chase/features/auth/data/cognito_auth_service.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';

class CognitoAuthController extends ChangeNotifier {
  CognitoAuthController({CognitoAuthService? authService})
    : _authService = authService ?? CognitoAuthService();

  final CognitoAuthService _authService;
  final AccountApiService _accountApiService = AccountApiService();
  Timer? _sessionGuardTimer;
  bool _sessionGuardInFlight = false;

  bool isInitializing = true;
  bool isAuthenticated = false;
  bool isSubmitting = false;
  String? username;
  String? error;

  bool get isConfigured => _authService.isConfigured;
  bool get isHostedUiConfigured => _authService.isHostedUiConfigured;

  Future<void> initialize() async {
    isInitializing = true;
    error = null;
    notifyListeners();
    try {
      final session = await _authService.restoreSession();
      if (session != null) {
        isAuthenticated = true;
        username = session.username;
        _startSessionGuard();
      } else {
        isAuthenticated = false;
        username = null;
        _stopSessionGuard();
      }
    } catch (e) {
      isAuthenticated = false;
      username = null;
      error = e.toString();
    } finally {
      isInitializing = false;
      notifyListeners();
    }
  }

  Future<bool> signIn({
    required String username,
    required String password,
  }) async {
    isSubmitting = true;
    error = null;
    notifyListeners();
    try {
      final session = await _authService.signIn(
        username: username,
        password: password,
      );
      await _enforceSingleDevicePolicy(
        accessToken: session.accessToken,
        username: session.username,
      );
      this.username = session.username;
      isAuthenticated = true;
      _startSessionGuard();
      return true;
    } catch (e) {
      error = e.toString();
      isAuthenticated = false;
      _stopSessionGuard();
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    try {
      final token = await _authService.getAccessToken();
      if (token != null && token.isNotEmpty) {
        await _accountApiService.logout(token);
      }
    } catch (_) {
      // Keep logout resilient: always clear local session.
    }
    await _authService.clearSession();
    isAuthenticated = false;
    username = null;
    error = null;
    _stopSessionGuard();
    notifyListeners();
  }

  Future<void> handleSessionInvalidated(String message) async {
    await _authService.clearSession();
    isAuthenticated = false;
    username = null;
    error = message;
    _stopSessionGuard();
    notifyListeners();
  }

  Future<bool> signInWithGoogle() async {
    isSubmitting = true;
    error = null;
    notifyListeners();
    try {
      final session = await _authService.signInWithGoogle();
      await _enforceSingleDevicePolicy(
        accessToken: session.accessToken,
        username: session.username,
      );
      username = session.username;
      isAuthenticated = true;
      _startSessionGuard();
      return true;
    } catch (e) {
      error = e.toString();
      isAuthenticated = false;
      _stopSessionGuard();
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  Future<String?> getAccessToken() {
    return _authService.getAccessToken();
  }

  Future<void> _enforceSingleDevicePolicy({
    required String accessToken,
    required String username,
  }) async {
    try {
      await _accountApiService.syncUser(accessToken, username: username);
    } catch (error) {
      await _authService.clearSession();
      final message = error.toString();
      if (message.contains('Compte déjà connecté sur un autre appareil')) {
        throw Exception(
          'Compte déjà connecté sur un autre appareil, veuillez le déconnecter pour l\'utiliser ici',
        );
      }
      throw Exception('Connexion refusée: $message');
    }
  }

  void _startSessionGuard() {
    _sessionGuardTimer?.cancel();
    _sessionGuardTimer = Timer.periodic(const Duration(seconds: 8), (_) async {
      if (!isAuthenticated || _sessionGuardInFlight) {
        return;
      }
      _sessionGuardInFlight = true;
      try {
        final token = await _authService.getAccessToken();
        if (token == null || token.isEmpty) {
          await handleSessionInvalidated('Session expirée, reconnectez-vous.');
          return;
        }
        await _accountApiService.getMyProfile(token);
      } catch (error) {
        if (error is SessionInvalidatedException) {
          await handleSessionInvalidated(error.message);
        }
      } finally {
        _sessionGuardInFlight = false;
      }
    });
  }

  void _stopSessionGuard() {
    _sessionGuardTimer?.cancel();
    _sessionGuardTimer = null;
  }
}
