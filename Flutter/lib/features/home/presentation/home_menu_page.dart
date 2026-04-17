import 'package:flutter/material.dart';

class HomeMenuPage extends StatelessWidget {
  const HomeMenuPage({
    super.key,
    required this.title,
  });

  static const String createLobbyPath = '/create-lobby';
  static const String joinLobbyPath = '/join-lobby';

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Text(
          title,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
