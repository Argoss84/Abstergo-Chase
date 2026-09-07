import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/auth/data/cognito_auth_service.dart';
import 'package:broken_veil_protocol/features/auth/presentation/login_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeCognitoAuthService extends CognitoAuthService {
  _FakeCognitoAuthService({this.signInError});

  final Object? signInError;

  @override
  bool get isConfigured => true;

  @override
  Future<CognitoAuthSession?> restoreSession() async => null;

  @override
  Future<CognitoAuthSession> signIn({
    required String username,
    required String password,
  }) async {
    if (signInError != null) {
      throw signInError!;
    }
    throw UnimplementedError();
  }
}

void main() {
  Widget _app(CognitoAuthController controller) {
    return ProviderScope(
      overrides: <Override>[
        authControllerProvider.overrideWithValue(controller),
      ],
      child: const MaterialApp(home: LoginPage()),
    );
  }

  testWidgets(
    'Shows a dismissible dialog for Cognito credential errors',
    (tester) async {
      final controller = CognitoAuthController(
        authService: _FakeCognitoAuthService(
          signInError: Exception(
            'NotAuthorizedException(Incorrect username or password.)',
          ),
        ),
      )..isInitializing = false;

      await tester.pumpWidget(_app(controller));

      await tester.enterText(find.byType(TextField).first, 'agent47');
      await tester.enterText(find.byType(TextField).last, 'bad-password');
      await tester.tap(find.text('Se connecter'));
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.text('Échec de connexion'), findsOneWidget);
      expect(
        find.text(
          'Le nom d’utilisateur ou le mot de passe est incorrect. Vérifiez vos identifiants Cognito puis réessayez.',
        ),
        findsOneWidget,
      );
      expect(find.text('Fermer'), findsWidgets);

      await tester.tap(find.widgetWithText(TextButton, 'Fermer'));
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'Keeps generic sign-in errors as snackbars',
    (tester) async {
      final controller = CognitoAuthController(
        authService: _FakeCognitoAuthService(
          signInError: Exception('Service temporairement indisponible.'),
        ),
      )..isInitializing = false;

      await tester.pumpWidget(_app(controller));

      await tester.enterText(find.byType(TextField).first, 'agent47');
      await tester.enterText(find.byType(TextField).last, 'password');
      await tester.tap(find.text('Se connecter'));
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
      expect(
        find.text('Exception: Service temporairement indisponible.'),
        findsOneWidget,
      );
    },
  );
}
