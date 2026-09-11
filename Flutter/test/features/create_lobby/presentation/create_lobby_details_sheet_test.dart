import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('does not offer manual objective hint-zone sizing', (tester) async {
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
    expect(find.text('Rayon zone départ (m)'), findsOneWidget);
  });
}
