import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:broken_veil_protocol/features/home/presentation/home_menu_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class BootstrapPage extends ConsumerStatefulWidget {
  const BootstrapPage({
    super.key,
    this.permissionsService = const DeviceBootstrapPermissionsService(),
  });

  static const String routeName = 'bootstrap';
  static const String routePath = '/';

  final BootstrapPermissionsService permissionsService;

  @override
  ConsumerState<BootstrapPage> createState() => _BootstrapPageState();
}

class _BootstrapPageState extends ConsumerState<BootstrapPage> {
  bool _isCheckingPermissions = true;
  BootstrapPermissionsStatus _permissionsStatus = BootstrapPermissionsStatus.denied;

  @override
  void initState() {
    super.initState();
    _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    if (mounted) {
      setState(() {
        _isCheckingPermissions = true;
      });
    }
    var result = const BootstrapPermissionsResult(BootstrapPermissionsStatus.error);
    try {
      result = await widget.permissionsService.ensureRequiredPermissions();
    } catch (_) {
      result = const BootstrapPermissionsResult(BootstrapPermissionsStatus.error);
    }
    if (!mounted) return;
    setState(() {
      _permissionsStatus = result.status;
      _isCheckingPermissions = false;
    });
  }

  Future<void> _openSettings() async {
    await widget.permissionsService.openAppSettings();
  }

  @override
  Widget build(BuildContext context) {
    final canOpenLobbyFlows =
        !_isCheckingPermissions &&
        _permissionsStatus == BootstrapPermissionsStatus.granted;
    final missingPermissions =
        !_isCheckingPermissions &&
        _permissionsStatus != BootstrapPermissionsStatus.granted;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Broken Veil Protocol'),
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
              if (_isCheckingPermissions)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: LinearProgressIndicator(minHeight: 2),
                )
              else if (missingPermissions)
                Semantics(
                  label:
                      'Créer et rejoindre une partie sont désactivés tant que la localisation et le micro ne sont pas autorisés.',
                  child: ListTile(
                    leading: const Icon(Icons.warning_amber_rounded),
                    title: Text(
                      _permissionsStatus == BootstrapPermissionsStatus.error
                          ? 'Erreur de vérification'
                          : 'Autorisations requises',
                    ),
                    subtitle: Text(
                      _permissionsStatus == BootstrapPermissionsStatus.error
                          ? 'Impossible de vérifier les autorisations. Réessayez.'
                          : 'Activez la localisation et le micro pour créer ou rejoindre une partie.',
                    ),
                    trailing: TextButton(
                      onPressed:
                          _permissionsStatus ==
                              BootstrapPermissionsStatus.deniedForever
                          ? _openSettings
                          : _checkPermissions,
                      child: Text(
                        _permissionsStatus ==
                                BootstrapPermissionsStatus.deniedForever
                            ? 'Réglages'
                            : 'Réessayer',
                      ),
                    ),
                  ),
                ),
              ListTile(
                title: const Text('Créer une partie'),
                onTap: canOpenLobbyFlows
                    ? () => context.push(CreateLobbyPage.routePath)
                    : null,
              ),
              ListTile(
                title: const Text('Rejoindre une partie'),
                onTap: canOpenLobbyFlows
                    ? () => context.push(HomeMenuPage.joinLobbyPath)
                    : null,
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
