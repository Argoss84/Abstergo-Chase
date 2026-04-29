import 'package:abstergo_chase/app/providers.dart';
import 'package:abstergo_chase/features/account/presentation/account_page.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:abstergo_chase/features/home/presentation/home_menu_page.dart';

class BootstrapPage extends ConsumerWidget {
  const BootstrapPage({super.key});

  static const String routeName = 'bootstrap';
  static const String routePath = '/';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AbstergoChase'),
        actions: [
          IconButton(
            tooltip: 'Déconnexion',
            onPressed: () {
              ref.read(authControllerProvider).signOut();
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Card(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text(
                  'Home',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
                ),
              ),
              ListTile(
                title: const Text('Créer une partie'),
                onTap: () => context.push(CreateLobbyPage.routePath),
              ),
              ListTile(
                title: const Text('Rejoindre une partie'),
                onTap: () => context.push(HomeMenuPage.joinLobbyPath),
              ),
              ListTile(
                title: const Text('Paramètres'),
                onTap: () => context.push(HomeMenuPage.settingsPath),
              ),
              ListTile(
                title: const Text('Mon compte'),
                onTap: () => context.push(AccountPage.routePath),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
