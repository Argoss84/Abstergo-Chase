import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'package:broken_veil_protocol/shared/widgets/app_chat_sheet.dart';
import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/lobby/application/lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_name_store.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_player_row.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_start_requirements.dart';
import 'package:broken_veil_protocol/shared/services/socket_environment_service.dart';
import 'package:broken_veil_protocol/shared/services/vibration_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

class LobbyPage extends ConsumerStatefulWidget {
  const LobbyPage({super.key, this.initialCode, this.bootstrapData});

  static const String routePath = '/lobby';
  static const String routeName = 'lobby';

  final String? initialCode;
  final LobbyBootstrapData? bootstrapData;

  @override
  ConsumerState<LobbyPage> createState() => _LobbyPageState();
}

class _LobbyPageState extends ConsumerState<LobbyPage>
    with WidgetsBindingObserver {
  late final LobbyController _controller;
  late final TextEditingController _chatController;
  int _lastReadCount = 0;
  bool _isChatOpen = false;
  bool _didRouteToGame = false;
  bool _didFallbackRouteToGame = false;
  bool _didRouteBackToJoinOnError = false;
  GeoPoint? _initialPlayerPosition;
  bool _initialPlayerPositionResolved = false;
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
      _resolveInitialPlayerPosition();
      _controller.initialize(bootstrap: bootstrap);
    } else if ((widget.initialCode ?? '').trim().isNotEmpty) {
      _resolveInitialPlayerPosition();
      _initializeFromCode(widget.initialCode!);
    } else {
      _initialPlayerPositionResolved = true;
      _controller.error = 'Code lobby manquant.';
      _controller.isLoading = false;
    }
  }

  Future<void> _resolveInitialPlayerPosition() async {
    GeoPoint? position;
    try {
      position = await _loadInitialPlayerPosition().timeout(
        const Duration(seconds: 8),
        onTimeout: () => null,
      );
    } catch (_) {
      position = null;
    }
    if (!mounted) return;
    setState(() {
      _initialPlayerPosition = position;
      _initialPlayerPositionResolved = true;
    });
  }

  Future<GeoPoint?> _loadInitialPlayerPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 6),
      ),
    );
    return GeoPoint(latitude: position.latitude, longitude: position.longitude);
  }

  Future<void> _initializeFromCode(String code) async {
    final socketConfig = await _socketEnvironmentService.loadConfig();
    final savedName = await _playerNameStore.load();
    final cognitoSub = await ref
        .read(authControllerProvider)
        .getCurrentUserSub();
    if (!mounted) return;
    _controller.initialize(
      bootstrap: LobbyBootstrapData(
        code: code.trim().toUpperCase(),
        serverUrl: socketConfig.serverUrl,
        socketPath: socketConfig.socketPath,
        playerName: (savedName == null || savedName.trim().isEmpty)
            ? 'Joueur'
            : savedName.trim(),
        cognitoSub: cognitoSub,
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
            _initialPlayerPositionResolved &&
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
                fromCodeLookupFallback: false,
                initialPlayerPosition: _initialPlayerPosition,
              ),
            );
          });
        }
        if (_controller.shouldOpenGameForCode &&
            !_didFallbackRouteToGame &&
            _initialPlayerPositionResolved &&
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
                fromCodeLookupFallback: true,
                initialPlayerPosition: _initialPlayerPosition,
              ),
            );
          });
        }
        if (_shouldRedirectToJoinOnInitialError(bootstrap)) {
          _didRouteBackToJoinOnError = true;
          final code = (bootstrap?.code ?? '').trim().toUpperCase();
          final message = _controller.error ?? 'Lobby indisponible.';
          final route = Uri(
            path: JoinLobbyPage.routePath,
            queryParameters: <String, String>{'code': code, 'error': message},
          ).toString();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            context.go(route);
          });
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return Scaffold(
          appBar: AppBar(
            title: const Text('Lobby'),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(36),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: _statusChip(_controller.connectionStatus),
                ),
              ),
            ),
            actions: [
              IconButton(
                tooltip: _controller.isMicrophoneEnabled
                    ? 'Couper le micro'
                    : 'Activer le micro',
                onPressed: () {
                  _controller.toggleVoiceChat();
                },
                icon: Icon(
                  _controller.isMicrophoneEnabled ? Icons.mic : Icons.mic_off,
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
          bottomNavigationBar: SafeArea(
            top: false,
            child: AppPageBody(
              shrinkWrap: true,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _openLobbyInfoSheet,
                        icon: const Icon(Icons.info_outline),
                        label: const Text('Infos'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _openChatSheet,
                        icon: Badge(
                          isLabelVisible: unreadCount > 0,
                          label: Text(
                            unreadCount > 99 ? '99+' : '$unreadCount',
                          ),
                          child: const Icon(Icons.chat_bubble_outline),
                        ),
                        label: const Text('Chat'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          body: _controller.isLoading
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Connexion au serveur de jeu...'),
                    ],
                  ),
                )
              : AppPageBody(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                    children: [
                      if (_controller.error != null)
                        AppNotice(message: _controller.error!, isError: true),
                      _buildJoinCodeCard(),
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
                                  config?.mapRadius ??
                                  bootstrap!.form!.mapRadius,
                              outerStreetContour:
                                  config?.mapStreets ??
                                  bootstrap!.outerStreetContour,
                              objectives: _resolveHostObjectives(
                                isHost: _controller.isHost,
                                bootstrap: bootstrap,
                                config: config,
                              ),
                              agentStartZone:
                                  config?.startZone ??
                                  bootstrap?.agentStartZone,
                              rogueStartZone:
                                  config?.rogueStartZone ??
                                  bootstrap?.rogueStartZone,
                              objectiveZoneRadiusMeters:
                                  config?.objectiveZoneRadius ??
                                  bootstrap!.form!.objectiveZoneRadius,
                              streetNetwork:
                                  config?.mapStreetNetwork ??
                                  const <List<GeoPoint>>[],
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
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Padding(
                                padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
                                child: Text(
                                  'Joueurs (${_controller.players.length})',
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w600),
                                ),
                              ),
                              for (
                                var i = 0;
                                i < _controller.players.length;
                                i++
                              ) ...[
                                if (i > 0)
                                  Divider(
                                    height: 1,
                                    indent: 8,
                                    endIndent: 8,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.outlineVariant,
                                  ),
                                _buildPlayerTile(_controller.players[i]),
                              ],
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
                                LobbyStartRequirements(
                                  players: _controller.players,
                                ),
                                const SizedBox(height: 16),
                                FilledButton(
                                  onPressed: _controller.canStartGame
                                      ? _controller.startGame
                                      : null,
                                  child: const Text('Démarrer la partie'),
                                ),
                                const SizedBox(height: 8),
                                OutlinedButton.icon(
                                  onPressed: _openHostConfigEditor,
                                  icon: const Icon(Icons.tune),
                                  label: const Text('Modifier les paramètres'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      if (_controller.gameStarted)
                        const AppNotice(message: 'Démarrage de la partie…'),
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
                ),
        );
      },
    );
  }

  Widget _buildPlayerTile(LobbyPlayer player) => LobbyPlayerRow(
    key: ValueKey(player.id),
    player: player,
    isSelf: player.id == _controller.playerId,
    voiceActive: _controller.isPlayerVoiceActive(player.id),
    onRoleChanged: _controller.isHost
        ? (role) =>
              _controller.updateRole(targetPlayerId: player.id, role: role)
        : null,
  );

  Widget _buildJoinCodeCard() {
    final code = (_controller.lobbyCode ?? '').toUpperCase();
    final codeLabel = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Code de la partie', textAlign: TextAlign.center),
        const SizedBox(height: 8),
        SelectableText(
          code,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 28,
            letterSpacing: 2,
          ),
        ),
      ],
    );
    final qrCode = Semantics(
      label: 'QR code pour rejoindre la partie $code',
      image: true,
      child: Container(
        width: 120,
        height: 120,
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
        ),
        child: QrImageView(
          data: '{"type":"lobby-join","code":"$code"}',
          version: QrVersions.auto,
          eyeStyle: const QrEyeStyle(
            eyeShape: QrEyeShape.square,
            color: Colors.black,
          ),
          dataModuleStyle: const QrDataModuleStyle(
            dataModuleShape: QrDataModuleShape.square,
            color: Colors.black,
          ),
          backgroundColor: Colors.white,
        ),
      ),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact =
                constraints.maxWidth < 340 ||
                MediaQuery.textScalerOf(context).scale(1) > 1.3;
            if (compact || code.isEmpty) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  codeLabel,
                  if (code.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Center(child: qrCode),
                  ],
                ],
              );
            }
            return Row(
              children: [
                Expanded(child: codeLabel),
                const SizedBox(width: 16),
                qrCode,
              ],
            );
          },
        ),
      ),
    );
  }

  bool _shouldRedirectToJoinOnInitialError(LobbyBootstrapData? bootstrap) {
    return _controller.connectionStatus == 'error' &&
        !_controller.isLoading &&
        !_controller.shouldOpenGameForCode &&
        !_didRouteBackToJoinOnError &&
        bootstrap != null &&
        _controller.playerId == null &&
        _controller.players.isEmpty &&
        (_controller.error?.isNotEmpty ?? false);
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

  List<GeoPoint> _resolveHostObjectives({
    required bool isHost,
    required LobbyBootstrapData? bootstrap,
    required LobbyGameConfig? config,
  }) {
    if (!isHost) return const <GeoPoint>[];
    if (bootstrap?.objectives.isNotEmpty ?? false) {
      return bootstrap!.objectives;
    }
    return config?.objectives ?? const <GeoPoint>[];
  }

  Widget _statusChip(String status) {
    final (label, icon) = switch (status) {
      'connected' => ('En ligne', Icons.check_circle_outline),
      'connecting' => ('Connexion…', Icons.sync),
      'error' => ('Hors ligne', Icons.error_outline),
      _ => ('En attente', Icons.schedule),
    };
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 16,
          color: status == 'error' ? scheme.error : scheme.primary,
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
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
    if (_isChatOpen) return;
    setState(() {
      _isChatOpen = true;
      _lastReadCount = _controller.chatMessages.length;
    });
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => AppChatSheet(
        title: 'Chat du lobby',
        animation: _controller,
        controller: _chatController,
        compactAuthor: false,
        messageCount: () => _controller.chatMessages.length,
        messageAt: (index) {
          final message = _controller.chatMessages[index];
          return AppChatEntry(
            author: message.playerName,
            text: message.text,
            isSelf: message.playerId == _controller.playerId,
          );
        },
        onSend: _controller.sendChat,
      ),
    );
    if (!mounted) return;
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
                        '${form?.victoryConditionObjectives ?? config?.victoryConditionObjectives ?? 'n/a'}',
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
