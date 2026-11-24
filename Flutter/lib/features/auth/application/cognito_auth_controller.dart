import 'dart:async';

import 'package:broken_veil_protocol/features/account/application/account_settings_sync.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/data/cognito_auth_service.dart';
import 'package:flutter/foundation.dart';

class CognitoAuthController extends ChangeNotifier {
  CognitoAuthController({
    CognitoAuthService? authService,
    AccountApiService? accountApiService,
  }) : _authService = authService ?? CognitoAuthService(),
       accountApi = accountApiService ?? AccountApiService();

  final CognitoAuthService _authService;
  final AccountApiService accountApi;
  Timer? _guard;
  bool _guardInFlight = false;
  bool _disposed = false;

  bool isInitializing = true;
  bool isAuthenticated = false;
  bool isSubmitting = false;
  String? username;
  String? error;

  bool get isConfigured => _authService.isConfigured;
  bool get isHostedUiConfigured => _authService.isHostedUiConfigured;

  Future<void> initialize() async {
    if (_disposed) return;
    isInitializing = true;
    notifyListeners();
    try {
      final restored = await _authService.restoreSession();
      if (restored != null && !_disposed) {
        await _activate(restored, fresh: false);
      }
    } on SessionInvalidatedException catch (failure) {
      await handleSessionInvalidated(failure.message);
    } catch (failure) {
      error = failure.toString();
    } finally {
      isInitializing = false;
      notifyListeners();
    }
  }

  Future<bool> signIn({required String username, required String password}) =>
      _signIn(
        () => _authService.signIn(username: username, password: password),
      );

  Future<bool> signInWithGoogle() => _signIn(_authService.signInWithGoogle);

  Future<bool> _signIn(
    Future<CognitoAuthSession> Function() authenticate,
  ) async {
    if (_disposed || isSubmitting) return false;
    isSubmitting = true;
    error = null;
    notifyListeners();
    try {
      final session = await authenticate();
      if (_disposed) return false;
      await _activate(session, fresh: true);
      return isAuthenticated;
    } catch (failure) {
      error = failure.toString();
      isAuthenticated = false;
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  Future<void> _activate(
    CognitoAuthSession session, {
    required bool fresh,
  }) async {
    PlayerAccountProfile? profile;
    try {
      if (fresh) {
        await accountApi.syncUser(
          session.accessToken,
          username: session.username,
        );
      }
      profile = await accountApi.getMyProfile(session.accessToken);
    } on BackendUnavailableException {
      if (kReleaseMode) rethrow;
    }
    if (_disposed) return;
    username = session.username;
    if (profile != null) {
      await AccountSettingsSync.instance
          .bind(profile.id, accountApi, getAccessToken)
          .catchError((Object _) {});
      if (_disposed) return;
    }
    isAuthenticated = true;
    _guard?.cancel();
    _guard = Timer.periodic(
      const Duration(seconds: 25),
      (_) => unawaited(_checkSession()),
    );
  }

  Future<void> _checkSession() async {
    if (_guardInFlight || _disposed || !isAuthenticated) return;
    _guardInFlight = true;
    try {
      final token = await getAccessToken();
      if (token == null || token.isEmpty) {
        await handleSessionInvalidated('Session expirée. Reconnecte-toi.');
        return;
      }
      await accountApi.getMyProfile(token);
      await AccountSettingsSync.instance.flush();
    } on SessionInvalidatedException catch (failure) {
      await handleSessionInvalidated(failure.message);
    } catch (_) {
      // A temporary outage leaves existing local preferences available.
    } finally {
      _guardInFlight = false;
    }
  }

  Future<String?> getAccessToken() => _authService.getAccessToken();

  Future<String?> getCurrentUserSub() => _authService.getCurrentUserSub();

  Future<String?> signalingTicket() async {
    if (!isAuthenticated) return null;
    final token = await getAccessToken();
    if (token == null) return null;
    try {
      final response = await accountApi.request(
        token,
        '/auth/signaling-ticket',
        method: 'POST',
        body: {},
      );
      return response['ticket'] as String?;
    } on SessionInvalidatedException catch (failure) {
      await handleSessionInvalidated(failure.message);
      return null;
    }
  }

  Future<void> signOut() async {
    if (_disposed) return;
    final token = await getAccessToken();
    await _clearState();
    if (token != null && token.isNotEmpty) {
      unawaited(accountApi.logout(token).catchError((Object _) {}));
    }
  }

  Future<void> deleteAccount() async {
    final token = await getAccessToken();
    if (token == null) {
      throw const SessionInvalidatedException('Session expirée.');
    }
    await accountApi.request(token, '/users/me', method: 'DELETE');
    await _clearState();
  }

  Future<void> handleSessionInvalidated(String message) => _clearState(message);

  Future<void> _clearState([String? message]) async {
    _guard?.cancel();
    _guard = null;
    AccountSettingsSync.instance.unbind();
    await _authService.clearSession();
    if (_disposed) return;
    isAuthenticated = false;
    username = null;
    error = message;
    notifyListeners();
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _guard?.cancel();
    AccountSettingsSync.instance.unbind();
    super.dispose();
  }
}
