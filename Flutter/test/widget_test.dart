import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _AlwaysGrantedPermissionsService implements BootstrapPermissionsService {
  @override
  Future<bool> ensureRequiredPermissions() async => true;
}

void main() {
  testWidgets('Home actions are displayed', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: BootstrapPage(
            permissionsService: _AlwaysGrantedPermissionsService(),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Créer une partie'), findsOneWidget);
    expect(find.text('Rejoindre une partie'), findsOneWidget);
  });
}
