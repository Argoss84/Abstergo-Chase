import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> openSheet(
  WidgetTester tester, {
  required CreateLobbyFormData initial,
  required ValueChanged<CreateLobbyDetailsResult?> onClose,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () async => onClose(
                await showModalBottomSheet<CreateLobbyDetailsResult>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => CreateLobbyDetailsSheet(initialData: initial),
                ),
              ),
              child: const Text('Ouvrir'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Ouvrir'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('applying untouched settings preserves every stored value', (
    tester,
  ) async {
    final initial = CreateLobbyFormData.initial().copyWith(
      duration: 1871,
      hackDurationMs: 1251,
      objectiveNumber: 4,
      victoryConditionObjectives: 2,
      mapRadius: 240,
      startZoneRadius: 33,
      agentRange: 83,
      rogueRange: 14,
      objectiveZoneRadius: 17,
      mapCenterLatitude: '45.764',
      mapCenterLongitude: '4.835',
    );
    CreateLobbyDetailsResult? result;
    await openSheet(
      tester,
      initial: initial,
      onClose: (value) => result = value,
    );
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(result?.form, same(initial));
  });

  for (final entry in {'1,25': 1250, '1.251': 1251, '0,001': 1}.entries) {
    testWidgets(
      'hack duration ${entry.key} seconds is stored as ${entry.value} ms',
      (tester) async {
        CreateLobbyDetailsResult? result;
        await openSheet(
          tester,
          initial: CreateLobbyFormData.initial(),
          onClose: (value) => result = value,
        );
        await tester.ensureVisible(find.text('Rôles et capture'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Rôles et capture'));
        await tester.pumpAndSettle();
        final field = find.widgetWithText(TextFormField, 'Durée du hack');
        await tester.ensureVisible(field);
        await tester.pumpAndSettle();
        await tester.enterText(field, entry.key);
        await tester.tap(find.text('Appliquer'));
        await tester.pumpAndSettle();
        expect(result?.form.hackDurationMs, entry.value);
      },
    );
  }

  testWidgets('invalid hidden role settings reopen and reveal their error', (
    tester,
  ) async {
    CreateLobbyDetailsResult? result;
    await openSheet(
      tester,
      initial: CreateLobbyFormData.initial().copyWith(agentRange: 0),
      onClose: (value) => result = value,
    );
    expect(find.text('Portée Agent'), findsNothing);
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('Portée Agent'), findsOneWidget);
    expect(
      find.text('Saisissez un nombre supérieur à zéro.').hitTestable(),
      findsOneWidget,
    );
  });

  testWidgets('zero duration cannot be silently changed and applied', (
    tester,
  ) async {
    CreateLobbyDetailsResult? result;
    await openSheet(
      tester,
      initial: CreateLobbyFormData.initial().copyWith(duration: 0),
      onClose: (value) => result = value,
    );
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('La durée doit être supérieure à zéro.'), findsOneWidget);
  });

  testWidgets(
    'blocks invalid numbers even when their fields are scrolled away',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CreateLobbyDetailsSheet(
              initialData: CreateLobbyFormData.initial(),
            ),
          ),
        ),
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, "Nombre d'objectifs"),
        '0',
      );
      await tester.ensureVisible(find.text('Appliquer'));
      await tester.tap(find.text('Appliquer'));
      await tester.pumpAndSettle();
      expect(
        find.text('Saisissez un nombre supérieur à zéro.'),
        findsOneWidget,
      );
      expect(find.byType(CreateLobbyDetailsSheet), findsOneWidget);
    },
  );

  testWidgets('does not offer manual objective hint-zone sizing', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CreateLobbyDetailsSheet(
            initialData: CreateLobbyFormData.initial(),
          ),
        ),
      ),
    );

    expect(find.text('Rayon zone objectifs'), findsNothing);
    await tester.ensureVisible(find.text('Terrain et distances'));
    await tester.tap(find.text('Terrain et distances'));
    await tester.pumpAndSettle();
    expect(find.text('Rayon de départ'), findsOneWidget);
  });
}
