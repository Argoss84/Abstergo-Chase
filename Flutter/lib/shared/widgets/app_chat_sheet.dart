import 'dart:math';

import 'package:flutter/material.dart';

class AppChatEntry {
  const AppChatEntry({
    required this.author,
    required this.text,
    required this.isSelf,
  });
  final String author;
  final String text;
  final bool isSelf;
}

/// Shared, keyboard-aware chat with lazy message construction.
class AppChatSheet extends StatelessWidget {
  const AppChatSheet({
    super.key,
    required this.title,
    required this.animation,
    required this.messageCount,
    required this.messageAt,
    required this.controller,
    required this.onSend,
    this.compactAuthor = false,
  });

  final String title;
  final Listenable animation;
  final int Function() messageCount;
  final AppChatEntry Function(int index) messageAt;
  final TextEditingController controller;
  final ValueChanged<String> onSend;
  final bool compactAuthor;

  void _send() {
    final text = controller.text.trim();
    if (text.isEmpty) return;
    onSend(text);
    controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final media = MediaQuery.of(context);
    final availableHeight = max(
      0.0,
      media.size.height - media.viewInsets.bottom - media.padding.vertical,
    );
    return AnimatedPadding(
      duration: media.disableAnimations
          ? Duration.zero
          : const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: min(600, availableHeight * 0.85),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Fermer',
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: AnimatedBuilder(
                  animation: animation,
                  builder: (context, _) {
                    final count = messageCount();
                    if (count == 0) {
                      return const Center(child: Text('Aucun message.'));
                    }
                    return ListView.builder(
                      reverse: true,
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.all(16),
                      itemCount: count,
                      itemBuilder: (context, index) {
                        final entry = messageAt(count - 1 - index);
                        final color = entry.isSelf
                            ? scheme.primaryContainer
                            : scheme.surfaceContainerHighest;
                        final foreground = entry.isSelf
                            ? scheme.onPrimaryContainer
                            : scheme.onSurface;
                        return Align(
                          alignment: entry.isSelf
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            constraints: BoxConstraints(
                              maxWidth: media.size.width * 0.85,
                            ),
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: color,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (!compactAuthor) ...[
                                  Text(
                                    entry.isSelf
                                        ? '${entry.author} (Vous)'
                                        : entry.author,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700,
                                      color: foreground,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                ],
                                Text(
                                  compactAuthor
                                      ? '${entry.author}: ${entry.text}'
                                      : entry.text,
                                  style: TextStyle(
                                    color: foreground,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: controller,
                        textInputAction: TextInputAction.send,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(
                          hintText: 'Votre message…',
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _send,
                      child: const Text('Envoyer'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
