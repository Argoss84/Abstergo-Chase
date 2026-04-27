import 'dart:async';
import 'dart:convert';

import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/lobby/data/player_name_store.dart';
import 'package:abstergo_chase/features/lobby/data/player_session_store.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/lobby_page.dart';
import 'package:abstergo_chase/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_code_scanner_plus/qr_code_scanner_plus.dart';

class JoinLobbyPage extends StatefulWidget {
  const JoinLobbyPage({super.key, this.initialCode});

  static const String routePath = '/join-lobby';
  static const String routeName = 'join-lobby';

  final String? initialCode;

  @override
  State<JoinLobbyPage> createState() => _JoinLobbyPageState();
}

class _JoinLobbyPageState extends State<JoinLobbyPage> {
  late final TextEditingController _nameController;
  late final TextEditingController _codeController;
  final PlayerNameStore _playerNameStore = PlayerNameStore();
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  bool _isRestoringPlayerName = true;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController();
    _codeController = TextEditingController(
      text: (widget.initialCode ?? '').trim().toUpperCase(),
    );
    _restorePlayerName();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _restorePlayerName() async {
    final saved = await _playerNameStore.load();
    if (!mounted) {
      return;
    }
    if (saved != null) {
      _nameController.text = saved;
    }
    setState(() {
      _isRestoringPlayerName = false;
    });
  }

  Future<void> _joinLobby() async {
    final displayName = _nameController.text.trim();
    final code = _codeController.text.trim().toUpperCase();
    if (displayName.isEmpty) {
      _showError('Veuillez entrer un nom de joueur');
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

    await _playerNameStore.save(displayName);
    final previousPlayerId = await _playerSessionStore.loadPlayerIdForCode(
      code,
    );
    final socketConfig = await _socketEnvironmentService.loadConfig();
    final bootstrap = LobbyBootstrapData(
      code: code,
      serverUrl: socketConfig.serverUrl,
      socketPath: socketConfig.socketPath,
      playerName: displayName,
      previousPlayerId: previousPlayerId,
    );
    if (!mounted) return;
    context.go('${LobbyPage.routePath}?code=$code', extra: bootstrap);
  }

  Future<void> _openQrScanner() async {
    if (_nameController.text.trim().isEmpty) {
      _showError('Renseignez votre nom avant de scanner un QR.');
      return;
    }
    QRViewController? scannerController;
    ValueNotifier<bool> flashEnabled = ValueNotifier<bool>(false);
    StreamSubscription<Barcode>? scanSubscription;
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
                QRView(
                  key: qrKey,
                  onQRViewCreated: (controller) {
                    scannerController = controller;
                    scanSubscription?.cancel();
                    scanSubscription = controller.scannedDataStream.listen((
                      scan,
                    ) async {
                      if (handled) return;
                      final raw = (scan.code ?? '').trim();
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
                    });
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
                      color: Colors.black.withOpacity(0.55),
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
                              final ctrl = scannerController;
                              if (ctrl == null) return;
                              await ctrl.toggleFlash();
                              final status = await ctrl.getFlashStatus();
                              flashEnabled.value = status ?? false;
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

    await scanSubscription?.cancel();
    scannerController?.dispose();
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
    final canJoin = code.length == 6 && _nameController.text.trim().isNotEmpty;

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
                  if (_isRestoringPlayerName)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      child: LinearProgressIndicator(minHeight: 2),
                    )
                  else
                    TextField(
                      controller: _nameController,
                      maxLength: CreateLobbyDefaults.maxPlayerNameLength,
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: 'Votre nom',
                        hintText: 'Entrez votre nom',
                      ),
                      onChanged: (_) => setState(() {}),
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
                  if (_nameController.text.trim().isNotEmpty) ...[
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
