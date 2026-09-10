import 'package:broken_veil_protocol/features/lobby/application/lobby_controller.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

LobbyChatMessage _message(int index) => LobbyChatMessage(
  playerId: 'player-1',
  playerName: 'Joueur',
  text: 'Message $index',
  timestampMs: index,
);

Future<LobbyController> _pumpLobby(
  WidgetTester tester, {
  int messageCount = 0,
}) async {
  await tester.pumpWidget(
    const ProviderScope(child: MaterialApp(home: LobbyPage())),
  );
  await tester.pumpAndSettle();

  final builder = tester.widget<AnimatedBuilder>(
    find.byWidgetPredicate(
      (widget) =>
          widget is AnimatedBuilder && widget.animation is LobbyController,
    ),
  );
  final controller = builder.animation as LobbyController;
  controller.chatMessages.addAll(List.generate(messageCount, _message));
  return controller;
}

Future<void> _openChat(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.chat_bubble_outline));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Opens and reopens a long chat at the latest messages', (
    tester,
  ) async {
    await _pumpLobby(tester, messageCount: 40);
    await _openChat(tester);

    expect(find.text('Message 39').hitTestable(), findsOneWidget);
    expect(find.text('Message 0').hitTestable(), findsNothing);
    expect(
      tester.getTopLeft(find.text('Message 38')).dy,
      lessThan(tester.getTopLeft(find.text('Message 39')).dy),
    );

    await tester.scrollUntilVisible(
      find.text('Message 0'),
      200,
      scrollable: find.descendant(
        of: find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(ListView),
        ),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('Message 0').hitTestable(), findsOneWidget);
    expect(find.text('Message 39').hitTestable(), findsNothing);

    await tester.tap(find.byTooltip('Fermer'));
    await tester.pumpAndSettle();
    expect(find.text('Chat du lobby'), findsNothing);

    await _openChat(tester);
    expect(find.text('Message 39').hitTestable(), findsOneWidget);
    expect(find.text('Message 0').hitTestable(), findsNothing);
  });

  testWidgets('Shows messages added while the chat was closed on reopening', (
    tester,
  ) async {
    final controller = await _pumpLobby(tester, messageCount: 40);
    await _openChat(tester);
    await tester.tap(find.byTooltip('Fermer'));
    await tester.pumpAndSettle();

    controller.chatMessages.add(_message(40));
    await _openChat(tester);

    expect(find.text('Message 40').hitTestable(), findsOneWidget);
    expect(find.text('Message 0').hitTestable(), findsNothing);
    expect(
      tester.getTopLeft(find.text('Message 39')).dy,
      lessThan(tester.getTopLeft(find.text('Message 40')).dy),
    );
  });

  for (final messageCount in <int>[0, 1, 3]) {
    testWidgets('Displays a chat containing $messageCount messages', (
      tester,
    ) async {
      await _pumpLobby(tester, messageCount: messageCount);
      await _openChat(tester);

      if (messageCount == 0) {
        expect(find.text('Aucun message.'), findsOneWidget);
      } else {
        for (var index = 0; index < messageCount; index++) {
          expect(find.text('Message $index').hitTestable(), findsOneWidget);
          if (index > 0) {
            expect(
              tester.getTopLeft(find.text('Message ${index - 1}')).dy,
              lessThan(tester.getTopLeft(find.text('Message $index')).dy),
            );
          }
        }
      }
      expect(tester.takeException(), isNull);
    });
  }
}
