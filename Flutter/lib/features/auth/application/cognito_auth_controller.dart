import 'package:abstergo_chase/features/auth/data/cognito_auth_service.dart';
import 'package:flutter/foundation.dart';

class CognitoAuthController extends ChangeNotifier {
  CognitoAuthController({CognitoAuthService? authService})
    : _authService = authService ?? CognitoAuthService();

  final CognitoAuthService _authService;

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
      } else {
        isAuthenticated = false;
        username = null;
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
      return true;
    } catch (e) {
      error = e.toString();
      isAuthenticated = false;
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    await _authService.clearSession();
    isAuthenticated = false;
    username = null;
    error = null;
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
      return true;
    } catch (e) {
      error = e.toString();
      isAuthenticated = false;
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }
}
