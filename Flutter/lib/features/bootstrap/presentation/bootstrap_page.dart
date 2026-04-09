import 'package:abstergo_chase/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:abstergo_chase/features/lab/presentation/lab_page.dart';
import 'package:abstergo_chase/features/home/presentation/home_menu_page.dart';

class BootstrapPage extends StatelessWidget {
  const BootstrapPage({super.key});

  static const String routeName = 'bootstrap';
  static const String routePath = '/';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const DrawerHeader(
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: Text(
                    'AbstergoChase',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.science_outlined),
                title: const Text('Lab Page'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.push(LabPage.routePath);
                },
              ),
            ],
          ),
        ),
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
                title: const Text(
                  'Diagnostic de session',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.blueGrey,
                  ),
                ),
                onTap: () => context.push(HomeMenuPage.sessionDiagnosticsPath),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
