import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/application/play_billing.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/account/presentation/player_platform_page.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FriendsApi extends AccountApiService {
  bool requested = false;
  int friendLoads = 0;
  String? searchQuery;

  @override
  Future<Map<String, dynamic>> request(
    String accessToken,
    String path, {
    String method = 'GET',
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) async {
    if (path == '/social/friends/request') {
      expect(method, 'POST');
      expect(body, {'public_id': 'public-ally'});
      requested = true;
      return {};
    }
    if (path == '/social/friends') {
      friendLoads++;
      return {
        'friends': [
          if (requested)
            {
              'friendship_id': 1,
              'public_id': 'public-ally',
              'display_name': 'Ally',
              'status': 'pending',
              'incoming': false,
            },
        ],
      };
    }
    if (path == '/social/search') searchQuery = query?['q'];
    return {
      'players': [
        {'public_id': 'public-ally', 'display_name': 'Ally'},
      ],
    };
  }
}

class _Auth extends CognitoAuthController {
  _Auth(AccountApiService api) : super(accountApiService: api);

  @override
  Future<String?> getAccessToken() async => 'test-token';
}

class _NoPurchases extends PlayBilling {
  _NoPurchases(super.auth);

  @override
  bool get supportsPurchases => false;
}

void main() {
  testWidgets(
    'requesting a friend refreshes the list and search without a setState error',
    (tester) async {
      final api = _FriendsApi();
      final auth = _Auth(api);
      final billing = _NoPurchases(auth);
      addTearDown(billing.dispose);
      addTearDown(auth.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWithValue(auth),
            playBillingProvider.overrideWithValue(billing),
          ],
          child: const MaterialApp(
            home: PlayerPlatformPage(section: 'friends'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Demander en ami'));
      await tester.pumpAndSettle();
      expect(api.requested, isTrue);
      expect(find.text('En attente'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect(tester.takeException(), isNull);

      await tester.tap(find.byTooltip('Actualiser'));
      await tester.pumpAndSettle();
      expect(api.friendLoads, 3);
      expect(tester.takeException(), isNull);

      await tester.enterText(find.byType(TextField), 'Ally');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(api.searchQuery, 'Ally');
      expect(find.text('Résultats'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
