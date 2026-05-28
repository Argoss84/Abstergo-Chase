import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/data/cognito_auth_service.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';

class CognitoAuthController extends ChangeNotifier {
  CognitoAuthController({CognitoAuthService? authService})
    : _authService = authService ?? CognitoAuthService();

  final CognitoAuthService _authService;
  final AccountApiService _accountApiService = AccountApiService();
  Timer? _sessionGuardTimer;

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
      this.username = session.username;
      isAuthenticated = true;
      _startSessionGuard();
      unawaited(
        _syncUserBestEffort(
          accessToken: session.accessToken,
          username: session.username,
        ).catchError(_handleBackgroundSyncError),
      );
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
    final token = await _authService.getAccessToken();
    await _authService.clearSession();
    isAuthenticated = false;
    username = null;
    error = null;
    _stopSessionGuard();
    notifyListeners();

    if (token == null || token.isEmpty) {
      return;
    }
    try {
      unawaited(_accountApiService.logout(token));
    } catch (_) {
      // Logout API is best-effort and must not block UI navigation.
    }
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
      username = session.username;
      isAuthenticated = true;
      _startSessionGuard();
      unawaited(
        _syncUserBestEffort(
          accessToken: session.accessToken,
          username: session.username,
        ).catchError(_handleBackgroundSyncError),
      );
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

  Future<String?> getCurrentUserSub() {
    return _authService.getCurrentUserSub();
  }

  Future<void> _syncUserBestEffort({
    required String accessToken,
    required String username,
  }) async {
    try {
      await _accountApiService.syncUser(accessToken, username: username);
    } on BackendUnavailableException {
      // Allow Cognito login when ServerBDD is temporarily unreachable.
      return;
    } catch (_) {
      // Do not reject Cognito authentication on backend sync errors.
      return;
    }
  }

  void _startSessionGuard() {
    // Session guard volontairement désactivé: on ne force plus de déconnexion
    // automatique en arrière-plan (multi-appareils / réponse backend).
    _sessionGuardTimer?.cancel();
    _sessionGuardTimer = null;
  }

  void _stopSessionGuard() {
    _sessionGuardTimer?.cancel();
    _sessionGuardTimer = null;
  }

  Future<void> _handleBackgroundSyncError(Object error) async {
    if (error is SessionInvalidatedException) {
      await handleSessionInvalidated(error.message);
    }
  }
}
