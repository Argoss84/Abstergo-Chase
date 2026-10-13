import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_player_row.dart';
import 'package:broken_veil_protocol/shared/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _player = LobbyPlayer(
  id: 'player-1',
  name: 'momo',
  isHost: true,
  role: 'AGENT',
);

void main() {
  testWidgets('Host can assign and clear a player role', (tester) async {
    final changes = <String?>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 340,
              child: LobbyPlayerRow(
                player: _player,
                isSelf: true,
                voiceActive: false,
                onRoleChanged: changes.add,
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Organisateur · Vous'), findsOneWidget);
    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Rogue').last);
    await tester.pumpAndSettle();
    expect(changes, ['ROGUE']);
    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('À choisir').last);
    await tester.pumpAndSettle();
    expect(changes, ['ROGUE', null]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Guest sees a readable role without an assignment control', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: const Scaffold(
          body: Center(
            child: SizedBox(
              width: 340,
              child: LobbyPlayerRow(
                player: _player,
                isSelf: false,
                voiceActive: true,
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Agent'), findsOneWidget);
    expect(find.text('AGENT'), findsNothing);
    expect(find.byType(DropdownButton<String>), findsNothing);
    expect(find.byIcon(Icons.graphic_eq), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
