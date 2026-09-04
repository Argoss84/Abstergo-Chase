import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeBootstrapPermissionsService implements BootstrapPermissionsService {
  _FakeBootstrapPermissionsService(this._result);

  final bool _result;
  int calls = 0;

  @override
  Future<bool> ensureRequiredPermissions() async {
    calls += 1;
    return _result;
  }
}

void main() {
  Widget _app(BootstrapPermissionsService permissionsService) {
    return ProviderScope(
      child: MaterialApp(
        home: BootstrapPage(permissionsService: permissionsService),
      ),
    );
  }

  testWidgets(
    'Disables create/join when required permissions are not granted',
    (tester) async {
      final permissionsService = _FakeBootstrapPermissionsService(false);

      await tester.pumpWidget(_app(permissionsService));
      await tester.pumpAndSettle();

      final createTile = tester.widget<ListTile>(
        find.widgetWithText(ListTile, 'Créer une partie'),
      );
      final joinTile = tester.widget<ListTile>(
        find.widgetWithText(ListTile, 'Rejoindre une partie'),
      );

      expect(permissionsService.calls, 1);
      expect(createTile.onTap, isNull);
      expect(joinTile.onTap, isNull);
      expect(find.text('Autorisations requises'), findsOneWidget);
    },
  );

  testWidgets('Enables create/join when required permissions are granted', (
    tester,
  ) async {
    final permissionsService = _FakeBootstrapPermissionsService(true);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    final createTile = tester.widget<ListTile>(
      find.widgetWithText(ListTile, 'Créer une partie'),
    );
    final joinTile = tester.widget<ListTile>(
      find.widgetWithText(ListTile, 'Rejoindre une partie'),
    );

    expect(permissionsService.calls, 1);
    expect(createTile.onTap, isNotNull);
    expect(joinTile.onTap, isNotNull);
    expect(find.text('Autorisations requises'), findsNothing);
  });
}
