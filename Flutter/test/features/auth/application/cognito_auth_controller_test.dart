import 'dart:async';

import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/auth/data/cognito_auth_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _Auth extends CognitoAuthService {
  final restored = Completer<CognitoAuthSession?>();
  final signedIn = Completer<CognitoAuthSession>();
  int signInCalls = 0;
  bool cleared = false;

  @override
  Future<CognitoAuthSession?> restoreSession() => restored.future;

  @override
  Future<CognitoAuthSession> signIn({
    required String username,
    required String password,
  }) {
    signInCalls++;
    return signedIn.future;
  }

  @override
  Future<String?> getAccessToken() async => 'test-token';

  @override
  Future<void> clearSession() async {
    cleared = true;
  }
}

class _FailingAccountApi extends AccountApiService {
  int logoutCalls = 0;

  @override
  Future<void> syncUser(String accessToken, {String? username}) async {}

  @override
  Future<void> logout(String accessToken) async {
    logoutCalls++;
    throw StateError('offline');
  }
}

void main() {
  const session = CognitoAuthSession(
    username: 'Agent',
    idToken: 'test-id',
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAtEpochSeconds: 2000000000,
  );

  test(
    'restoring a session after disposal cannot notify or authenticate',
    () async {
      final auth = _Auth();
      final controller = CognitoAuthController(authService: auth);
      var notifications = 0;
      controller.addListener(() => notifications++);
      final pending = controller.initialize();
      controller.dispose();
      auth.restored.complete(session);
      await expectLater(pending, completes);
      expect(controller.isAuthenticated, isFalse);
      expect(notifications, 1);
    },
  );

  test('a pending sign-in cannot authenticate a disposed controller', () async {
    final auth = _Auth();
    final controller = CognitoAuthController(authService: auth);
    final pending = controller.signIn(
      username: 'Agent',
      password: 'test-password',
    );
    controller.dispose();
    auth.signedIn.complete(session);
    expect(await pending, isFalse);
    expect(controller.isAuthenticated, isFalse);
  });

  test('duplicate sign-ins cannot start concurrent authentication', () async {
    final auth = _Auth();
    final controller = CognitoAuthController(
      authService: auth,
      accountApiService: _FailingAccountApi(),
    );
    addTearDown(controller.dispose);
    final pending = controller.signIn(
      username: 'Agent',
      password: 'test-password',
    );
    expect(
      await controller.signIn(username: 'Other', password: 'test-password'),
      isFalse,
    );
    expect(auth.signInCalls, 1);
    auth.signedIn.complete(session);
    expect(await pending, isTrue);
    expect(controller.username, 'Agent');
  });

  test(
    'a background logout failure does not surface as an unhandled error',
    () async {
      final auth = _Auth();
      final api = _FailingAccountApi();
      final controller = CognitoAuthController(
        authService: auth,
        accountApiService: api,
      )..isAuthenticated = true;
      addTearDown(controller.dispose);
      await controller.signOut();
      await Future<void>.delayed(Duration.zero);
      expect(auth.cleared, isTrue);
      expect(controller.isAuthenticated, isFalse);
      expect(api.logoutCalls, 1);
    },
  );
}
