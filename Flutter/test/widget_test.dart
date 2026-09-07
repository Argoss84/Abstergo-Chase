import 'package:broken_veil_protocol/app/app.dart';
import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

class _AlwaysGrantedPermissionsService implements BootstrapPermissionsService {
  @override
  Future<BootstrapPermissionsResult> ensureRequiredPermissions({bool forceRequest = false}) async {
    return const BootstrapPermissionsResult(BootstrapPermissionsStatus.granted);
  }

  @override
  Future<void> openAppSettings() async {}
}

void main() {
  testWidgets('BrokenVeilProtocolApp boots with router wiring', (
    WidgetTester tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/',
      routes: <RouteBase>[
        GoRoute(
          path: '/',
          builder: (context, state) => BootstrapPage(
            permissionsService: _AlwaysGrantedPermissionsService(),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRouterProvider.overrideWithValue(router),
        ],
        child: const BrokenVeilProtocolApp(),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Créer une partie'), findsOneWidget);
    expect(find.text('Rejoindre une partie'), findsOneWidget);
  });

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
