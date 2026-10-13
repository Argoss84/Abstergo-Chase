import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'dart:async';
import 'dart:convert';

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/lobby/data/lobby_socket_service.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:broken_veil_protocol/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_code_dart_scan/qr_code_dart_scan.dart';

class JoinLobbyPage extends ConsumerStatefulWidget {
  const JoinLobbyPage({
    super.key,
    this.initialCode,
    this.initialError,
    this.sessionSocketFactory,
  });

  static const String routePath = '/join-lobby';
  static const String routeName = 'join-lobby';

  final String? initialCode;
  final String? initialError;
  final LobbySocketService Function()? sessionSocketFactory;

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
  bool _isJoining = false;
  String _accountUsername = '';
  String? _accountCognitoSub;
  LobbySocketService? _lookupSocket;

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
    _restoreLastLobbyCode();
    _loadAccountUsername();
  }

  Future<void> _restoreLastLobbyCode() async {
    if (_codeController.text.trim().isNotEmpty) return;
    if (!mounted) return;
    final lastCode = await _playerSessionStore.loadLastLobbyCode();
    if (!mounted || lastCode == null) return;
    _codeController.text = lastCode;
  }

  @override
  void dispose() {
    _lookupSocket?.dispose();
    _lookupSocket = null;
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

  Future<void> _refreshAccountUsernameFromApi(
    CognitoAuthController auth,
  ) async {
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
    if (_isJoining) return;
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

    setState(() => _isJoining = true);
    FocusScope.of(context).unfocus();
    final socket = widget.sessionSocketFactory?.call() ?? LobbySocketService();
    _lookupSocket = socket;
    try {
      final previousPlayerId = await _playerSessionStore.loadPlayerIdForCode(
        code,
      );
      final socketConfig = await _socketEnvironmentService.loadConfig();
      if (!mounted) return;
      await socket.connect(
        serverUrl: Uri.parse(socketConfig.serverUrl),
        socketPath: socketConfig.socketPath,
      );
      if (!mounted) return;
      final destination = await socket.lookupSession(code: code);
      if (!mounted) return;
      if (destination == SessionDestination.notFound) {
        _showError(
          'Aucune partie ne correspond à ce code. Vérifiez le code saisi.',
        );
        return;
      }
      await _playerSessionStore.saveLastLobbyCode(code);
      final bootstrap = LobbyBootstrapData(
        code: code,
        serverUrl: socketConfig.serverUrl,
        socketPath: socketConfig.socketPath,
        playerName: displayName,
        cognitoSub: _accountCognitoSub,
        previousPlayerId: previousPlayerId,
      );
      if (!mounted) return;
      if (destination == SessionDestination.game) {
        context.go(
          GamePage.routePath,
          extra: GameBootstrapData(
            lobby: bootstrap,
            playerId: previousPlayerId ?? '',
            players: const <LobbyPlayer>[],
            codeOverride: code,
            fromCodeLookupFallback: true,
          ),
        );
      } else {
        context.go('${LobbyPage.routePath}?code=$code', extra: bootstrap);
      }
    } on TimeoutException {
      if (mounted) {
        _showError('Le serveur ne répond pas. Réessayez dans un instant.');
      }
    } catch (_) {
      if (mounted) {
        _showError(
          'Connexion impossible. Vérifiez votre connexion et réessayez.',
        );
      }
    } finally {
      if (identical(_lookupSocket, socket)) {
        _lookupSocket = null;
        socket.dispose();
      }
      if (mounted) setState(() => _isJoining = false);
    }
  }

  Future<void> _openQrScanner() async {
    if (_accountUsername.trim().isEmpty) {
      _showError('Definissez un username dans "Mon compte" avant de scanner.');
      return;
    }
    final scannerController = QRCodeDartScanController();
    final ValueNotifier<bool> flashEnabled = ValueNotifier<bool>(false);
    var handled = false;

    try {
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
                                flashEnabled.value =
                                    scannerController.isFlashOn;
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
    } finally {
      flashEnabled.dispose();
    }
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
    final canJoin =
        !_isJoining &&
        !_isLoadingAccountUsername &&
        code.length == 6 &&
        _accountUsername.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('Rejoindre une partie')),
      body: AppPageBody(
        maxWidth: 480,
        child: ListView(
          padding: const EdgeInsets.all(20),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            const AppSectionHeading(
              title: 'Retrouvez votre équipe',
              subtitle:
                  'Le code à six caractères est affiché dans le lobby de la partie.',
              icon: Icons.groups_outlined,
            ),
            const SizedBox(height: 24),
            if (_isLoadingAccountUsername)
              const LinearProgressIndicator()
            else if (_accountUsername.isEmpty)
              AppNotice(
                message:
                    'Définissez votre nom de joueur avant de rejoindre une partie.',
                isError: true,
                action: TextButton(
                  onPressed: () async {
                    await context.push(AccountPage.routePath);
                    if (mounted) await _loadAccountUsername();
                  },
                  child: const Text('Mon compte'),
                ),
              )
            else
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.person_outline),
                title: Text(_accountUsername),
                subtitle: const Text('Votre nom dans la partie'),
              ),
            const SizedBox(height: 16),
            TextField(
              controller: _codeController,
              enabled: !_isJoining,
              maxLength: 6,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              enableSuggestions: false,
              textInputAction: TextInputAction.go,
              style: const TextStyle(
                letterSpacing: 3,
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
              decoration: const InputDecoration(
                labelText: 'Code de la partie',
                hintText: 'ABC123',
                helperText: '6 caractères',
                prefixIcon: Icon(Icons.tag),
              ),
              onSubmitted: (_) {
                if (canJoin) _joinLobby();
              },
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
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: canJoin ? _joinLobby : null,
              icon: _isJoining
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_forward),
              label: Text(
                _isJoining ? 'Recherche de la partie…' : 'Rejoindre la partie',
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: !_isJoining && _accountUsername.isNotEmpty
                  ? _openQrScanner
                  : null,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Scanner un QR code'),
            ),
          ],
        ),
      ),
    );
  }
}
