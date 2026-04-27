import 'package:abstergo_chase/features/lobby/application/lobby_controller.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/lobby/data/player_name_store.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/game/presentation/game_page.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:abstergo_chase/shared/services/socket_environment_service.dart';
import 'package:abstergo_chase/shared/services/vibration_service.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

class LobbyPage extends StatefulWidget {
  const LobbyPage({super.key, this.initialCode, this.bootstrapData});

  static const String routePath = '/lobby';
  static const String routeName = 'lobby';

  final String? initialCode;
  final LobbyBootstrapData? bootstrapData;

  @override
  State<LobbyPage> createState() => _LobbyPageState();
}

/// Texte sur bulles claires : le thème sombre impose une couleur de corps claire,
/// illisible sur fond bleu/gris pâle sans override explicite.
const TextStyle _kChatBubbleNameStyle = TextStyle(
  fontSize: 11,
  fontWeight: FontWeight.w600,
  color: Color(0xFF334155),
);
const TextStyle _kChatBubbleBodyStyle = TextStyle(
  fontSize: 14,
  height: 1.35,
  color: Color(0xFF0F172A),
);

class _LobbyPageState extends State<LobbyPage> with WidgetsBindingObserver {
  late final LobbyController _controller;
  late final TextEditingController _chatController;
  int _lastReadCount = 0;
  bool _isChatOpen = false;
  bool _didRouteToGame = false;
  bool _didFallbackRouteToGame = false;
  final VibrationService _vibrationService = VibrationService();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  final PlayerNameStore _playerNameStore = PlayerNameStore();
  Set<String> _knownLobbyPlayerIds = <String>{};
  bool _knownLobbyPlayersInitialized = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = LobbyController();
    _chatController = TextEditingController();
    final bootstrap = widget.bootstrapData;
    if (bootstrap != null) {
      _controller.initialize(bootstrap: bootstrap);
    } else if ((widget.initialCode ?? '').trim().isNotEmpty) {
      _initializeFromCode(widget.initialCode!);
    } else {
      _controller.error = 'Code lobby manquant.';
      _controller.isLoading = false;
    }
  }

  Future<void> _initializeFromCode(String code) async {
    final socketConfig = await _socketEnvironmentService.loadConfig();
    final savedName = await _playerNameStore.load();
    if (!mounted) return;
    _controller.initialize(
      bootstrap: LobbyBootstrapData(
        code: code.trim().toUpperCase(),
        serverUrl: socketConfig.serverUrl,
        socketPath: socketConfig.socketPath,
        playerName: (savedName == null || savedName.trim().isEmpty)
            ? 'Joueur'
            : savedName.trim(),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _chatController.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _controller.recoverAfterResume();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final bootstrap = _controller.bootstrapData;
        final config = _controller.gameConfig;
        final rawUnread = _controller.chatMessages.length - _lastReadCount;
        final int unreadCount = _isChatOpen
            ? 0
            : rawUnread < 0
            ? 0
            : (rawUnread > 999 ? 999 : rawUnread);
        _handleLobbyJoinVibration();
        if (_controller.gameStarted &&
            !_didRouteToGame &&
            _controller.playerId != null &&
            bootstrap != null) {
          _didRouteToGame = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            context.go(
              GamePage.routePath,
              extra: GameBootstrapData(
                lobby: bootstrap,
                playerId: _controller.playerId!,
                players: List<LobbyPlayer>.from(_controller.players),
                gameConfig: _controller.gameConfig,
                codeOverride: _controller.lobbyCode,
              ),
            );
          });
        }
        if (_controller.shouldOpenGameForCode &&
            !_didFallbackRouteToGame &&
            bootstrap != null) {
          _didFallbackRouteToGame = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            context.go(
              GamePage.routePath,
              extra: GameBootstrapData(
                lobby: bootstrap,
                playerId: bootstrap.previousPlayerId ?? '',
                players: const <LobbyPlayer>[],
                gameConfig: null,
                codeOverride: _controller.lobbyCode ?? bootstrap.code,
              ),
            );
          });
        }
        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                const Text('Lobby'),
                const SizedBox(width: 8),
                _statusChip(_controller.connectionStatus),
              ],
            ),
            actions: [
              IconButton(
                tooltip: _controller.isVoiceChatEnabled
                    ? 'Désactiver vocal'
                    : 'Activer vocal',
                onPressed: () {
                  _controller.toggleVoiceChat();
                },
                icon: Icon(
                  _controller.isVoiceChatEnabled ? Icons.mic : Icons.mic_off,
                ),
              ),
              TextButton(
                onPressed: () {
                  _controller.leaveLobby();
                  if (mounted) {
                    context.go('/');
                  }
                },
                child: const Text('Quitter'),
              ),
            ],
          ),
          floatingActionButton: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              FloatingActionButton(
                heroTag: 'lobby-info-fab',
                onPressed: _openLobbyInfoSheet,
                child: const Icon(Icons.info_outline),
              ),
              const SizedBox(height: 10),
              FloatingActionButton(
                heroTag: 'lobby-chat-fab',
                onPressed: _openChatSheet,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.chat_bubble_outline),
                    if (unreadCount > 0)
                      Positioned(
                        right: -6,
                        top: -8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.red,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            unreadCount > 99 ? '99+' : '$unreadCount',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          body: _controller.isLoading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_controller.error != null)
                      Card(
                        color: Colors.red.shade100,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(_controller.error!),
                        ),
                      ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: SizedBox(
                          height: 120,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Expanded(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    const Text(
                                      'Code de la partie',
                                      textAlign: TextAlign.center,
                                    ),
                                    const SizedBox(height: 8),
                                    SelectableText(
                                      (_controller.lobbyCode ?? '')
                                          .toUpperCase(),
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 28,
                                        letterSpacing: 4,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 10),
                              if ((_controller.lobbyCode ?? '').isNotEmpty)
                                AspectRatio(
                                  aspectRatio: 1,
                                  child: Container(
                                    padding: const EdgeInsets.all(6),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: SizedBox.expand(
                                      child: QrImageView(
                                        data:
                                            '{"type":"lobby-join","code":"${(_controller.lobbyCode ?? '').toUpperCase()}"}',
                                        version: QrVersions.auto,
                                        eyeStyle: const QrEyeStyle(
                                          eyeShape: QrEyeShape.square,
                                          color: Colors.black,
                                        ),
                                        dataModuleStyle:
                                            const QrDataModuleStyle(
                                              dataModuleShape:
                                                  QrDataModuleShape.square,
                                              color: Colors.black,
                                            ),
                                        backgroundColor: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (config != null ||
                        (bootstrap?.form != null &&
                            bootstrap!.form!.mapCenterLatitude.isNotEmpty &&
                            bootstrap.form!.mapCenterLongitude.isNotEmpty))
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: LobbyMapPreview(
                            center:
                                config?.mapCenter ??
                                (bootstrap!.form!.mapCenterLatitude.isEmpty
                                    ? bootstrap.objectives.first
                                    : _pointFromForm(bootstrap)),
                            mapRadiusMeters:
                                config?.mapRadius ?? bootstrap!.form!.mapRadius,
                            outerStreetContour:
                                config?.mapStreets ??
                                bootstrap!.outerStreetContour,
                            objectives: _controller.isHost
                                ? bootstrap?.objectives ?? const <GeoPoint>[]
                                : const <GeoPoint>[],
                            agentStartZone:
                                config?.startZone ?? bootstrap?.agentStartZone,
                            rogueStartZone:
                                config?.rogueStartZone ??
                                bootstrap?.rogueStartZone,
                            objectiveZoneRadiusMeters:
                                config?.objectiveZoneRadius ??
                                bootstrap!.form!.objectiveZoneRadius,
                            startZoneRadiusMeters:
                                config?.startZoneRadius ??
                                bootstrap?.form?.startZoneRadius ??
                                25,
                            showObjectives: _controller.isHost,
                          ),
                        ),
                      ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              'Joueurs (${_controller.players.length})',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 8),
                            ..._controller.players.map((player) {
                              final voiceActive = _controller
                                  .isPlayerVoiceActive(player.id);
                              return AnimatedContainer(
                                duration: const Duration(milliseconds: 180),
                                margin: const EdgeInsets.only(bottom: 4),
                                decoration: BoxDecoration(
                                  color: voiceActive
                                      ? Colors.cyanAccent.withOpacity(0.16)
                                      : Colors.transparent,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: voiceActive
                                        ? Colors.cyanAccent
                                        : Colors.transparent,
                                  ),
                                ),
                                child: ListTile(
                                  dense: true,
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                  ),
                                  leading: Icon(
                                    voiceActive
                                        ? Icons.graphic_eq
                                        : Icons.volume_mute,
                                    size: 18,
                                    color: voiceActive
                                        ? Colors.cyanAccent
                                        : Colors.white70,
                                  ),
                                  title: Text(
                                    player.name +
                                        (player.id == _controller.playerId
                                            ? ' (Vous)'
                                            : ''),
                                  ),
                                  subtitle: Text(
                                    player.isHost ? 'Host' : 'Joueur',
                                  ),
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.center,
                                    children: [
                                      if (_roleMarkerAssetFor(player.role) !=
                                          null)
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            right: 8,
                                          ),
                                          child: SizedBox(
                                            width: 24,
                                            height: 24,
                                            child: Image.asset(
                                              _roleMarkerAssetFor(player.role)!,
                                              fit: BoxFit.contain,
                                              errorBuilder: (context, _, __) =>
                                                  Icon(
                                                    _roleFallbackIconFor(
                                                      player.role,
                                                    ),
                                                    size: 20,
                                                    color: _roleColorFor(
                                                      player.role,
                                                    ),
                                                  ),
                                            ),
                                          ),
                                        ),
                                      _controller.isHost
                                          ? DropdownButton<String>(
                                              value: player.role ?? '',
                                              items: const [
                                                DropdownMenuItem(
                                                  value: '',
                                                  child: Text('Aucun'),
                                                ),
                                                DropdownMenuItem(
                                                  value: 'AGENT',
                                                  child: Text('Agent'),
                                                ),
                                                DropdownMenuItem(
                                                  value: 'ROGUE',
                                                  child: Text('Rogue'),
                                                ),
                                              ],
                                              onChanged: (value) {
                                                _controller.updateRole(
                                                  targetPlayerId: player.id,
                                                  role: (value?.isEmpty ?? true)
                                                      ? null
                                                      : value,
                                                );
                                              },
                                            )
                                          : Text(player.role ?? 'Aucun'),
                                    ],
                                  ),
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
                    ),
                    if (_controller.isHost)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              FilledButton.tonal(
                                onPressed: _openHostConfigEditor,
                                child: const Text('Modifier paramètres'),
                              ),
                              const SizedBox(height: 10),
                              const Text(
                                'Prerequis pour demarrer',
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _controller.canStartGame
                                    ? 'OK: au moins 1 Agent et 1 Rogue'
                                    : 'Attribuez au moins 1 Agent et 1 Rogue',
                              ),
                              const SizedBox(height: 10),
                              FilledButton(
                                onPressed: _controller.canStartGame
                                    ? _controller.startGame
                                    : null,
                                child: const Text('Demarrer la partie'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    if (_controller.gameStarted)
                      Card(
                        color: Colors.orange.shade100,
                        child: const Padding(
                          padding: EdgeInsets.all(12),
                          child: Text('Partie en cours de demarrage...'),
                        ),
                      ),
                    if (_controller.connectionStatus == 'connected' &&
                        _controller.players.isEmpty)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton(
                          onPressed: _controller.requestLatestState,
                          child: const Text('Demander la synchronisation'),
                        ),
                      ),
                  ],
                ),
        );
      },
    );
  }

  void _handleLobbyJoinVibration() {
    final ids = _controller.players.map((p) => p.id).toSet();
    if (!_knownLobbyPlayersInitialized) {
      _knownLobbyPlayersInitialized = true;
      _knownLobbyPlayerIds = ids;
      return;
    }
    final newIds = ids.difference(_knownLobbyPlayerIds);
    final hasNewOtherPlayer = newIds.any((id) => id != _controller.playerId);
    if (hasNewOtherPlayer) {
      _vibrationService.vibrateIfEnabled(VibrationEvent.lobbyPlayerJoined);
    }
    _knownLobbyPlayerIds = ids;
  }

  GeoPoint _pointFromForm(LobbyBootstrapData data) {
    return GeoPoint(
      latitude: double.tryParse(data.form!.mapCenterLatitude) ?? 0,
      longitude: double.tryParse(data.form!.mapCenterLongitude) ?? 0,
    );
  }

  Widget _statusChip(String status) {
    Color color;
    switch (status) {
      case 'connected':
        color = Colors.green;
        break;
      case 'connecting':
        color = Colors.orange;
        break;
      case 'error':
        color = Colors.red;
        break;
      default:
        color = Colors.grey;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(status, style: TextStyle(color: color, fontSize: 12)),
    );
  }

  Widget _kv(String key, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              key,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Text(value),
        ],
      ),
    );
  }

  String? _roleMarkerAssetFor(String? role) {
    switch ((role ?? '').toUpperCase()) {
      case 'AGENT':
        return 'assets/images/agent_marker.png';
      case 'ROGUE':
        return 'assets/images/rogue_marker.png';
      default:
        return null;
    }
  }

  IconData _roleFallbackIconFor(String? role) {
    switch ((role ?? '').toUpperCase()) {
      case 'AGENT':
        return Icons.shield;
      case 'ROGUE':
        return Icons.visibility_off;
      default:
        return Icons.help_outline;
    }
  }

  Color _roleColorFor(String? role) {
    switch ((role ?? '').toUpperCase()) {
      case 'AGENT':
        return Colors.lightBlueAccent;
      case 'ROGUE':
        return Colors.purpleAccent;
      default:
        return Colors.white70;
    }
  }

  Future<void> _openHostConfigEditor() async {
    final initial = _controller.bootstrapData?.form;
    if (!_controller.isHost || initial == null) {
      return;
    }
    final result = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => CreateLobbyDetailsSheet(initialData: initial),
    );
    if (result is CreateLobbyDetailsResult) {
      _controller.updateLobbyConfig(result.form);
    }
  }

  Future<void> _openChatSheet() async {
    setState(() {
      _isChatOpen = true;
      _lastReadCount = _controller.chatMessages.length;
    });
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => AnimatedPadding(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.65,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    'Chat du lobby',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ),
                Expanded(
                  child: AnimatedBuilder(
                    animation: _controller,
                    builder: (context, _) {
                      if (_controller.chatMessages.isEmpty) {
                        return Center(
                          child: Text(
                            'Aucun message.',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                        );
                      }
                      return ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        itemCount: _controller.chatMessages.length,
                        itemBuilder: (context, index) {
                          final m = _controller.chatMessages[index];
                          final isMe = m.playerId == _controller.playerId;
                          return Align(
                            alignment: isMe
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: isMe
                                    ? Colors.blue.shade100
                                    : Colors.grey.shade200,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    isMe
                                        ? '${m.playerName} (Vous)'
                                        : m.playerName,
                                    style: _kChatBubbleNameStyle,
                                  ),
                                  Text(m.text, style: _kChatBubbleBodyStyle),
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
                          controller: _chatController,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                          decoration: InputDecoration(
                            border: const OutlineInputBorder(),
                            hintText: 'Votre message...',
                            hintStyle: TextStyle(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurface.withOpacity(0.55),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: () {
                          _controller.sendChat(_chatController.text);
                          _chatController.clear();
                        },
                        child: const Text('Envoyer'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _isChatOpen = false;
      _lastReadCount = _controller.chatMessages.length;
    });
  }

  Future<void> _openLobbyInfoSheet() async {
    final bootstrap = _controller.bootstrapData;
    final form = bootstrap?.form;
    final config = _controller.gameConfig;
    final code = (_controller.lobbyCode ?? bootstrap?.code ?? '').toUpperCase();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.86,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'Informations du lobby',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Code de la partie',
                        style: TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 8),
                      SelectableText(
                        code,
                        style: const TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 4,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    children: [
                      _kv('Joueurs', '${_controller.players.length}'),
                      _kv(
                        'Host',
                        _controller.players
                            .where((p) => p.isHost)
                            .map((p) => p.name)
                            .join(', '),
                      ),
                      _kv(
                        'Objectifs',
                        '${form?.objectiveNumber ?? _controller.objectiveNames.length}',
                      ),
                      _kv(
                        'Objectifs victoire',
                        '${form?.victoryConditionObjectives ?? 'n/a'}',
                      ),
                      _kv('Duree', '${form?.duration ?? 'n/a'} secondes'),
                    ],
                  ),
                ),
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    children: [
                      _kv(
                        'Rayon map',
                        '${config?.mapRadius ?? form?.mapRadius ?? 'n/a'} m',
                      ),
                      _kv(
                        'Rayon zone objectif',
                        '${config?.objectiveZoneRadius ?? form?.objectiveZoneRadius ?? 'n/a'} m',
                      ),
                      _kv(
                        'Rayon zone départ',
                        '${config?.startZoneRadius ?? form?.startZoneRadius ?? 'n/a'} m',
                      ),
                    ],
                  ),
                ),
              ),
              if (_controller.objectiveNames.isNotEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Noms des objectifs',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 8),
                        ..._controller.objectiveNames.map(
                          (name) => Text('- $name'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
