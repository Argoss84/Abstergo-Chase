import 'package:broken_veil_protocol/shared/widgets/app_chat_sheet.dart';
import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'dart:async';
import 'dart:math';
import 'dart:convert';

import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:broken_veil_protocol/shared/services/tts_service.dart';
import 'package:broken_veil_protocol/shared/services/vibration_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_chat_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:flutter/gestures.dart' show kTouchSlop;
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:geolocator/geolocator.dart';

part 'game_page_ping.dart';
part 'game_page_compass.dart';

const String _kGameUnavailableMessage = 'Partie indisponible.';
const String _kPingPayloadPrefix = '[PING]';
const Duration _kPingPressDelay = Duration(milliseconds: 500);
const Duration _kPingVisibleDuration = Duration(seconds: 8);
const Duration _kDangerPingSoundGap = Duration(milliseconds: 90);

class _PingOption {
  const _PingOption({
    required this.id,
    required this.color,
    required this.shortMessage,
    required this.ttsMessage,
  });

  final String id;
  final Color color;
  final String shortMessage;
  final String ttsMessage;
}

class _ActiveRolePing {
  const _ActiveRolePing({
    required this.messageKey,
    required this.playerId,
    required this.playerName,
    required this.position,
    required this.color,
    required this.shortMessage,
    required this.createdAtMs,
  });

  final String messageKey;
  final String playerId;
  final String playerName;
  final GeoPoint position;
  final Color color;
  final String shortMessage;
  final int createdAtMs;
}

const double _kDefaultGameMapZoom = 16.5;
const double _kCompassCenterToleranceLatLng = 0.000001;

class GamePage extends StatefulWidget {
  const GamePage({super.key, required this.bootstrap, this.controllerFactory});

  static const String routePath = '/game';
  static const String routeName = 'game';
  final GameBootstrapData bootstrap;
  final GameController Function()? controllerFactory;

  @override
  State<GamePage> createState() => _GamePageState();
}

class _GamePageState extends State<GamePage>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final GameController _controller;
  late final AnimationController _guidancePulseController;
  bool _hasPulseEffects = false;
  bool _animationsDisabled = false;
  bool _appIsResumed = true;
  late final MapController _mapController;
  final ValueNotifier<double?> _headingDeg = ValueNotifier<double?>(null);
  String? _selectedMapPlayerId;
  StreamSubscription<CompassEvent>? _compassSub;
  final TextEditingController _chatController = TextEditingController();
  bool _chatOpen = false;
  bool _wasGameFinished = false;
  int _lastReadCount = 0;
  bool _isActionFabOpen = false;
  bool _leaveConfirmationVisible = false;
  final VibrationService _vibrationService = VibrationService();
  final TtsService _ttsService = TtsService.instance;
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  bool _prevRogueObjectiveInRange = false;
  bool _prevSelfInStartZone = false;
  final Map<String, bool> _hostPlayerInStartZone = <String, bool>{};
  int? _lastCountdownSecondVibrated;
  int? _lastCountdownSecondAnnounced;
  bool _didAnnounceCountdownGo = false;
  int _lastOutOfZoneVibrationMs = 0;
  bool _hasSpokenJoinTts = false;
  bool _gameMapRevealed = false;
  bool _compassModeEnabled = false;
  bool _isCompassRecenterScheduled = false;
  GeoPoint? _lastCompassCenteredPosition;
  GeoPoint? _pendingCompassCenteredPosition;
  bool _didRouteBackToJoinOnInitialError = false;
  bool _announcementBaselineInitialized = false;
  bool _prevAnyObjectiveCapturing = false;
  int _prevCapturedObjectivesCount = 0;
  int _prevCapturedRoguesCount = 0;
  bool _prevAllPlayersInStartZone = false;
  bool _prevGameStarted = false;
  Timer? _pingPressTimer;
  Timer? _pingExpiryTimer;
  Offset? _pingPressOrigin;
  GeoPoint? _pingLocation;
  final Set<int> _mapPointers = <int>{};
  int? _pingActivePointer;
  int? _selectedPingOptionIndex;
  bool _pingWheelVisible = false;
  int _lastPingChatIndex = 0;
  bool _pingCursorInitialized = false;
  final List<_ActiveRolePing> _activeRolePings = <_ActiveRolePing>[];

  static const List<_PingOption> _pingOptions = <_PingOption>[
    _PingOption(
      id: 'go_here',
      color: Colors.blueAccent,
      shortMessage: 'Je vais ici',
      ttsMessage: 'Je vais ici',
    ),
    _PingOption(
      id: 'need_help',
      color: Colors.orangeAccent,
      shortMessage: 'Besoin d\'aide',
      ttsMessage: 'Besoin d\'aide',
    ),
    _PingOption(
      id: 'danger',
      color: Colors.redAccent,
      shortMessage: 'Danger',
      ttsMessage: 'Danger',
    ),
    _PingOption(
      id: 'wait',
      color: Colors.greenAccent,
      shortMessage: 'Attendez',
      ttsMessage: 'Attendez',
    ),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _guidancePulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
      lowerBound: 0,
      upperBound: 1,
    );
    _pingExpiryTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final count = _activeRolePings.length;
      _pruneExpiredPings();
      if (mounted && count != _activeRolePings.length) setState(() {});
    });
    _mapController = MapController();
    _controller = (widget.controllerFactory?.call() ?? GameController())
      ..initialize(widget.bootstrap);
    _compassSub = FlutterCompass.events?.listen((event) {
      final heading = normalizeHeadingDegrees(event.heading);
      if (heading == null) return;
      _headingDeg.value = heading;
      _controller.updateHeadingDegrees(heading);
      _applyCompassRotation(heading);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _animationsDisabled = MediaQuery.disableAnimationsOf(context);
    _syncGuidancePulse();
    if (_animationsDisabled) {
      _guidancePulseController.value = 0.5;
    }
  }

  void _syncGuidancePulse() {
    if (_hasPulseEffects && !_animationsDisabled && _appIsResumed) {
      if (!_guidancePulseController.isAnimating) {
        _guidancePulseController.repeat(reverse: true);
      }
    } else {
      _guidancePulseController.stop();
    }
  }

  bool get _rogueActionReady =>
      (_controller.playerRole ?? '').toUpperCase() == 'ROGUE' &&
      _controller.canTriggerRogueObjectiveCapture;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _compassSub?.cancel();
    _pingPressTimer?.cancel();
    _pingExpiryTimer?.cancel();
    _headingDeg.dispose();
    _guidancePulseController.dispose();
    _chatController.dispose();
    _controller.dispose();
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _quitGame({required bool clearSavedLobbyCode}) async {
    _controller.leaveGame();
    if (clearSavedLobbyCode) {
      await _playerSessionStore.clearLastLobbyCode();
    }
    if (mounted) context.go('/');
  }

  Future<void> _returnToLobby() async {
    final code = await _controller.prepareNextLobby();
    if (!mounted) return;
    if (code == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Salon indisponible. Réessaie dans un instant.'),
        ),
      );
      return;
    }
    final route = Uri(path: '/join-lobby', queryParameters: {'code': code});
    context.go(route.toString());
  }

  Future<void> _confirmFinishedGameExit() async {
    if (_leaveConfirmationVisible) return;
    _leaveConfirmationVisible = true;
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Quitter la partie ?'),
          content: const Text('Vous allez revenir à l’accueil.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Annuler'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Quitter'),
            ),
          ],
        ),
      );
      if (confirmed == true && mounted) {
        await _quitGame(clearSavedLobbyCode: true);
      }
    } finally {
      _leaveConfirmationVisible = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appIsResumed = state == AppLifecycleState.resumed;
    _syncGuidancePulse();
    if (state == AppLifecycleState.resumed) {
      unawaited(_controller.onAppResumed());
    } else {
      unawaited(_controller.setPushToTalkPressed(false));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final effectiveGameConfig =
            _controller.liveGameConfig ?? widget.bootstrap.gameConfig;
        if (_wasGameFinished != _controller.isGameFinished) {
          _wasGameFinished = _controller.isGameFinished;
          _lastReadCount = 0;
        }
        final unread = _chatOpen
            ? 0
            : (_controller.visibleChat.length - _lastReadCount).clamp(0, 999);
        final fallbackCenter = _resolveCenter();
        final connectionReady = _controller.connectionStatus == 'connected';
        final realtimePositionReady = _controller.hasRealtimePosition;
        final gameReady =
            !_controller.isLoading && connectionReady && realtimePositionReady;
        if (gameReady) {
          _gameMapRevealed = true;
        }
        final roleForTts = (_controller.playerRole ?? '').trim();
        if (connectionReady && roleForTts.isNotEmpty && !_hasSpokenJoinTts) {
          _hasSpokenJoinTts = true;
          final spokenRole = roleForTts.toLowerCase();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _ttsService.speakIfEnabled(
              "Bienvenue $spokenRole, dirigez vous vers votre zone de départ",
            );
          });
        }
        if (_shouldRedirectToJoinOnInitialError()) {
          _didRouteBackToJoinOnInitialError = true;
          final gameCodeForRedirect =
              (_controller.gameCode ??
                      widget.bootstrap.codeOverride ??
                      widget.bootstrap.lobby.code)
                  .trim()
                  .toUpperCase();
          final message = _controller.error?.trim() ?? _kGameUnavailableMessage;
          final route = Uri(
            path: JoinLobbyPage.routePath,
            queryParameters: <String, String>{
              'code': gameCodeForRedirect,
              'error': message,
            },
          ).toString();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            context.go(route);
          });
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final loadingMessage = () {
          if (!connectionReady) {
            if (_controller.connectionStatus == 'connecting') {
              return 'Connexion au serveur en cours...';
            }
            if (_controller.connectionStatus == 'error') {
              return 'Impossible de se connecter au serveur.';
            }
            return 'Initialisation de la partie...';
          }
          return 'Récupération de la position en temps réel...';
        }();
        if (!_gameMapRevealed) {
          _hasPulseEffects = false;
          _syncGuidancePulse();
          return Scaffold(
            appBar: AppBar(
              title: const Text('Partie'),
              actions: [
                IconButton(
                  tooltip: 'Informations de la partie',
                  onPressed: _openGameInfo,
                  icon: const Icon(Icons.headset_mic_outlined),
                ),
              ],
            ),
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 12),
                  Text(loadingMessage),
                ],
              ),
            ),
          );
        }
        final winnerTypeForLayout = _controller.winnerType;
        final topInset =
            MediaQuery.of(context).padding.top +
            kToolbarHeight +
            40 +
            (winnerTypeForLayout == null ? 46 : 0) +
            8;
        final objectiveZoneRadius =
            effectiveGameConfig?.objectiveZoneRadius ??
            widget.bootstrap.lobby.form?.objectiveZoneRadius ??
            CreateLobbyDefaults.objectiveZoneRadius;
        final roleUpper = (_controller.playerRole ?? '').toUpperCase();
        final isRogue = roleUpper == 'ROGUE';
        final guidanceColor = isRogue ? Colors.green : Colors.blue;
        final rogueCaptureRemaining = _controller.rogueCaptureRemainingSeconds;
        final rogueCaptureProgress = _controller.rogueCaptureProgress;
        final winnerType = _controller.winnerType;
        final winnerReason = (_controller.winnerReason ?? '').toUpperCase();
        final outOfZone = _controller.isOutOfGameZone;
        final reentryPoint = _controller.reentryPoint;
        final objectiveIntrusions = _controller.objectiveIntrusions;
        final myPos = _controller.myPosition;
        _syncCompassMapCenter(myPos);
        final startCountdownSeconds = _startCountdownSeconds();
        final activeAudiblePlayers = _controller.activeAudibleVoicePlayers;
        _handleGameVibrationSignals(
          startCountdownSeconds: startCountdownSeconds,
          outOfZone: outOfZone,
          winnerType: winnerType,
        );
        _handleGameAnnouncements(
          startCountdownSeconds: startCountdownSeconds,
          winnerType: winnerType,
        );
        _syncIncomingPingMessages();
        _pruneExpiredPings();
        _handleStartCountdownAudioSignals(
          startCountdownSeconds: startCountdownSeconds,
          winnerType: winnerType,
        );
        final objectiveDisplayPoints = _controller.objectives
            .where((o) => !o.captured)
            .map((o) => o.point)
            .toList(growable: false);
        final capturedObjectiveDisplayPoints = _controller.objectives
            .where((o) => o.captured)
            .map((o) => o.point)
            .toList(growable: false);
        final capturingDisplayPoints = _controller.objectives
            .where((o) => o.state.toUpperCase() == 'CAPTURING')
            .map((o) => o.point)
            .toList(growable: false);

        final guidancePath = _controller.isGameFinished
            ? _controller.buildPathToRallyPoint()
            : reentryPoint != null
            ? _controller.buildPathToReentryPoint()
            : _controller.gameStarted
            ? const <GeoPoint>[]
            : _controller.buildPathToMyStartZone();
        _hasPulseEffects =
            (fallbackCenter != null &&
                (guidancePath.length >= 2 ||
                    capturingDisplayPoints.isNotEmpty ||
                    _activeRolePings.isNotEmpty ||
                    _controller.rallyPoint != null)) ||
            (winnerType == null &&
                (startCountdownSeconds != null ||
                    (_isActionFabOpen && _rogueActionReady)));
        _syncGuidancePulse();

        return Scaffold(
          extendBodyBehindAppBar: true,
          appBar: AppBar(
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            foregroundColor: Colors.white,
            backgroundColor: const Color(0xFF10162A),
            systemOverlayStyle: SystemUiOverlayStyle.light,
            title: Row(
              children: [
                _buildRoleTitleIcon(),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _controller.remainingSeconds == null
                        ? (_controller.playerRole ?? 'Partie')
                        : _formatDuration(_controller.remainingSeconds!),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              ],
            ),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(40),
              child: SizedBox(
                height: 40,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: _buildAppBarStatusBadges(winnerType),
                ),
              ),
            ),
            actions: [
              IconButton(
                tooltip: _compassModeEnabled
                    ? 'Désactiver mode boussole'
                    : 'Activer mode boussole',
                onPressed: _toggleCompassMode,
                icon: Icon(
                  _compassModeEnabled ? Icons.explore : Icons.explore_off,
                ),
              ),
              IconButton(
                tooltip: 'Quitter la partie',
                onPressed: winnerType == null
                    ? () => _quitGame(clearSavedLobbyCode: false)
                    : _confirmFinishedGameExit,
                icon: const Icon(Icons.logout),
              ),
            ],
          ),
          floatingActionButtonLocation: winnerType == null
              ? FloatingActionButtonLocation.endFloat
              : FloatingActionButtonLocation.centerFloat,
          floatingActionButton: Wrap(
            direction: winnerType == null ? Axis.vertical : Axis.horizontal,
            spacing: 10,
            children: [
              FloatingActionButton(
                heroTag: 'game-chat-fab',
                tooltip: winnerType == null
                    ? 'Chat équipe'
                    : 'Chat de fin de partie',
                onPressed: _openChat,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.forum_outlined),
                    if (unread > 0)
                      Positioned(
                        right: -8,
                        top: -8,
                        child: CircleAvatar(
                          radius: 10,
                          backgroundColor: Colors.red,
                          child: Text(
                            unread > 99 ? '99+' : '$unread',
                            style: const TextStyle(
                              fontSize: 10,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              FloatingActionButton(
                heroTag: 'game-info-fab',
                tooltip: 'Informations de la partie',
                onPressed: _openGameInfo,
                child: const Icon(Icons.headset_mic_outlined),
              ),
              if (_controller.voiceMode ==
                  VoiceTransmissionMode.pushToTalk) ...[
                _buildPushToTalkFab(),
              ],
            ],
          ),
          body: Stack(
            children: [
              Stack(
                children: [
                  Positioned.fill(
                    child: fallbackCenter == null
                        ? const Center(child: Text('Carte indisponible'))
                        : LobbyMapPreview(
                            mapController: _mapController,
                            height: null,
                            center: fallbackCenter,
                            initialCameraCenter: _controller.myPosition,
                            mapRadiusMeters:
                                effectiveGameConfig?.mapRadius ??
                                widget.bootstrap.lobby.form?.mapRadius ??
                                CreateLobbyDefaults.mapRadius,
                            outerStreetContour:
                                effectiveGameConfig?.mapStreets.isNotEmpty ==
                                    true
                                ? effectiveGameConfig!.mapStreets
                                : widget.bootstrap.lobby.outerStreetContour,
                            objectives: objectiveDisplayPoints,
                            inactiveObjectives: capturedObjectiveDisplayPoints,
                            agentStartZone:
                                effectiveGameConfig?.startZone ??
                                widget.bootstrap.lobby.agentStartZone,
                            rogueStartZone:
                                effectiveGameConfig?.rogueStartZone ??
                                widget.bootstrap.lobby.rogueStartZone,
                            rogueStartZonePlayable:
                                effectiveGameConfig?.rogueStartZonePlayable ??
                                widget.bootstrap.lobby.rogueStartZonePlayable,
                            objectiveZoneRadiusMeters: objectiveZoneRadius,
                            streetNetwork:
                                effectiveGameConfig?.mapStreetNetwork ??
                                const <List<GeoPoint>>[],
                            startZoneRadiusMeters:
                                effectiveGameConfig?.startZoneRadius ??
                                widget.bootstrap.lobby.form?.startZoneRadius ??
                                25,
                            showObjectives: true,
                            showObjectiveMarkers: isRogue,
                            showObjectiveZones: !isRogue,
                            objectiveMarkerIcon: isRogue
                                ? Icons.location_on
                                : Icons.adjust,
                            objectiveMarkerColor: isRogue
                                ? Colors.purpleAccent
                                : Colors.red,
                            objectiveMarkerSize: isRogue ? 30 : 18,
                            guidancePath: guidancePath,
                            guidancePathColor:
                                _controller.isGameFinished ||
                                    reentryPoint != null
                                ? Colors.amber
                                : guidanceColor,
                            guidancePathDotted: true,
                            effectsAnimation: _guidancePulseController,
                            highlightObjectiveZones: capturingDisplayPoints,
                            highlightObjectiveZoneRadiusMeters:
                                objectiveZoneRadius,
                            showCenterMarker: false,
                            pingMarkers: _activeRolePings
                                .map(
                                  (ping) => MapPingMarker(
                                    point: ping.position,
                                    color: ping.color,
                                    playerName: ping.playerName,
                                    message: ping.shortMessage,
                                    pulseValue: _pingPulseFor(ping.createdAtMs),
                                  ),
                                )
                                .followedBy(<MapPingMarker>[
                                  if (winnerType != null &&
                                      _controller.rallyPoint != null)
                                    MapPingMarker(
                                      point: _controller.rallyPoint!,
                                      color: Colors.amber,
                                      playerName: 'Rendez-vous',
                                      message: '',
                                      pulseValue:
                                          _guidancePulseController.value,
                                    ),
                                  if (winnerType == null &&
                                      reentryPoint != null)
                                    MapPingMarker(
                                      point: reentryPoint,
                                      color: Colors.amber,
                                      playerName: 'Point de retour',
                                      message: '',
                                    ),
                                ])
                                .toList(growable: false),
                            selectedPlayerId: _selectedMapPlayerId,
                            onPlayerTap: _selectMapPlayer,
                            onMapTap: (_, _) => _selectMapPlayer(null),
                            onMapPointerDown: _onMapPointerDown,
                            onMapPointerMove: _onMapPointerMove,
                            onMapPointerUp: _onMapPointerUp,
                            onMapPointerCancel: _onMapPointerCancel,
                            playerMarkers: _controller.mapMarkerPlayers
                                .map(
                                  (p) => PlayerMapMarker(
                                    id: p.id,
                                    name: p.name,
                                    point: GeoPoint(
                                      latitude: p.latitude!,
                                      longitude: p.longitude!,
                                    ),
                                    isAgent:
                                        (p.role ?? '').toUpperCase() == 'AGENT',
                                    headingDegrees: p.headingDegrees,
                                    liveHeadingDegrees:
                                        p.id == _controller.playerId
                                        ? _headingDeg
                                        : null,
                                    aura: p.id == _controller.playerId
                                        ? PlayerMarkerAura.selfBlue
                                        : ((p.role ?? '').toUpperCase() ==
                                                  roleUpper
                                              ? PlayerMarkerAura.allyGreen
                                              : PlayerMarkerAura.none),
                                  ),
                                )
                                .toList(growable: false),
                          ),
                  ),
                  if (_pingWheelVisible && _pingPressOrigin != null)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: CustomPaint(
                          key: const ValueKey('ping-wheel'),
                          painter: _PingWheelPainter(
                            center: _pingPressOrigin!,
                            options: _pingOptions,
                            highlightedIndex: _selectedPingOptionIndex,
                          ),
                        ),
                      ),
                    ),
                  if (winnerType == null)
                    Positioned(
                      top:
                          MediaQuery.of(context).padding.top +
                          kToolbarHeight +
                          40,
                      left: 0,
                      right: 0,
                      child: ValueListenableBuilder<double?>(
                        valueListenable: _headingDeg,
                        builder: (context, heading, _) {
                          return _CompassBanner(
                            roleUpper: roleUpper,
                            headingDeg: heading,
                            myPosition: myPos,
                            players: _controller.players
                                .map(_controller.playerWithDisplayPosition)
                                .toList(growable: false),
                            objectives: _controller.objectives,
                            selfPlayerId: _controller.playerId,
                          );
                        },
                      ),
                    ),
                  if (_controller.error != null)
                    Positioned(
                      top: topInset,
                      left: 12,
                      right: 12,
                      child: AppNotice(
                        message: _controller.error!,
                        isError: true,
                      ),
                    ),
                  if (winnerType == null && _controller.error == null)
                    if (outOfZone || objectiveIntrusions.isNotEmpty)
                      Positioned(
                        top: topInset,
                        left: 12,
                        right: 12,
                        child: AppNotice(
                          isError: outOfZone,
                          message: outOfZone
                              ? (reentryPoint == null
                                    ? 'Entrez dans la zone de jeu.'
                                    : 'Revenez par votre point de sortie pour reprendre le jeu.')
                              : 'Rogue détecté · ${objectiveIntrusions.join(', ')}',
                        ),
                      ),
                  if (winnerType == null && startCountdownSeconds != null)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: Container(
                          color: Colors.black.withValues(alpha: 0.55),
                          child: Center(
                            child: AnimatedBuilder(
                              animation: _guidancePulseController,
                              builder: (context, child) => Transform.scale(
                                scale:
                                    0.96 +
                                    (_guidancePulseController.value * 0.1),
                                child: child,
                              ),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 18,
                                  vertical: 16,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.95),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: Colors.black.withValues(alpha: 0.22),
                                    width: 1.3,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(
                                        alpha: 0.28,
                                      ),
                                      blurRadius: 16,
                                      spreadRadius: 0.8,
                                    ),
                                  ],
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Text(
                                      'La partie commence dans…',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w900,
                                        color: Color(0xFF111827),
                                      ),
                                    ),
                                    const SizedBox(height: 10),
                                    Stack(
                                      alignment: Alignment.center,
                                      children: [
                                        Text(
                                          '$startCountdownSeconds',
                                          style: TextStyle(
                                            fontSize: 60,
                                            fontWeight: FontWeight.w900,
                                            foreground: Paint()
                                              ..style = PaintingStyle.stroke
                                              ..strokeWidth = 6
                                              ..color = Colors.black87,
                                          ),
                                        ),
                                        Text(
                                          '$startCountdownSeconds',
                                          style: const TextStyle(
                                            fontSize: 60,
                                            fontWeight: FontWeight.w900,
                                            color: Color(0xFFB91C1C),
                                            shadows: [
                                              Shadow(
                                                color: Colors.black45,
                                                offset: Offset(0, 2),
                                                blurRadius: 5,
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (isRogue && rogueCaptureRemaining != null)
                    Positioned(
                      top: topInset,
                      left: 12,
                      right: 12,
                      child: _buildRogueCaptureFeedback(
                        remainingSeconds: rogueCaptureRemaining,
                        progress: rogueCaptureProgress,
                      ),
                    ),
                  if (isRogue &&
                      rogueCaptureRemaining == null &&
                      _controller.showRogueCaptureInterruptedBanner)
                    Positioned(
                      top: topInset,
                      left: 12,
                      right: 12,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade800.withValues(alpha: 0.9),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.warning_amber, color: Colors.white),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Capture interrompue: vous êtes sorti de la zone.',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (_controller.isHost && !_controller.gameStarted)
                    Positioned(
                      top: topInset,
                      left: 12,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            maxWidth: min(
                              260,
                              MediaQuery.sizeOf(context).width - 32,
                            ),
                            maxHeight: MediaQuery.sizeOf(context).height * 0.35,
                          ),
                          child: SingleChildScrollView(
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              color: const Color(
                                0xFF10162A,
                              ).withValues(alpha: 0.94),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  ..._controller.players
                                      .where(
                                        (player) =>
                                            player.status.toLowerCase() !=
                                            'disconnected',
                                      )
                                      .map((player) {
                                        final inZone = _controller
                                            .isPlayerInStartZone(player);
                                        final role = (player.role ?? '')
                                            .toUpperCase();
                                        final roleShort = role == 'ROGUE'
                                            ? 'r'
                                            : role == 'AGENT'
                                            ? 'a'
                                            : '-';
                                        return Padding(
                                          padding: const EdgeInsets.only(
                                            bottom: 4,
                                          ),
                                          child: Text(
                                            '${player.name} [$roleShort]',
                                            style: TextStyle(
                                              color: inZone
                                                  ? Colors.greenAccent
                                                  : Colors.redAccent,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        );
                                      }),
                                  const SizedBox(height: 6),
                                  FilledButton(
                                    onPressed: _controller.canHostStartGame
                                        ? _controller.startGameFromHost
                                        : null,
                                    child: Text(
                                      _controller.canHostStartGame
                                          ? 'Démarrer'
                                          : 'En attente',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  if ((!_controller.isHost || _controller.gameStarted) &&
                      activeAudiblePlayers.isNotEmpty)
                    Positioned(
                      top: topInset,
                      left: 12,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            maxWidth: min(
                              260,
                              MediaQuery.sizeOf(context).width - 32,
                            ),
                            maxHeight: MediaQuery.sizeOf(context).height * 0.35,
                          ),
                          child: SingleChildScrollView(
                            child: Container(
                              width: 260,
                              padding: const EdgeInsets.all(8),
                              color: const Color(
                                0xFF10162A,
                              ).withValues(alpha: 0.94),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  ...activeAudiblePlayers.map((player) {
                                    return Container(
                                      margin: const EdgeInsets.only(bottom: 4),
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 4,
                                      ),
                                      decoration: BoxDecoration(
                                        color: Colors.cyanAccent.withValues(
                                          alpha: 0.18,
                                        ),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(
                                          color: Colors.cyanAccent,
                                          width: 1,
                                        ),
                                      ),
                                      child: Row(
                                        children: [
                                          Icon(
                                            Icons.graphic_eq,
                                            size: 16,
                                            color: Colors.cyanAccent,
                                          ),
                                          const SizedBox(width: 6),
                                          Expanded(
                                            child: Text(
                                              player.name,
                                              style: TextStyle(
                                                color: Colors.cyanAccent,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    );
                                  }),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              if (!_controller.isLoading)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: MediaQuery.paddingOf(context).bottom + 16,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child:
                        winnerType == null &&
                            !(_controller.gameStarted && outOfZone)
                        ? RepaintBoundary(child: _buildActionFabMenu())
                        : const SizedBox.shrink(),
                  ),
                ),
              if (winnerType != null)
                Positioned(
                  top: topInset,
                  left: 16,
                  right: 16,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: _buildRallyCard(winnerType, winnerReason),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  bool _shouldRedirectToJoinOnInitialError() {
    final error = _controller.error?.trim();
    if (error == null || error.isEmpty) {
      return false;
    }
    return !_didRouteBackToJoinOnInitialError &&
        widget.bootstrap.fromCodeLookupFallback &&
        !_controller.isLoading &&
        _controller.connectionStatus == 'error';
  }

  String _formatDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Widget _buildGamePhaseBadge({bool compactForAppBar = false}) {
    final isConvergence = !_controller.gameStarted;
    final color = isConvergence
        ? const Color(0xFF92400E)
        : const Color(0xFF166534);
    final label = isConvergence
        ? (compactForAppBar ? 'Conv.' : 'Convergence')
        : (compactForAppBar ? 'En cours' : 'Partie en cours');
    final icon = isConvergence ? Icons.groups_2 : Icons.play_arrow_rounded;

    return Container(
      padding: compactForAppBar
          ? const EdgeInsets.symmetric(horizontal: 8, vertical: 4)
          : const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.35),
          width: 1,
        ),
        boxShadow: compactForAppBar
            ? null
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.22),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: compactForAppBar ? 12 : 14, color: Colors.white),
          compactForAppBar
              ? const SizedBox(width: 4)
              : const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: Colors.white,
              fontSize: compactForAppBar ? 11 : 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleTitleIcon() {
    final role = (_controller.playerRole ?? '').toUpperCase();
    final label = role.isEmpty ? 'N/A' : role;
    final asset = _roleMarkerAssetFor(role);
    return Tooltip(
      message: label,
      child: asset == null
          ? const Icon(Icons.help_outline, size: 28, color: Colors.white70)
          : SizedBox(
              width: 28,
              height: 28,
              child: Image.asset(
                asset,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
                errorBuilder: (context, _, _) => const Icon(
                  Icons.help_outline,
                  size: 28,
                  color: Colors.white70,
                ),
              ),
            ),
    );
  }

  String? _roleMarkerAssetFor(String role) {
    switch (role) {
      case 'AGENT':
        return 'assets/images/agent_marker.png';
      case 'ROGUE':
        return 'assets/images/rogue_marker.png';
      default:
        return null;
    }
  }

  Widget _buildAppBarStatusBadges(String? winnerType) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (winnerType == null) ...[
          _buildGamePhaseBadge(compactForAppBar: true),
          const SizedBox(width: 6),
        ],
        _buildConnectionBadge(),
      ],
    );
  }

  Widget _buildConnectionBadge() {
    final status = _controller.connectionStatus;
    late final Color backgroundColor;
    late final String label;
    late final IconData icon;
    switch (status) {
      case 'connected':
        backgroundColor = const Color(0xFF166534);
        label = 'En ligne';
        icon = Icons.check_circle;
        break;
      case 'connecting':
        backgroundColor = const Color(0xFF9A3412);
        label = 'Connexion';
        icon = Icons.sync;
        break;
      case 'error':
        backgroundColor = Colors.red.shade700;
        label = 'Hors ligne';
        icon = Icons.error_outline;
        break;
      case 'closed':
        backgroundColor = Colors.grey.shade700;
        label = 'Déconnecté';
        icon = Icons.cancel_outlined;
        break;
      default:
        backgroundColor = Colors.blueGrey.shade700;
        label = 'Attente';
        icon = Icons.hourglass_bottom;
        break;
    }
    const foregroundColor = Colors.white;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: backgroundColor.withValues(alpha: 0.92),
        border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(999),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 4,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: foregroundColor),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: foregroundColor,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRogueCaptureFeedback({
    required int remainingSeconds,
    required double progress,
  }) {
    final clamped = remainingSeconds < 0 ? 0 : remainingSeconds;
    final clampedProgress = progress < 0
        ? 0.0
        : (progress > 1 ? 1.0 : progress);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.red.shade700.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(10),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.redAccent.withValues(alpha: 0.45),
            blurRadius: 14,
            spreadRadius: 1,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(Icons.terminal, color: Colors.white),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Capture en cours... ${clamped}s',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                '${(clampedProgress * 100).round()}%',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              minHeight: 8,
              value: clampedProgress,
              backgroundColor: Colors.white.withValues(alpha: 0.25),
              valueColor: const AlwaysStoppedAnimation<Color>(
                Colors.orangeAccent,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionFabMenu() {
    final role = (_controller.playerRole ?? '').toUpperCase();
    final roleActionIcon = role == 'ROGUE'
        ? Icons.terminal
        : Icons.center_focus_strong;
    final roleActionLabel = role == 'ROGUE'
        ? 'Pirater un objectif'
        : 'Cibler un Rogue';
    final rogueActionReady = _rogueActionReady;
    return SizedBox(
      width: 280,
      height: 220,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          if (_isActionFabOpen)
            _fanSecondaryFab(
              left: 36,
              bottom: 78,
              child: _miniActionFab(
                icon: Icons.qr_code_2,
                tooltip: 'QR de vitalité',
                onTap: _openVitalityQr,
              ),
            ),
          if (_isActionFabOpen)
            _fanSecondaryFab(
              left: 78,
              bottom: 126,
              child: _miniActionFab(
                icon: _controller.isMicrophoneEnabled
                    ? Icons.mic_outlined
                    : Icons.mic_off_outlined,
                tooltip: _controller.isMicrophoneEnabled
                    ? 'Couper le micro'
                    : 'Activer le micro',
                onTap: () {
                  _controller.toggleVoiceChatEnabled();
                  setState(() => _isActionFabOpen = false);
                },
              ),
            ),
          if (_isActionFabOpen)
            _fanSecondaryFab(
              right: 78,
              bottom: 126,
              child: _miniActionFab(
                icon: Icons.my_location,
                tooltip: 'Recentrer sur ma position',
                onTap: _recenterMapOnPlayer,
              ),
            ),
          if (_isActionFabOpen)
            _fanSecondaryFab(
              right: 36,
              bottom: 78,
              child: _miniActionFab(
                icon: roleActionIcon,
                tooltip: roleActionLabel,
                onTap: () {
                  if (role == 'ROGUE') {
                    if (!_controller.gameStarted) {
                      _showFabPlaceholder('Partie non démarrée');
                      return;
                    }
                    if (_controller.isAnyObjectiveCapturing) {
                      _showFabPlaceholder('Capture déjà en cours');
                      return;
                    }
                    if (!_controller.canTriggerRogueObjectiveCapture) {
                      _showFabPlaceholder('Aucun objectif a portée');
                      return;
                    }
                    setState(() => _isActionFabOpen = false);
                    _controller.triggerRogueSpecialAction();
                    return;
                  }
                  _openAgentTargetCaptureModal();
                },
                backgroundColor: rogueActionReady
                    ? Colors.red.shade700
                    : Colors.white,
                foregroundColor: rogueActionReady
                    ? Colors.white
                    : Colors.black87,
                pulseAura: rogueActionReady,
              ),
            ),
          Positioned(
            bottom: 16,
            left: 0,
            right: 0,
            child: Center(
              child: FloatingActionButton(
                heroTag: 'game-action-menu',
                mini: true,
                tooltip: _isActionFabOpen
                    ? 'Fermer les actions'
                    : 'Ouvrir les actions',
                onPressed: () =>
                    setState(() => _isActionFabOpen = !_isActionFabOpen),
                child: Icon(
                  _isActionFabOpen
                      ? Icons.close_rounded
                      : Icons.grid_view_rounded,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPushToTalkFab() {
    final enabled = _controller.isMicrophoneEnabled;
    return Listener(
      onPointerDown: (_) {
        if (!enabled) return;
        _controller.setPushToTalkPressed(true);
      },
      onPointerUp: (_) {
        _controller.setPushToTalkPressed(false);
      },
      onPointerCancel: (_) {
        _controller.setPushToTalkPressed(false);
      },
      child: FloatingActionButton(
        heroTag: 'game-ptt-fab',
        tooltip: enabled
            ? 'Maintenir pour parler'
            : 'Activez le micro pour parler',
        onPressed: () {},
        backgroundColor: enabled ? Colors.orangeAccent : Colors.grey,
        foregroundColor: Colors.black87,
        child: Icon(
          enabled ? Icons.record_voice_over_outlined : Icons.mic_off_outlined,
        ),
      ),
    );
  }

  Widget _fanSecondaryFab({
    double? left,
    double? right,
    required double bottom,
    required Widget child,
  }) {
    return Positioned(left: left, right: right, bottom: bottom, child: child);
  }

  Widget _miniActionFab({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
    Color backgroundColor = Colors.white,
    Color foregroundColor = Colors.black87,
    bool pulseAura = false,
  }) {
    final button = FloatingActionButton(
      heroTag: 'game-action-${icon.codePoint}-$tooltip',
      mini: true,
      tooltip: tooltip,
      onPressed: onTap,
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      child: Icon(icon),
    );
    if (!pulseAura) return button;
    return AnimatedBuilder(
      animation: _guidancePulseController,
      child: button,
      builder: (context, child) {
        final pulse = _guidancePulseController.value;
        return DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: Colors.redAccent.withValues(
                  alpha: 0.35 + (pulse * 0.45),
                ),
                blurRadius: 8 + (pulse * 14),
                spreadRadius: 1 + (pulse * 4),
              ),
            ],
          ),
          child: child,
        );
      },
    );
  }

  void _showFabPlaceholder(String label) {
    setState(() => _isActionFabOpen = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label: fonctionnalité bientôt disponible.')),
    );
  }

  void _recenterMapOnPlayer() {
    setState(() => _isActionFabOpen = false);
    final target = _controller.myPosition ?? _resolveCenter();
    if (target == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Position joueur indisponible.')),
      );
      return;
    }
    _mapController.move(
      LatLng(target.latitude, target.longitude),
      _kDefaultGameMapZoom,
    );
  }

  void _toggleCompassMode() {
    setState(() {
      _compassModeEnabled = !_compassModeEnabled;
      if (!_compassModeEnabled) {
        _isCompassRecenterScheduled = false;
        _lastCompassCenteredPosition = null;
        _pendingCompassCenteredPosition = null;
      }
    });
    if (!_compassModeEnabled) {
      _mapController.rotate(0);
      return;
    }
    _syncCompassMapCenter(_controller.myPosition);
    _applyCompassRotation(_headingDeg.value);
  }

  void _applyCompassRotation(double? heading) {
    if (!_compassModeEnabled || heading == null || !heading.isFinite) return;
    // Keep player forward direction at top of screen.
    _mapController.rotate(-heading);
  }

  void _syncCompassMapCenter(GeoPoint? playerPosition) {
    if (!_compassModeEnabled ||
        playerPosition == null ||
        !playerPosition.isValid) {
      return;
    }
    if (_sameGeoPoint(_lastCompassCenteredPosition, playerPosition)) return;
    _lastCompassCenteredPosition = playerPosition;
    _pendingCompassCenteredPosition = playerPosition;
    if (_isCompassRecenterScheduled) return;
    _isCompassRecenterScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _isCompassRecenterScheduled = false;
      if (!mounted || !_compassModeEnabled) return;
      final target = _pendingCompassCenteredPosition;
      _pendingCompassCenteredPosition = null;
      if (target == null) return;
      final zoom = _currentMapZoom();
      _mapController.move(LatLng(target.latitude, target.longitude), zoom);
    });
  }

  double _currentMapZoom() {
    try {
      final zoom = _mapController.camera.zoom;
      return zoom.isFinite && zoom > 0 ? zoom : _kDefaultGameMapZoom;
    } catch (_) {
      return _kDefaultGameMapZoom;
    }
  }

  bool _sameGeoPoint(GeoPoint? a, GeoPoint? b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    // ~11 cm in latitude at the equator; this filters insignificant GPS jitter
    // while keeping effective player movement responsive in compass-follow mode.
    return (a.latitude - b.latitude).abs() < _kCompassCenterToleranceLatLng &&
        (a.longitude - b.longitude).abs() < _kCompassCenterToleranceLatLng;
  }

  Future<void> _openVitalityQr() async {
    setState(() => _isActionFabOpen = false);
    final payload = _buildVitalityQrPayload();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return Dialog(
          insetPadding: const EdgeInsets.symmetric(
            horizontal: 24,
            vertical: 24,
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Identifiant Vitalité',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                QrImageView(
                  data: payload,
                  version: QrVersions.auto,
                  size: 220,
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
                const SizedBox(height: 10),
                Text(
                  (_controller.gameCode ?? widget.bootstrap.lobby.code)
                      .toUpperCase(),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Fermer'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _buildVitalityQrPayload() {
    final selfId = _controller.playerId ?? '';
    final self = _controller.players.where((p) => p.id == selfId).toList();
    final playerName = self.isNotEmpty ? self.first.name : 'Joueur';
    return jsonEncode(<String, dynamic>{
      'type': 'player-vitality-id',
      'gameCode': (_controller.gameCode ?? widget.bootstrap.lobby.code)
          .toUpperCase(),
      'playerId': selfId,
      'playerName': playerName,
      'role': (_controller.playerRole ?? '').toUpperCase(),
    });
  }

  Future<void> _openAgentTargetCaptureModal() async {
    setState(() => _isActionFabOpen = false);
    if ((_controller.playerRole ?? '').toUpperCase() != 'AGENT') {
      _showFabPlaceholder('Action réservée agent');
      return;
    }
    if (!_controller.gameStarted) {
      _showFabPlaceholder('Partie non démarrée');
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                return ValueListenableBuilder<double?>(
                  valueListenable: _headingDeg,
                  builder: (context, heading, _) {
                    final targeting = _controller.getRogueTargetForHeading(
                      heading,
                    );
                    final maxCaptureDistance =
                        _controller.configuredAgentTargetingRangeMeters;
                    final distance = targeting.distanceMeters;
                    final angle = targeting.angularDeltaDeg;
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Capture Rogue par ciblage',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Visez le rogue avec le haut du téléphone '
                          '(distance <= ${maxCaptureDistance.toStringAsFixed(0)} m).',
                        ),
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: targeting.isValid
                                ? Colors.green.withValues(alpha: 0.15)
                                : Colors.orange.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: targeting.isValid
                                  ? Colors.green
                                  : Colors.orange,
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                targeting.targetPlayerName == null
                                    ? 'Aucune cible'
                                    : 'Cible: ${targeting.targetPlayerName}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (distance != null)
                                Text(
                                  'Distance: ${distance.toStringAsFixed(1)} m',
                                ),
                              if (angle != null)
                                Text(
                                  'Écart visée: ${angle.toStringAsFixed(1)}°',
                                ),
                              Text(
                                targeting.isValid
                                    ? 'Ciblage valide'
                                    : (targeting.reason ?? 'Ciblage invalide'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => Navigator.of(context).pop(),
                                child: const Text('Fermer'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed:
                                    targeting.isValid &&
                                        targeting.targetPlayerId != null
                                    ? () {
                                        final feedback = _controller
                                            .triggerAgentCaptureFromTarget(
                                              targetPlayerId:
                                                  targeting.targetPlayerId!,
                                              headingDeg: _headingDeg.value,
                                            );
                                        if (!mounted) return;
                                        ScaffoldMessenger.of(
                                          context,
                                        ).showSnackBar(
                                          SnackBar(content: Text(feedback)),
                                        );
                                        if (feedback.contains('envoyée')) {
                                          Navigator.of(context).pop();
                                        }
                                      }
                                    : null,
                                icon: const Icon(Icons.gps_fixed),
                                label: const Text('Capturer'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        );
      },
    );
  }

  GeoPoint? _resolveCenter() {
    final effectiveGameConfig =
        _controller.liveGameConfig ?? widget.bootstrap.gameConfig;
    if (effectiveGameConfig != null && effectiveGameConfig.mapCenter.isValid) {
      return effectiveGameConfig.mapCenter;
    }
    final form = widget.bootstrap.lobby.form;
    if (form != null) {
      final center = GeoPoint.tryParse(
        form.mapCenterLatitude,
        form.mapCenterLongitude,
      );
      if (center != null) return center;
    }
    return [
      ...widget.bootstrap.lobby.objectives,
      widget.bootstrap.lobby.agentStartZone,
      widget.bootstrap.lobby.rogueStartZone,
      ...widget.bootstrap.lobby.outerStreetContour,
      _controller.myPosition,
    ].whereType<GeoPoint>().where((point) => point.isValid).firstOrNull;
  }

  void _selectMapPlayer(String? id) {
    final selected = id == _selectedMapPlayerId ? null : id;
    if (selected == _selectedMapPlayerId) return;
    setState(() => _selectedMapPlayerId = selected);
  }

  void _onMapPointerDown(PointerDownEvent event, LatLng point) {
    _mapPointers.add(event.pointer);
    _pingPressTimer?.cancel();
    if (_mapPointers.length > 1) {
      _resetPingWheel();
      return;
    }
    _pingActivePointer = event.pointer;
    _pingPressOrigin = event.localPosition;
    _pingLocation = GeoPoint(
      latitude: point.latitude,
      longitude: point.longitude,
    );
    _selectedPingOptionIndex = null;
    _pingWheelVisible = false;
    _pingPressTimer = Timer(_kPingPressDelay, () {
      if (!mounted || _pingActivePointer != event.pointer) return;
      setState(() => _pingWheelVisible = true);
    });
  }

  void _onMapPointerMove(PointerMoveEvent event, LatLng point) {
    if (_pingActivePointer != event.pointer) return;
    final origin = _pingPressOrigin;
    if (origin == null) return;
    final vector = event.localPosition - origin;
    final distance = vector.distance;
    if (!_pingWheelVisible) {
      if (distance > kTouchSlop) {
        _pingPressTimer?.cancel();
        _resetPingWheel();
      }
      return;
    }
    int? nextIndex;
    if (distance >= 26 && _pingOptions.isNotEmpty) {
      final angle = (atan2(vector.dy, vector.dx) + (2 * pi)) % (2 * pi);
      final sector = (angle / ((2 * pi) / _pingOptions.length)).floor();
      nextIndex = sector.clamp(0, _pingOptions.length - 1);
    }
    if (_selectedPingOptionIndex != nextIndex) {
      setState(() => _selectedPingOptionIndex = nextIndex);
    }
  }

  void _onMapPointerUp(PointerUpEvent event, LatLng point) {
    _mapPointers.remove(event.pointer);
    if (_pingActivePointer != event.pointer) return;
    _pingPressTimer?.cancel();
    final selectedIndex = _selectedPingOptionIndex;
    final pingPoint = _pingLocation;
    final shouldTrigger =
        _pingWheelVisible &&
        selectedIndex != null &&
        selectedIndex >= 0 &&
        selectedIndex < _pingOptions.length &&
        pingPoint != null;
    _resetPingWheel();
    if (!shouldTrigger) return;
    final option = _pingOptions[selectedIndex];
    _broadcastRolePing(option: option, point: pingPoint);
  }

  void _onMapPointerCancel(PointerCancelEvent event, LatLng point) {
    _mapPointers.remove(event.pointer);
    if (_pingActivePointer != event.pointer) return;
    _pingPressTimer?.cancel();
    _resetPingWheel();
  }

  void _resetPingWheel() {
    if (!mounted) return;
    setState(() {
      _pingActivePointer = null;
      _pingPressOrigin = null;
      _pingLocation = null;
      _selectedPingOptionIndex = null;
      _pingWheelVisible = false;
    });
  }

  void _broadcastRolePing({
    required _PingOption option,
    required GeoPoint point,
  }) {
    final payload = jsonEncode(<String, dynamic>{
      'kind': 'role-ping',
      'id': option.id,
      'lat': point.latitude,
      'lng': point.longitude,
      'msg': option.shortMessage,
      'tts': option.ttsMessage,
      'color': option.color.toARGB32(),
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    _controller.sendRoleChat('$_kPingPayloadPrefix$payload');
  }

  void _syncIncomingPingMessages() {
    final chat = _controller.roleChat;
    if (!_pingCursorInitialized) {
      _lastPingChatIndex = chat.length;
      _pingCursorInitialized = true;
      return;
    }
    if (_lastPingChatIndex > chat.length) {
      _lastPingChatIndex = chat.length;
    }
    while (_lastPingChatIndex < chat.length) {
      final message = chat[_lastPingChatIndex];
      _lastPingChatIndex++;
      final parsed = _tryParsePingMessage(message.text);
      if (parsed == null) continue;
      final key =
          '${message.playerId}:${message.timestampMs}:${parsed.optionId}';
      final index = _activeRolePings.indexWhere((p) => p.messageKey == key);
      if (index != -1) continue;
      _activeRolePings.add(
        _ActiveRolePing(
          messageKey: key,
          playerId: message.playerId,
          playerName: message.playerName,
          position: parsed.position,
          color: parsed.color,
          shortMessage: parsed.shortMessage,
          createdAtMs: parsed.timestampMs,
        ),
      );
      _playPingFeedback(parsed: parsed, playerName: message.playerName);
    }
  }

  void _pruneExpiredPings() {
    final now = DateTime.now().millisecondsSinceEpoch;
    _activeRolePings.removeWhere(
      (ping) => now - ping.createdAtMs > _kPingVisibleDuration.inMilliseconds,
    );
  }

  double _pingPulseFor(int createdAtMs) {
    final elapsedMs = DateTime.now().millisecondsSinceEpoch - createdAtMs;
    final phase = (elapsedMs % 1200) / 1200;
    return (sin(phase * 2 * pi) + 1) / 2;
  }

  _DecodedPingMessage? _tryParsePingMessage(String raw) {
    if (!raw.startsWith(_kPingPayloadPrefix)) return null;
    final encoded = raw.substring(_kPingPayloadPrefix.length);
    Map<String, dynamic> data;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map) return null;
      data = Map<String, dynamic>.from(decoded);
    } catch (_) {
      return null;
    }
    if (data['kind']?.toString() != 'role-ping') return null;
    final latValue = data['lat'];
    final lngValue = data['lng'];
    final lat = latValue is num ? latValue.toDouble() : null;
    final lng = lngValue is num ? lngValue.toDouble() : null;
    if (lat == null || lng == null) return null;
    final colorSource = data['color'];
    final colorRaw = switch (colorSource) {
      int() => colorSource,
      num() => colorSource.toInt(),
      String() => int.tryParse(
        colorSource.startsWith('0x') || colorSource.startsWith('0X')
            ? colorSource.substring(2)
            : colorSource,
        radix: colorSource.startsWith('0x') || colorSource.startsWith('0X')
            ? 16
            : null,
      ),
      _ => null,
    };
    final timestamp =
        int.tryParse(data['ts']?.toString() ?? '') ??
        DateTime.now().millisecondsSinceEpoch;
    final shortMessageRaw = data['msg']?.toString().trim();
    final shortMessage = (shortMessageRaw?.isNotEmpty ?? false)
        ? shortMessageRaw!
        : 'Ping';
    final ttsMessage = data['tts']?.toString().trim();
    return _DecodedPingMessage(
      optionId: data['id']?.toString() ?? 'custom',
      position: GeoPoint(latitude: lat, longitude: lng),
      shortMessage: shortMessage,
      ttsMessage: (ttsMessage?.isNotEmpty ?? false)
          ? ttsMessage!
          : shortMessage,
      color: Color(colorRaw ?? Colors.blueAccent.toARGB32()),
      timestampMs: timestamp,
    );
  }

  Future<void> _playPingFeedback({
    required _DecodedPingMessage parsed,
    required String playerName,
  }) async {
    await _playOptionSound(parsed.optionId);
    if (!mounted) return;
    await _ttsService.speakIfEnabled('$playerName ${parsed.ttsMessage}');
  }

  Future<void> _playOptionSound(String optionId) async {
    switch (optionId) {
      case 'go_here':
        await SystemSound.play(SystemSoundType.click);
        return;
      case 'need_help':
        await SystemSound.play(SystemSoundType.alert);
        return;
      case 'danger':
        await SystemSound.play(SystemSoundType.alert);
        await Future<void>.delayed(_kDangerPingSoundGap);
        await SystemSound.play(SystemSoundType.alert);
        return;
      default:
        await SystemSound.play(SystemSoundType.click);
        await Future<void>.delayed(const Duration(milliseconds: 100));
        await SystemSound.play(SystemSoundType.alert);
    }
  }

  String _displayChatText(String text) {
    final parsed = _tryParsePingMessage(text);
    if (parsed == null) return text;
    return '📍 ${parsed.shortMessage}';
  }

  Future<void> _openChat() async {
    if (_chatOpen) return;
    setState(() {
      _chatOpen = true;
      _lastReadCount = _controller.visibleChat.length;
    });
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => AppChatSheet(
        title: _controller.isGameFinished
            ? 'Chat de fin de partie'
            : 'Chat équipe',
        animation: _controller,
        controller: _chatController,
        compactAuthor: true,
        messageCount: () => _controller.visibleChat.length,
        messageAt: (index) {
          final message = _controller.visibleChat[index];
          return AppChatEntry(
            author: message.playerName,
            text: _displayChatText(message.text),
            isSelf: message.playerId == _controller.playerId,
          );
        },
        onSend: _controller.sendChat,
      ),
    );
    if (!mounted) return;
    setState(() {
      _chatOpen = false;
      _lastReadCount = _controller.visibleChat.length;
    });
  }

  Widget _buildRallyCard(String winnerType, String winnerReason) {
    final point = _controller.rallyPoint;
    final winner = winnerType.toUpperCase() == 'AGENT'
        ? 'Victoire des Agents'
        : 'Victoire des Rogues';
    return Card(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.place_outlined),
            title: Text(
              point == null ? 'Fin de partie' : 'Point de rendez-vous',
            ),
            subtitle: Text(
              '$winner · ${_winnerReasonMessage(winnerType: winnerType, winnerReason: winnerReason)}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: point == null
                ? null
                : IconButton(
                    onPressed: () {
                      if (_compassModeEnabled) _toggleCompassMode();
                      _mapController.move(
                        LatLng(point.latitude, point.longitude),
                        _kDefaultGameMapZoom,
                      );
                    },
                    tooltip: 'Centrer sur le rendez-vous',
                    icon: const Icon(Icons.location_searching),
                  ),
          ),
          TextButton.icon(
            onPressed: _returnToLobby,
            icon: const Icon(Icons.replay),
            label: const Text('Retour au salon'),
          ),
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 12, bottom: 4),
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: _confirmFinishedGameExit,
                icon: const Icon(Icons.logout),
                label: const Text('Quitter la partie'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openGameInfo() async {
    final bootstrap = widget.bootstrap.lobby;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: 0.84,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final config =
                _controller.liveGameConfig ?? widget.bootstrap.gameConfig;
            final form = bootstrap.form;
            final bonus =
                config?.captureTimeBonusSeconds ??
                form?.captureTimeBonusSeconds ??
                0;
            final interval =
                config?.rogueAgentPositionIntervalSeconds ??
                form?.rogueAgentPositionIntervalSeconds ??
                0;
            final participants = _controller.voiceParticipants;
            final networkStatus = switch (_controller.connectionStatus) {
              'connected' => 'Connecté',
              'error' => 'Erreur de connexion',
              'closed' => 'Partie fermée',
              _ => 'Connexion en cours',
            };
            final voiceStatus = _controller.isReconnectingVoice
                ? 'Reconnexion en cours'
                : !_controller.isVoiceChatEnabled
                ? 'Désactivé'
                : _controller.hasVoiceError
                ? 'Connexion vocale indisponible'
                : _controller.isVoiceReady
                ? 'Prêt · ${participants.where((p) => _controller.voiceStatusFor(p.id) == VoicePeerStatus.connected).length} en ligne'
                : 'Connexion en cours';
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              children: [
                Text(
                  'Communication',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                Card(
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.sync),
                        title: const Text('Serveur de jeu'),
                        subtitle: Text(networkStatus),
                      ),
                      const Divider(height: 1),
                      ListTile(
                        leading: const Icon(Icons.headset_mic_outlined),
                        title: const Text('Chat vocal'),
                        subtitle: Text(voiceStatus),
                      ),
                      for (final player in participants)
                        ListTile(
                          dense: true,
                          leading: const Icon(Icons.person_outline),
                          title: Text(player.name),
                          subtitle: Text(switch (_controller.voiceStatusFor(
                            player.id,
                          )) {
                            VoicePeerStatus.connected => 'Connecté au vocal',
                            VoicePeerStatus.connecting =>
                              'Connexion au vocal en cours',
                            VoicePeerStatus.disconnected => 'Vocal déconnecté',
                          }),
                        ),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: OutlinedButton.icon(
                          onPressed: _controller.canReconnectVoice
                              ? _controller.reconnectVoice
                              : null,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Reconnecter le vocal'),
                        ),
                      ),
                    ],
                  ),
                ),
                SwitchListTile(
                  value: _controller.isMicrophoneEnabled,
                  secondary: Icon(
                    _controller.isMicrophoneEnabled ? Icons.mic : Icons.mic_off,
                  ),
                  title: const Text('Microphone'),
                  onChanged: (_) => _controller.toggleVoiceChatEnabled(),
                ),
                SwitchListTile(
                  value: _controller.canListenOtherRoles,
                  title: const Text('Écoute inter-rôles'),
                  onChanged: (_) => _controller.toggleListenOtherRoles(),
                ),
                ExpansionTile(
                  title: const Text('Informations de la partie'),
                  childrenPadding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _kvInfo(
                      'Code',
                      (_controller.gameCode ?? bootstrap.code).toUpperCase(),
                    ),
                    _kvInfo(
                      'Rôle',
                      (_controller.playerRole ?? 'Aucun').toUpperCase(),
                    ),
                    _kvInfo('Joueurs', '${_controller.players.length}'),
                    _kvInfo('Objectifs', '${_controller.objectives.length}'),
                    _kvInfo(
                      'Rayon du terrain',
                      '${config?.mapRadius ?? form?.mapRadius ?? CreateLobbyDefaults.mapRadius} m',
                    ),
                    _kvInfo(
                      'Durée',
                      _formatDuration(
                        config?.durationSeconds ??
                            form?.duration ??
                            CreateLobbyDefaults.durationSeconds,
                      ),
                    ),
                    if (bonus > 0) _kvInfo('Bonus par capture', '+$bonus s'),
                    _kvInfo(
                      'Positions des Agents',
                      interval == 0 ? 'Temps réel' : 'Toutes les $interval s',
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _kvInfo(String key, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              key,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Flexible(child: Text(value, textAlign: TextAlign.right)),
        ],
      ),
    );
  }

  int? _startCountdownSeconds() {
    final endAt = _controller.startCountdownEndAtMs;
    if (endAt == null) return null;
    final now = DateTime.now().millisecondsSinceEpoch;
    final remainingMs = endAt - now;
    if (remainingMs <= 0) return null;
    // Show 3,2,1 for a 3 second countdown.
    final seconds = (remainingMs / 1000).ceil();
    if (seconds <= 0) return null;
    if (seconds > 3) return 3;
    return seconds;
  }

  void _handleStartCountdownAudioSignals({
    required int? startCountdownSeconds,
    required String? winnerType,
  }) {
    final isPreStartPhase = !_controller.gameStarted && winnerType == null;
    if (!isPreStartPhase) {
      _lastCountdownSecondAnnounced = null;
      _didAnnounceCountdownGo = false;
      return;
    }

    if (startCountdownSeconds != null) {
      if (_lastCountdownSecondAnnounced != startCountdownSeconds) {
        _lastCountdownSecondAnnounced = startCountdownSeconds;
        _didAnnounceCountdownGo = false;
        unawaited(SystemSound.play(SystemSoundType.alert));
        unawaited(_ttsService.speakIfEnabled('$startCountdownSeconds'));
      }
      return;
    }

    if (_lastCountdownSecondAnnounced != null && !_didAnnounceCountdownGo) {
      _lastCountdownSecondAnnounced = null;
      _didAnnounceCountdownGo = true;
      unawaited(SystemSound.play(SystemSoundType.click));
      unawaited(_ttsService.speakIfEnabled('Partez !'));
    }
  }

  void _handleGameVibrationSignals({
    required int? startCountdownSeconds,
    required bool outOfZone,
    required String? winnerType,
  }) {
    final isPreStartPhase = !_controller.gameStarted && winnerType == null;

    // Rogue: objective enters hacking range.
    final rogueInRange =
        _controller.isRogueRole && _controller.canTriggerRogueObjectiveCapture;
    if (rogueInRange && !_prevRogueObjectiveInRange) {
      _vibrationService.vibrateIfEnabled(VibrationEvent.rogueObjectiveInRange);
    }

    _prevRogueObjectiveInRange = rogueInRange;

    // Everyone: entering own start zone during pre-start phase.
    if (isPreStartPhase) {
      final me = _controller.players
          .where((p) => p.id == _controller.playerId)
          .cast<GamePlayer?>()
          .firstWhere((p) => p != null, orElse: () => null);
      final selfInZone = me != null && _controller.isPlayerInStartZone(me);
      if (selfInZone && !_prevSelfInStartZone) {
        _vibrationService.vibrateIfEnabled(VibrationEvent.selfEnteredStartZone);
      }
      _prevSelfInStartZone = selfInZone;
    } else {
      _prevSelfInStartZone = false;
      _hostPlayerInStartZone.clear();
    }

    // Host: any player entering start zone during pre-start phase.
    if (isPreStartPhase && _controller.isHost) {
      var someoneJustEntered = false;
      for (final player in _controller.players) {
        if (player.status.toLowerCase() == 'disconnected') continue;
        final current = _controller.isPlayerInStartZone(player);
        final previous = _hostPlayerInStartZone[player.id] ?? current;
        if (current && !previous) {
          someoneJustEntered = true;
        }
        _hostPlayerInStartZone[player.id] = current;
      }
      if (someoneJustEntered) {
        _vibrationService.vibrateIfEnabled(
          VibrationEvent.hostSawPlayerEnterStartZone,
        );
      }
    }

    // Countdown start vibration on each second 3 -> 2 -> 1.
    if (startCountdownSeconds != null) {
      if (_lastCountdownSecondVibrated != startCountdownSeconds) {
        _lastCountdownSecondVibrated = startCountdownSeconds;
        _vibrationService.vibrateIfEnabled(VibrationEvent.gameStartCountdown);
      }
    } else {
      _lastCountdownSecondVibrated = null;
    }

    // While out of game zone, pulse vibration at interval.
    if (outOfZone && winnerType == null) {
      final now = DateTime.now().millisecondsSinceEpoch;
      if (now - _lastOutOfZoneVibrationMs >= 3000) {
        _lastOutOfZoneVibrationMs = now;
        _vibrationService.vibrateIfEnabled(VibrationEvent.outOfGameZone);
      }
    }
  }

  void _handleGameAnnouncements({
    required int? startCountdownSeconds,
    required String? winnerType,
  }) {
    final anyObjectiveCapturing = _controller.isAnyObjectiveCapturing;
    final capturedObjectivesCount = _controller.objectives
        .where((o) => o.captured)
        .length;
    final capturedRoguesCount = _controller.players
        .where((p) => (p.role ?? '').toUpperCase() == 'ROGUE')
        .where((p) => p.status.toUpperCase() == 'CAPTURED')
        .length;
    final allPlayersInStartZone = _areAllPlayersInStartZones();
    final gameStarted = _controller.gameStarted;

    if (!_announcementBaselineInitialized) {
      _announcementBaselineInitialized = true;
      _prevAnyObjectiveCapturing = anyObjectiveCapturing;
      _prevCapturedObjectivesCount = capturedObjectivesCount;
      _prevCapturedRoguesCount = capturedRoguesCount;
      _prevAllPlayersInStartZone = allPlayersInStartZone;
      _prevGameStarted = gameStarted;
      _lastCountdownSecondAnnounced = startCountdownSeconds;
      return;
    }

    if (anyObjectiveCapturing && !_prevAnyObjectiveCapturing) {
      _playAnnouncement("Début de capture d'un point par les rogues.");
    }
    if (capturedObjectivesCount > _prevCapturedObjectivesCount) {
      _playAnnouncement('Un point a été capturé par les rogues.');
    }
    if (capturedRoguesCount > _prevCapturedRoguesCount) {
      _playAnnouncement('Un rogue a été capturé.');
    }
    if (allPlayersInStartZone &&
        !_prevAllPlayersInStartZone &&
        winnerType == null &&
        !gameStarted) {
      _playAnnouncement('Tous les joueurs sont dans leurs zones de départ.');
    }

    if (startCountdownSeconds != null) {
      if (_lastCountdownSecondAnnounced != startCountdownSeconds) {
        _lastCountdownSecondAnnounced = startCountdownSeconds;
        _playAnnouncement('$startCountdownSeconds');
      }
    } else {
      _lastCountdownSecondAnnounced = null;
    }

    if (gameStarted && !_prevGameStarted) {
      _playAnnouncement('La partie commence.');
    }

    _prevAnyObjectiveCapturing = anyObjectiveCapturing;
    _prevCapturedObjectivesCount = capturedObjectivesCount;
    _prevCapturedRoguesCount = capturedRoguesCount;
    _prevAllPlayersInStartZone = allPlayersInStartZone;
    _prevGameStarted = gameStarted;
  }

  Future<void> _playAnnouncement(String text) async {
    try {
      await SystemSound.play(SystemSoundType.alert);
    } catch (_) {
      // Keep game flow resilient if system sound is unavailable.
    }
    await _ttsService.speakIfEnabled(text);
  }

  bool _areAllPlayersInStartZones() {
    final relevant = _controller.players
        .where((p) {
          if ((p.status).toLowerCase() == 'disconnected') return false;
          final role = (p.role ?? '').toUpperCase();
          return role == 'AGENT' || role == 'ROGUE';
        })
        .toList(growable: false);
    if (relevant.isEmpty) return false;
    final agents = relevant
        .where((p) => (p.role ?? '').toUpperCase() == 'AGENT')
        .length;
    final rogues = relevant
        .where((p) => (p.role ?? '').toUpperCase() == 'ROGUE')
        .length;
    if (agents < 1 || rogues < 1) return false;
    return relevant.every(_controller.isPlayerInStartZone);
  }

  String _winnerReasonMessage({
    required String winnerType,
    required String winnerReason,
  }) {
    final type = winnerType.toUpperCase();
    if (type == 'ROGUE') {
      final captured = _controller.objectives.where((o) => o.captured).length;
      final required =
          _controller.victoryObjectivesRequired ??
          widget.bootstrap.lobby.form?.victoryConditionObjectives ??
          _controller.objectives.length;
      if (winnerReason == 'OBJECTIVES_CAPTURED') {
        return 'Objectifs capturés ($captured/$required).';
      }
      return 'Objectifs capturés.';
    }

    // AGENT
    if (winnerReason == 'ALL_ROGUES_CAPTURED') {
      return 'Tous les rogues ont été capturés.';
    }
    if (winnerReason == 'TIMEOUT') {
      return 'Le temps est écoulé.';
    }
    return 'Victoire confirmée.';
  }
}
