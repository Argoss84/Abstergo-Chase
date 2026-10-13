import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'package:broken_veil_protocol/features/bootstrap/data/bootstrap_permissions_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:broken_veil_protocol/features/home/presentation/home_menu_page.dart';
import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
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

class _BootstrapPageState extends ConsumerState<BootstrapPage>
    with WidgetsBindingObserver {
  bool _isCheckingPermissions = true;
  BootstrapPermissionsStatus _permissionsStatus =
      BootstrapPermissionsStatus.denied;
  bool _shouldRefreshPermissionsOnResume = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkPermissions(forceRequest: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final locationServiceDisabled =
        _permissionsStatus ==
        BootstrapPermissionsStatus.locationServiceDisabled;
    if (state == AppLifecycleState.resumed &&
        !_isCheckingPermissions &&
        (_shouldRefreshPermissionsOnResume || locationServiceDisabled)) {
      _shouldRefreshPermissionsOnResume = false;
      _checkPermissions(forceRequest: locationServiceDisabled);
    }
  }

  Future<void> _checkPermissions({bool forceRequest = false}) async {
    if (mounted) {
      setState(() {
        _isCheckingPermissions = true;
      });
    }
    var result = const BootstrapPermissionsResult(
      BootstrapPermissionsStatus.error,
    );
    try {
      result = await widget.permissionsService.ensureRequiredPermissions(
        forceRequest: forceRequest,
      );
    } catch (_) {
      result = const BootstrapPermissionsResult(
        BootstrapPermissionsStatus.error,
      );
    }
    if (!mounted) return;
    setState(() {
      _permissionsStatus = result.status;
      _isCheckingPermissions = false;
    });
  }

  Future<void> _openSettings() async {
    _shouldRefreshPermissionsOnResume = true;
    if (_permissionsStatus ==
        BootstrapPermissionsStatus.locationServiceDisabled) {
      await widget.permissionsService.openLocationSettings();
    } else {
      await widget.permissionsService.openAppSettings();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canOpenLobbyFlows =
        !_isCheckingPermissions &&
        _permissionsStatus == BootstrapPermissionsStatus.granted;
    final hasBlockingIssue =
        !_isCheckingPermissions &&
        _permissionsStatus != BootstrapPermissionsStatus.granted;
    final locationServiceDisabled =
        _permissionsStatus ==
        BootstrapPermissionsStatus.locationServiceDisabled;
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Broken Veil Protocol',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
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
      body: AppPageBody(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const AppSectionHeading(
              title: 'Prêt à entrer en jeu ?',
              subtitle: 'Préparez le terrain ou retrouvez votre équipe.',
              icon: Icons.radar,
            ),
            const SizedBox(height: 24),
            if (_isCheckingPermissions)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: LinearProgressIndicator(minHeight: 2),
              )
            else if (hasBlockingIssue)
              Semantics(
                label: locationServiceDisabled
                    ? 'Créer et rejoindre une partie sont désactivés tant que le GPS du téléphone est désactivé.'
                    : 'Créer et rejoindre une partie sont désactivés tant que la localisation et le micro ne sont pas autorisés.',
                child: AppNotice(
                  isError: true,
                  title: locationServiceDisabled
                      ? 'GPS désactivé'
                      : _permissionsStatus == BootstrapPermissionsStatus.error
                      ? 'Erreur de vérification'
                      : 'Autorisations requises',
                  message: locationServiceDisabled
                      ? 'Activez le GPS dans les réglages de localisation du téléphone pour créer ou rejoindre une partie.'
                      : _permissionsStatus == BootstrapPermissionsStatus.error
                      ? 'Impossible de vérifier les autorisations. Ouvrez les réglages de l’application.'
                      : 'Autorisez l’accès à la localisation et au micro pour créer ou rejoindre une partie.',
                  action: TextButton(
                    onPressed: _openSettings,
                    child: const Text('Réglages'),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            _MenuAction(
              icon: Icons.add_location_alt_outlined,
              title: 'Créer une partie',
              subtitle: 'Réglages, terrain et validation en trois étapes.',
              onTap: canOpenLobbyFlows
                  ? () => context.push(CreateLobbyPage.routePath)
                  : null,
            ),
            const SizedBox(height: 12),
            _MenuAction(
              icon: Icons.qr_code_scanner,
              title: 'Rejoindre une partie',
              subtitle: 'Saisissez un code ou scannez le QR de votre équipe.',
              onTap: canOpenLobbyFlows
                  ? () => context.push(HomeMenuPage.joinLobbyPath)
                  : null,
            ),
            const SizedBox(height: 24),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.tune),
                    trailing: const Icon(Icons.chevron_right),
                    title: const Text('Paramètres'),
                    onTap: () => context.push(HomeMenuPage.settingsPath),
                  ),
                  ListTile(
                    leading: const Icon(Icons.person_outline),
                    trailing: const Icon(Icons.chevron_right),
                    title: const Text('Mon compte'),
                    onTap: () => context.push(AccountPage.routePath),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuAction extends StatelessWidget {
  const _MenuAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final compact =
        MediaQuery.sizeOf(context).width < 360 ||
        MediaQuery.textScalerOf(context).scale(1) > 1.3;
    return Card(
      child: ListTile(
        enabled: onTap != null,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 12,
        ),
        leading: compact ? null : Icon(icon, size: 28),
        title: compact
            ? Row(
                children: [
                  Icon(icon, size: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                ],
              )
            : Text(title, style: Theme.of(context).textTheme.titleMedium),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(subtitle),
        ),
        trailing: compact ? null : const Icon(Icons.arrow_forward),
        onTap: onTap,
      ),
    );
  }
}
