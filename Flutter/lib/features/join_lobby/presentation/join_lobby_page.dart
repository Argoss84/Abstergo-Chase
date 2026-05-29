import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:broken_veil_protocol/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_code_dart_scan/qr_code_dart_scan.dart';

class JoinLobbyPage extends ConsumerStatefulWidget {
  const JoinLobbyPage({super.key, this.initialCode, this.initialError});

  static const String routePath = '/join-lobby';
  static const String routeName = 'join-lobby';

  final String? initialCode;
  final String? initialError;

  @override
  ConsumerState<JoinLobbyPage> createState() => _JoinLobbyPageState();
}

class _JoinLobbyPageState extends ConsumerState<JoinLobbyPage> {
  late final TextEditingController _codeController;
  final AccountApiService _accountApiService = AccountApiService();
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  bool _isLoadingAccountUsername = true;
  String _accountUsername = '';
  String? _accountCognitoSub;

  @override
  void initState() {
    super.initState();
    _codeController = TextEditingController(
      text: (widget.initialCode ?? '').trim().toUpperCase(),
    );
    final initialError = widget.initialError?.trim();
    if (initialError != null && initialError.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _showError(initialError);
      });
    }
    _loadAccountUsername();
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _loadAccountUsername() async {
    final auth = ref.read(authControllerProvider);
    _accountUsername = auth.username?.trim() ?? '';
    _accountCognitoSub = await auth.getCurrentUserSub();
    if (!mounted) {
      return;
    }
    setState(() {
      _isLoadingAccountUsername = false;
    });
    unawaited(_refreshAccountUsernameFromApi(auth));
  }

  Future<void> _refreshAccountUsernameFromApi(CognitoAuthController auth) async {
    try {
      final token = await auth.getAccessToken();
      if (token == null || token.isEmpty) {
        return;
      }
      await _accountApiService.syncUser(token, username: auth.username);
      final profile = await _accountApiService.getMyProfile(token);
      final username = profile.username?.trim();
      if (username == null || username.isEmpty) {
        return;
      }
      _accountUsername = username;
      _accountCognitoSub = await auth.getCurrentUserSub();
      if (!mounted) {
        return;
      }
      setState(() {});
    } catch (error) {
      if (error is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(error.message);
      }
    }
  }

  Future<void> _joinLobby() async {
    final displayName = _accountUsername.trim();
    final code = _codeController.text.trim().toUpperCase();
    if (displayName.isEmpty) {
      _showError(
        'Username manquant. Ouvrez "Mon compte" pour le definir avant de rejoindre.',
      );
      return;
    }
    if (code.isEmpty) {
      _showError('Veuillez entrer un code de partie');
      return;
    }
    if (code.length != 6) {
      _showError('Le code de partie doit contenir exactement 6 caractères');
      return;
    }

    final previousPlayerId = await _playerSessionStore.loadPlayerIdForCode(
      code,
    );
    final socketConfig = await _socketEnvironmentService.loadConfig();
    final bootstrap = LobbyBootstrapData(
      code: code,
      serverUrl: socketConfig.serverUrl,
      socketPath: socketConfig.socketPath,
      playerName: displayName,
      cognitoSub: _accountCognitoSub,
      previousPlayerId: previousPlayerId,
    );
    if (!mounted) return;
    context.go('${LobbyPage.routePath}?code=$code', extra: bootstrap);
  }

  Future<void> _openQrScanner() async {
    if (_accountUsername.trim().isEmpty) {
      _showError('Definissez un username dans "Mon compte" avant de scanner.');
      return;
    }
    final scannerController = QRCodeDartScanController();
    ValueNotifier<bool> flashEnabled = ValueNotifier<bool>(false);
    var handled = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) {
        final qrKey = GlobalKey(debugLabel: 'join-lobby-qr');
        return Dialog(
          insetPadding: const EdgeInsets.all(12),
          child: AspectRatio(
            aspectRatio: 3 / 4,
            child: Stack(
              fit: StackFit.expand,
              children: [
                QRCodeDartScanView(
                  key: qrKey,
                  controller: scannerController,
                  onCapture: (capture) async {
                    if (handled) return;
                    final raw = capture.text.trim();
                    if (raw.isEmpty) return;
                    final parsedCode = _extractLobbyCodeFromQr(raw);
                    if (parsedCode == null) {
                      _showError('QR invalide pour rejoindre une partie.');
                      return;
                    }
                    handled = true;
                    _codeController.text = parsedCode;
                    if (mounted) setState(() {});
                    Navigator.of(dialogContext).pop();
                    await _joinLobby();
                  },
                ),
                Align(
                  alignment: Alignment.topCenter,
                  child: Container(
                    margin: const EdgeInsets.only(top: 12),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'Scannez le QR code de la partie',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ),
                Positioned(
                  right: 12,
                  bottom: 12,
                  child: Row(
                    children: [
                      ValueListenableBuilder<bool>(
                        valueListenable: flashEnabled,
                        builder: (context, enabled, _) {
                          return FloatingActionButton.small(
                            heroTag: 'join-qr-flash',
                            onPressed: () async {
                              await scannerController.toggleFlash();
                              flashEnabled.value = scannerController.isFlashOn;
                            },
                            child: Icon(
                              enabled ? Icons.flash_on : Icons.flash_off,
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    await scannerController.stopScan();
    flashEnabled.dispose();
  }

  String? _extractLobbyCodeFromQr(String rawQr) {
    final raw = rawQr.trim();
    if (raw.isEmpty) return null;
    final direct = raw.toUpperCase();
    if (RegExp(r'^[A-Z0-9]{6}$').hasMatch(direct)) {
      return direct;
    }
    try {
      final dynamic decoded = jsonDecode(raw);
      if (decoded is Map) {
        final type = decoded['type']?.toString().trim().toLowerCase();
        final code = decoded['code']?.toString().trim().toUpperCase();
        if (type == 'lobby-join' &&
            code != null &&
            RegExp(r'^[A-Z0-9]{6}$').hasMatch(code)) {
          return code;
        }
      }
    } catch (_) {
      // Keep silent and return null.
    }
    return null;
  }

  void _showError(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final code = _codeController.text.trim().toUpperCase();
    final canJoin = code.length == 6 && _accountUsername.trim().isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Rejoindre une partie')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Rejoindre une partie',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 16),
                  if (_isLoadingAccountUsername)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      child: LinearProgressIndicator(minHeight: 2),
                    )
                  else
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.person),
                      title: const Text('Joueur connecte'),
                      subtitle: Text(
                        _accountUsername.isEmpty
                            ? 'Username non configure (Mon compte)'
                            : _accountUsername,
                      ),
                    ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _codeController,
                    maxLength: 6,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'Code de la partie',
                      hintText: 'Entrez le code de la partie',
                    ),
                    onChanged: (value) {
                      final up = value.toUpperCase();
                      if (up != value) {
                        _codeController.value = _codeController.value.copyWith(
                          text: up,
                          selection: TextSelection.collapsed(offset: up.length),
                        );
                      }
                      setState(() {});
                    },
                  ),
                  const SizedBox(height: 8),
                  if (_accountUsername.trim().isNotEmpty) ...[
                    Align(
                      alignment: Alignment.centerLeft,
                      child: FilledButton.tonalIcon(
                        onPressed: _openQrScanner,
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('Scanner un QR code'),
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  FilledButton(
                    onPressed: canJoin ? _joinLobby : null,
                    child: const Text('Rejoindre la partie'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
