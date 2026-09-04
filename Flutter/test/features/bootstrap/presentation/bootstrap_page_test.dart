import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeBootstrapPermissionsService implements BootstrapPermissionsService {
  _FakeBootstrapPermissionsService(this._results);

  final List<BootstrapPermissionsResult> _results;
  int calls = 0;
  int openSettingsCalls = 0;
  final List<bool> forceRequestValues = <bool>[];

  @override
  Future<BootstrapPermissionsResult> ensureRequiredPermissions({
    bool forceRequest = false,
  }) async {
    forceRequestValues.add(forceRequest);
    final index = calls;
    calls += 1;
    if (index < _results.length) {
      return _results[index];
    }
    return _results.last;
  }

  @override
  Future<void> openAppSettings() async {
    openSettingsCalls += 1;
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
      final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
        const BootstrapPermissionsResult(BootstrapPermissionsStatus.denied),
      ]);

      await tester.pumpWidget(_app(permissionsService));
      await tester.pumpAndSettle();

      final createTile = tester.widget<ListTile>(
        find.widgetWithText(ListTile, 'Créer une partie'),
      );
      final joinTile = tester.widget<ListTile>(
        find.widgetWithText(ListTile, 'Rejoindre une partie'),
      );

      expect(permissionsService.calls, 1);
      expect(permissionsService.forceRequestValues, <bool>[true]);
      expect(createTile.onTap, isNull);
      expect(joinTile.onTap, isNull);
      expect(find.text('Autorisations requises'), findsOneWidget);
    },
  );

  testWidgets('Enables create/join when required permissions are granted', (
    tester,
  ) async {
    final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.granted),
    ]);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    final createTile = tester.widget<ListTile>(
      find.widgetWithText(ListTile, 'Créer une partie'),
    );
    final joinTile = tester.widget<ListTile>(
      find.widgetWithText(ListTile, 'Rejoindre une partie'),
    );

    expect(permissionsService.calls, 1);
    expect(permissionsService.forceRequestValues, <bool>[true]);
    expect(createTile.onTap, isNotNull);
    expect(joinTile.onTap, isNotNull);
    expect(find.text('Autorisations requises'), findsNothing);
  });

  testWidgets('Uses settings action when permissions are denied forever', (
    tester,
  ) async {
    final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.deniedForever),
    ]);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    expect(find.text('Réglages'), findsOneWidget);
    await tester.tap(find.text('Réglages'));
    await tester.pumpAndSettle();

    expect(permissionsService.openSettingsCalls, 1);
    expect(permissionsService.forceRequestValues, <bool>[true]);
  });

  testWidgets('Uses settings action when permissions are denied', (
    tester,
  ) async {
    final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.denied),
    ]);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    expect(find.text('Réglages'), findsOneWidget);
    await tester.tap(find.text('Réglages'));
    await tester.pumpAndSettle();

    expect(permissionsService.openSettingsCalls, 1);
    expect(permissionsService.forceRequestValues, <bool>[true]);
  });

  testWidgets('Uses settings action when check fails', (tester) async {
    final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.error),
    ]);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    expect(find.text('Erreur de vérification'), findsOneWidget);
    expect(
      find.text(
        'Impossible de vérifier les autorisations. Ouvrez les réglages de l’application.',
      ),
      findsOneWidget,
    );
    expect(find.text('Réglages'), findsOneWidget);
    await tester.tap(find.text('Réglages'));
    await tester.pumpAndSettle();

    expect(permissionsService.openSettingsCalls, 1);
    expect(permissionsService.forceRequestValues, <bool>[true]);
  });

  testWidgets('Rechecks permissions on app resume after settings return', (
    tester,
  ) async {
    final permissionsService = _FakeBootstrapPermissionsService(<BootstrapPermissionsResult>[
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.denied),
      const BootstrapPermissionsResult(BootstrapPermissionsStatus.granted),
    ]);

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    expect(find.text('Autorisations requises'), findsOneWidget);
    expect(
      tester
          .widget<ListTile>(find.widgetWithText(ListTile, 'Créer une partie'))
          .onTap,
      isNull,
    );

    await tester.tap(find.text('Réglages'));
    await tester.pumpAndSettle();

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(permissionsService.calls, 2);
    expect(permissionsService.forceRequestValues, <bool>[true, false]);
    expect(find.text('Autorisations requises'), findsNothing);
    expect(
      tester
          .widget<ListTile>(find.widgetWithText(ListTile, 'Créer une partie'))
          .onTap,
      isNotNull,
    );
    expect(
      tester
          .widget<ListTile>(
            find.widgetWithText(ListTile, 'Rejoindre une partie'),
          )
          .onTap,
      isNotNull,
    );
  });

  testWidgets('Does not recheck on resume before opening settings', (tester) async {
    final permissionsService = _FakeBootstrapPermissionsService(
      <BootstrapPermissionsResult>[
        const BootstrapPermissionsResult(BootstrapPermissionsStatus.denied),
      ],
    );

    await tester.pumpWidget(_app(permissionsService));
    await tester.pumpAndSettle();

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(permissionsService.calls, 1);
    expect(permissionsService.forceRequestValues, <bool>[true]);
    expect(find.text('Autorisations requises'), findsOneWidget);
    expect(
      tester
          .widget<ListTile>(find.widgetWithText(ListTile, 'Créer une partie'))
          .onTap,
      isNull,
    );
  });
}
