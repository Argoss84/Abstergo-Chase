import 'dart:async';
import 'dart:math';
import 'dart:convert';
import 'dart:ui';

import 'package:broken_veil_protocol/features/game/application/game_controller.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:broken_veil_protocol/shared/services/tts_service.dart';
import 'package:broken_veil_protocol/shared/services/vibration_service.dart';
import 'package:broken_veil_protocol/shared/services/voice_settings_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/services.dart';

part 'game_page_ping.dart';
part 'game_page_compass.dart';

const TextStyle _kTeamChatBubbleStyle = TextStyle(
  fontSize: 14,
  height: 1.35,
  color: Color(0xFF0F172A),
);
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
  const GamePage({super.key, required this.bootstrap});

  static const String routePath = '/game';
  static const String routeName = 'game';
  final GameBootstrapData bootstrap;

  @override
  State<GamePage> createState() => _GamePageState();
}

class _GamePageState extends State<GamePage>
    with SingleTickerProviderStateMixin {
  late final GameController _controller;
  late final AnimationController _guidancePulseController;
  late final MapController _mapController;
  final ValueNotifier<double?> _headingDeg = ValueNotifier<double?>(null);
  StreamSubscription<CompassEvent>? _compassSub;
  final TextEditingController _chatController = TextEditingController();
  bool _chatOpen = false;
  int _lastReadCount = 0;
  bool _isActionFabOpen = false;
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
  Offset? _pingPressOrigin;
  GeoPoint? _pingLocation;
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
    _guidancePulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1300),
      lowerBound: 0,
      upperBound: 1,
    )..repeat(reverse: true);
    _mapController = MapController();
    _controller = GameController()..initialize(widget.bootstrap);
    _compassSub = FlutterCompass.events?.listen((event) {
      // heading is degrees, clockwise from north
      _headingDeg.value = event.heading;
      _applyCompassRotation(event.heading);
    });
  }

  @override
  void dispose() {
    _compassSub?.cancel();
    _pingPressTimer?.cancel();
    _headingDeg.dispose();
    _guidancePulseController.dispose();
    _chatController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _quitGame({required bool clearSavedLobbyCode}) async {
    _controller.leaveGame();
    if (clearSavedLobbyCode) {
      await _playerSessionStore.clearLastLobbyCode();
    }
    if (mounted) context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge(<Listenable>[
        _controller,
        _guidancePulseController,
      ]),
      builder: (context, _) {
        final effectiveGameConfig =
            _controller.liveGameConfig ?? widget.bootstrap.gameConfig;
        final unread = _chatOpen
            ? 0
            : (_controller.roleChat.length - _lastReadCount).clamp(0, 999);
        final fallbackCenter = _resolveCenter();
        final connectionReady = _controller.connectionStatus == 'connected';
        final realtimePositionReady = _controller.hasRealtimePosition;
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
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
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
        if (_controller.isLoading ||
            !connectionReady ||
            !realtimePositionReady) {
          return Scaffold(
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
        final topInset =
            MediaQuery.of(context).padding.top + kToolbarHeight + 8;
        final objectiveZoneRadius =
            effectiveGameConfig?.objectiveZoneRadius ??
            widget.bootstrap.lobby.form?.objectiveZoneRadius ??
            50;
        final roleUpper = (_controller.playerRole ?? '').toUpperCase();
        final isRogue = roleUpper == 'ROGUE';
        final guidanceColor = isRogue ? Colors.green : Colors.blue;
        final rogueCaptureRemaining = _controller.rogueCaptureRemainingSeconds;
        final rogueCaptureProgress = _controller.rogueCaptureProgress;
        final winnerType = _controller.winnerType;
        final winnerReason = (_controller.winnerReason ?? '').toUpperCase();
        final outOfZone = _controller.isOutOfGameZone;
        final myPos = _controller.myPosition;
        _syncCompassMapCenter(myPos);
        final startCountdownSeconds = _startCountdownSeconds();
        final sameRolePlayers = _controller.sameRoleVoicePlayers;
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
        final objectiveDisplayPoints = isRogue
            ? _controller.objectives
                  .where((o) => !o.captured)
                  .map((o) => o.point)
                  .toList(growable: false)
            : _controller.objectives
                  .where((o) => !o.captured)
                  .map(
                    (o) => _shiftedZoneCenter(
                      objective: o.point,
                      objectiveId: o.id,
                      zoneRadiusMeters: objectiveZoneRadius.toDouble(),
                    ),
                  )
                  .toList(growable: false);
        final capturedObjectiveDisplayPoints = isRogue
            ? _controller.objectives
                  .where((o) => o.captured)
                  .map((o) => o.point)
                  .toList(growable: false)
            : _controller.objectives
                  .where((o) => o.captured)
                  .map(
                    (o) => _shiftedZoneCenter(
                      objective: o.point,
                      objectiveId: o.id,
                      zoneRadiusMeters: objectiveZoneRadius.toDouble(),
                    ),
                  )
                  .toList(growable: false);
        final capturingDisplayPoints = !isRogue
            ? _controller.objectives
                  .where((o) => !o.captured)
                  .where((o) => o.state.toUpperCase() == 'CAPTURING')
                  .map(
                    (o) => _shiftedZoneCenter(
                      objective: o.point,
                      objectiveId: o.id,
                      zoneRadiusMeters: objectiveZoneRadius.toDouble(),
                    ),
                  )
                  .toList(growable: false)
            : const <GeoPoint>[];

        return Scaffold(
          extendBodyBehindAppBar: true,
          appBar: AppBar(
            backgroundColor: Colors.transparent,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            flexibleSpace: ClipRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 4, sigmaY: 4),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.22),
                    border: Border(
                      bottom: BorderSide(
                        color: Colors.white.withValues(alpha: 0.14),
                        width: 1,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            title: _buildRoleTitleIcon(),
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
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Center(child: _buildAppBarStatusBadges(winnerType)),
              ),
              if (_controller.remainingSeconds != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Text(_formatDuration(_controller.remainingSeconds!)),
                  ),
                ),
              TextButton(
                onPressed: () => _quitGame(clearSavedLobbyCode: false),
                child: const Text('Quitter'),
              ),
            ],
          ),
          floatingActionButton: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              FloatingActionButton(
                heroTag: 'game-chat-fab',
                onPressed: _openChat,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.chat_bubble_outline),
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
              const SizedBox(height: 10),
              FloatingActionButton(
                heroTag: 'game-info-fab',
                onPressed: _openGameInfo,
                child: const Icon(Icons.info_outline),
              ),
              if (_controller.voiceMode ==
                  VoiceTransmissionMode.pushToTalk) ...[
                const SizedBox(height: 10),
                _buildPushToTalkFab(),
              ],
            ],
          ),
          body: Stack(
            children: [
              (_controller.isLoading || !connectionReady)
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const CircularProgressIndicator(),
                          const SizedBox(height: 12),
                          Text(
                            _controller.connectionStatus == 'connecting'
                                ? 'Connexion au serveur en cours...'
                                : _controller.connectionStatus == 'error'
                                ? 'Impossible de se connecter au serveur.'
                                : 'Initialisation de la partie...',
                          ),
                        ],
                      ),
                    )
                  : Stack(
                      children: [
                        Positioned.fill(
                          child: fallbackCenter == null
                              ? const Center(child: Text('Carte indisponible'))
                              : LobbyMapPreview(
                                  mapController: _mapController,
                                  height: null,
                                  center:
                                      _controller.myPosition ?? fallbackCenter,
                                  mapRadiusMeters:
                                      effectiveGameConfig?.mapRadius ??
                                      widget.bootstrap.lobby.form?.mapRadius ??
                                      1000,
                                  outerStreetContour:
                                      effectiveGameConfig
                                              ?.mapStreets
                                              .isNotEmpty ==
                                          true
                                      ? effectiveGameConfig!.mapStreets
                                      : widget
                                            .bootstrap
                                            .lobby
                                            .outerStreetContour,
                                  objectives: objectiveDisplayPoints,
                                  inactiveObjectives:
                                      capturedObjectiveDisplayPoints,
                                  agentStartZone:
                                      effectiveGameConfig?.startZone ??
                                      widget.bootstrap.lobby.agentStartZone,
                                  rogueStartZone:
                                      effectiveGameConfig?.rogueStartZone ??
                                      widget.bootstrap.lobby.rogueStartZone,
                                  objectiveZoneRadiusMeters:
                                      objectiveZoneRadius,
                                  startZoneRadiusMeters:
                                      effectiveGameConfig?.startZoneRadius ??
                                      widget
                                          .bootstrap
                                          .lobby
                                          .form
                                          ?.startZoneRadius ??
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
                                  guidancePath: _controller.gameStarted
                                      ? const <GeoPoint>[]
                                      : _controller.buildPathToMyStartZone(),
                                  guidancePathColor: guidanceColor,
                                  guidancePathDotted: true,
                                  guidanceNeonPulse:
                                      _guidancePulseController.value,
                                  highlightObjectiveZones:
                                      capturingDisplayPoints,
                                  highlightObjectiveZoneRadiusMeters:
                                      objectiveZoneRadius,
                                  highlightObjectivePulse:
                                      _guidancePulseController.value,
                                  showCenterMarker: false,
                                  pingMarkers: _activeRolePings
                                      .map(
                                        (ping) => MapPingMarker(
                                          point: ping.position,
                                          color: ping.color,
                                          playerName: ping.playerName,
                                          message: ping.shortMessage,
                                          pulseValue: _pingPulseFor(
                                            ping.createdAtMs,
                                          ),
                                        ),
                                      )
                                      .toList(growable: false),
                                  onMapPointerDown: _onMapPointerDown,
                                  onMapPointerMove: _onMapPointerMove,
                                  onMapPointerUp: _onMapPointerUp,
                                  onMapPointerCancel: _onMapPointerCancel,
                                  playerMarkers: _controller.players
                                      .where(
                                        (p) =>
                                            p.id == _controller.playerId ||
                                            _controller
                                                .isPlayerVisibleForCurrentRole(
                                                  p,
                                                ),
                                      )
                                      .where(
                                        (p) =>
                                            p.status.toLowerCase() !=
                                            'disconnected',
                                      )
                                      .where(
                                        (p) =>
                                            p.latitude != null &&
                                            p.longitude != null,
                                      )
                                      .map(
                                        (p) => PlayerMapMarker(
                                          point: GeoPoint(
                                            latitude: p.latitude!,
                                            longitude: p.longitude!,
                                          ),
                                          isAgent:
                                              (p.role ?? '').toUpperCase() ==
                                              'AGENT',
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
                                kToolbarHeight,
                            left: 0,
                            right: 0,
                            child: ValueListenableBuilder<double?>(
                              valueListenable: _headingDeg,
                              builder: (context, heading, _) {
                                return _CompassBanner(
                                  roleUpper: roleUpper,
                                  headingDeg: heading,
                                  myPosition: myPos,
                                  players: _controller.players,
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
                            child: Container(
                              color: Colors.red.shade100,
                              padding: const EdgeInsets.all(8),
                              child: Text(_controller.error!),
                            ),
                          ),
                        if (winnerType == null && outOfZone)
                          Positioned.fill(
                            child: IgnorePointer(
                              child: Center(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 12,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.65),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Text(
                                    'Retournez dans la zone de jeux',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        if (winnerType == null && startCountdownSeconds != null)
                          Positioned.fill(
                            child: IgnorePointer(
                              child: Container(
                                color: Colors.black.withValues(alpha: 0.55),
                                child: Center(
                                  child: Transform.scale(
                                    scale: 0.96 + (_guidancePulseController.value * 0.1),
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
                                            color: Colors.black.withValues(alpha: 0.28),
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
                                  Icon(
                                    Icons.warning_amber,
                                    color: Colors.white,
                                  ),
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
                              child: BackdropFilter(
                                filter: ImageFilter.blur(sigmaX: 4, sigmaY: 4),
                                child: Container(
                                  padding: const EdgeInsets.all(8),
                                  color: Colors.black.withValues(alpha: 0.08),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
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
                        if ((!_controller.isHost || _controller.gameStarted) &&
                            winnerType == null &&
                            sameRolePlayers.isNotEmpty)
                          Positioned(
                            top: topInset,
                            left: 12,
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: BackdropFilter(
                                filter: ImageFilter.blur(sigmaX: 4, sigmaY: 4),
                                child: Container(
                                  width: 260,
                                  padding: const EdgeInsets.all(8),
                                  color: Colors.black.withValues(alpha: 0.08),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      ...sameRolePlayers.map((player) {
                                        final activeVoice = _controller
                                            .isPlayerVoiceActive(player.id);
                                        return Container(
                                          margin: const EdgeInsets.only(
                                            bottom: 4,
                                          ),
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 6,
                                            vertical: 4,
                                          ),
                                          decoration: BoxDecoration(
                                            color: activeVoice
                                                ? Colors.cyanAccent.withValues(
                                                    alpha: 0.18,
                                                  )
                                                : Colors.transparent,
                                            borderRadius: BorderRadius.circular(
                                              6,
                                            ),
                                            border: Border.all(
                                              color: activeVoice
                                                  ? Colors.cyanAccent
                                                  : Colors.white.withValues(
                                                      alpha: 0.1,
                                                    ),
                                              width: 1,
                                            ),
                                          ),
                                          child: Row(
                                            children: [
                                              Icon(
                                                activeVoice
                                                    ? Icons.graphic_eq
                                                    : Icons.volume_mute,
                                                size: 16,
                                                color: activeVoice
                                                    ? Colors.cyanAccent
                                                    : Colors.white70,
                                              ),
                                              const SizedBox(width: 6),
                                              Expanded(
                                                child: Text(
                                                  player.name,
                                                  style: TextStyle(
                                                    color: activeVoice
                                                        ? Colors.cyanAccent
                                                        : Colors.white,
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
                      ],
                    ),
              if (connectionReady && !_controller.isLoading)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 16,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: winnerType == null
                        ? _buildActionFabMenu()
                        : const SizedBox.shrink(),
                  ),
                ),
              if (winnerType != null)
                Positioned.fill(
                  child: Container(
                    color: Colors.black.withValues(alpha: 0.72),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: Card(
                          margin: const EdgeInsets.all(16),
                          child: Padding(
                            padding: const EdgeInsets.all(18),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Text(
                                  'Fin de partie',
                                  style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  (winnerType.toUpperCase() == 'AGENT')
                                      ? 'Victoire des Agents'
                                      : 'Victoire des Rogues',
                                  style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w700,
                                    color: (winnerType.toUpperCase() == 'AGENT')
                                        ? Colors.blue.shade700
                                        : Colors.purple.shade700,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _winnerReasonMessage(
                                    winnerType: winnerType,
                                    winnerReason: winnerReason,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 16),
                                FilledButton(
                                  onPressed: () =>
                                      _quitGame(clearSavedLobbyCode: true),
                                  child: const Text('Quitter'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
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
    final color = isConvergence ? Colors.amber.shade700 : Colors.green.shade600;
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
        border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 1),
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
        backgroundColor = Colors.green.shade700;
        label = 'En ligne';
        icon = Icons.check_circle;
        break;
      case 'connecting':
        backgroundColor = Colors.orange.shade800;
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
    final roleActionIcon = role == 'ROGUE' ? Icons.terminal : Icons.gps_fixed;
    final roleActionLabel = role == 'ROGUE'
        ? 'Hacker objectif'
        : 'Ciblage rogue';
    final rogueActionReady =
        role == 'ROGUE' && _controller.canTriggerRogueObjectiveCapture;
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
                icon: Icons.favorite,
                tooltip: 'Vitalité',
                onTap: _openVitalityQr,
              ),
            ),
          if (_isActionFabOpen)
            _fanSecondaryFab(
              left: 78,
              bottom: 126,
              child: _miniActionFab(
                icon: _controller.isVoiceChatEnabled
                    ? Icons.volume_up
                    : Icons.volume_off,
                tooltip: _controller.isVoiceChatEnabled
                    ? 'Couper discussion vocale'
                    : 'Activer discussion vocale',
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
                tooltip: 'Recentrer carte',
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
                pulseValue: _guidancePulseController.value,
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
                onPressed: () =>
                    setState(() => _isActionFabOpen = !_isActionFabOpen),
                child: const Icon(Icons.adjust),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPushToTalkFab() {
    final enabled = _controller.isVoiceChatEnabled;
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
            : 'Activez le vocal pour parler',
        onPressed: () {},
        backgroundColor: enabled ? Colors.orangeAccent : Colors.grey,
        foregroundColor: Colors.black87,
        child: const Icon(Icons.record_voice_over),
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
    double pulseValue = 0,
  }) {
    return DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: pulseAura
            ? <BoxShadow>[
                BoxShadow(
                  color: Colors.redAccent.withValues(
                    alpha: 0.35 + (pulseValue * 0.45),
                  ),
                  blurRadius: 8 + (pulseValue * 14),
                  spreadRadius: 1 + (pulseValue * 4),
                ),
              ]
            : const <BoxShadow>[],
      ),
      child: FloatingActionButton(
        heroTag: 'game-action-${icon.codePoint}-$tooltip',
        mini: true,
        tooltip: tooltip,
        onPressed: onTap,
        backgroundColor: backgroundColor,
        foregroundColor: foregroundColor,
        child: Icon(icon),
      ),
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
    if (!_compassModeEnabled || heading == null) return;
    // Keep player forward direction at top of screen.
    _mapController.rotate(-heading);
  }

  void _syncCompassMapCenter(GeoPoint? playerPosition) {
    if (!_compassModeEnabled || playerPosition == null) return;
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
      _mapController.move(
        LatLng(target.latitude, target.longitude),
        zoom,
      );
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
    if (effectiveGameConfig != null) {
      return effectiveGameConfig.mapCenter;
    }
    final form = widget.bootstrap.lobby.form;
    if (form != null) {
      final lat = double.tryParse(form.mapCenterLatitude);
      final lng = double.tryParse(form.mapCenterLongitude);
      if (lat != null && lng != null) {
        return GeoPoint(latitude: lat, longitude: lng);
      }
    }
    if (widget.bootstrap.lobby.objectives.isNotEmpty) {
      return widget.bootstrap.lobby.objectives.first;
    }
    if (widget.bootstrap.lobby.agentStartZone != null) {
      return widget.bootstrap.lobby.agentStartZone;
    }
    if (widget.bootstrap.lobby.rogueStartZone != null) {
      return widget.bootstrap.lobby.rogueStartZone;
    }
    if (widget.bootstrap.lobby.outerStreetContour.isNotEmpty) {
      return widget.bootstrap.lobby.outerStreetContour.first;
    }
    return null;
  }

  GeoPoint _shiftedZoneCenter({
    required GeoPoint objective,
    required String objectiveId,
    required double zoneRadiusMeters,
  }) {
    if (zoneRadiusMeters <= 1) return objective;
    final seed = _stableHash(objectiveId);
    final ratio = 0.35 + ((seed % 40) / 100.0); // 0.35 -> 0.74
    final distanceMeters = zoneRadiusMeters * ratio;
    final angle = ((seed % 360) * pi) / 180.0;
    final dx = distanceMeters * cos(angle);
    final dy = distanceMeters * sin(angle);
    const metersPerDegLat = 111320.0;
    final metersPerDegLng =
        metersPerDegLat * cos(objective.latitude * pi / 180);
    final lat = objective.latitude + (dy / metersPerDegLat);
    final lng =
        objective.longitude +
        (dx / (metersPerDegLng.abs() < 1e-6 ? 1e-6 : metersPerDegLng));
    return GeoPoint(latitude: lat, longitude: lng);
  }

  int _stableHash(String value) {
    var h = 2166136261;
    for (final code in value.codeUnits) {
      h ^= code;
      h = (h * 16777619) & 0x7fffffff;
    }
    return h;
  }

  void _onMapPointerDown(PointerDownEvent event, LatLng point) {
    _pingPressTimer?.cancel();
    _pingActivePointer = event.pointer;
    _pingPressOrigin = event.localPosition;
    _pingLocation = GeoPoint(latitude: point.latitude, longitude: point.longitude);
    _selectedPingOptionIndex = null;
    _pingWheelVisible = false;
    _pingPressTimer = Timer(_kPingPressDelay, () {
      if (!mounted || _pingActivePointer != event.pointer) return;
      setState(() => _pingWheelVisible = true);
    });
  }

  void _onMapPointerMove(PointerMoveEvent event, LatLng point) {
    if (_pingActivePointer != event.pointer || !_pingWheelVisible) return;
    final origin = _pingPressOrigin;
    if (origin == null) return;
    final vector = event.localPosition - origin;
    final distance = vector.distance;
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
    final option = _pingOptions[selectedIndex!];
    _broadcastRolePing(option: option, point: pingPoint);
  }

  void _onMapPointerCancel(PointerCancelEvent event, LatLng point) {
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

  void _broadcastRolePing({required _PingOption option, required GeoPoint point}) {
    final payload = jsonEncode(<String, dynamic>{
      'kind': 'role-ping',
      'id': option.id,
      'lat': point.latitude,
      'lng': point.longitude,
      'msg': option.shortMessage,
      'tts': option.ttsMessage,
      'color': option.color.value,
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
      final key = '${message.playerId}:${message.timestampMs}:${parsed.optionId}';
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
        radix:
            colorSource.startsWith('0x') || colorSource.startsWith('0X')
            ? 16
            : null,
      ),
      _ => null,
    };
    final timestamp = int.tryParse(data['ts']?.toString() ?? '') ??
        DateTime.now().millisecondsSinceEpoch;
    final shortMessageRaw = data['msg']?.toString().trim();
    final shortMessage =
        (shortMessageRaw?.isNotEmpty ?? false) ? shortMessageRaw! : 'Ping';
    final ttsMessage = data['tts']?.toString().trim();
    return _DecodedPingMessage(
      optionId: data['id']?.toString() ?? 'custom',
      position: GeoPoint(latitude: lat, longitude: lng),
      shortMessage: shortMessage,
      ttsMessage: (ttsMessage?.isNotEmpty ?? false)
          ? ttsMessage!
          : shortMessage,
      color: Color(colorRaw ?? Colors.blueAccent.value),
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
    setState(() {
      _chatOpen = true;
      _lastReadCount = _controller.roleChat.length;
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
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Chat équipe',
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close),
                        tooltip: 'Fermer',
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: AnimatedBuilder(
                    animation: _controller,
                    builder: (context, _) {
                      return ListView(
                        padding: const EdgeInsets.all(12),
                        children: _controller.roleChat.map((m) {
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
                              child: Text(
                                '${m.playerName}: ${_displayChatText(m.text)}',
                                style: _kTeamChatBubbleStyle,
                              ),
                            ),
                          );
                        }).toList(),
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
                            hintText: 'Votre message...',
                            hintStyle: TextStyle(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurface.withValues(alpha: 0.55),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: () {
                          _controller.sendRoleChat(_chatController.text);
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
    if (!mounted) return;
    setState(() {
      _chatOpen = false;
      _lastReadCount = _controller.roleChat.length;
    });
  }

  Future<void> _openGameInfo() async {
    final bootstrap = widget.bootstrap.lobby;
    final config = widget.bootstrap.gameConfig;
    final form = bootstrap.form;
    final code = (_controller.gameCode ?? bootstrap.code).toUpperCase();
    final role = (_controller.playerRole ?? 'AUCUN').toUpperCase();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) => SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.9,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Informations de la partie',
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
                        _kvInfo('Rôle', role),
                        _kvInfo('Joueurs', '${_controller.players.length}'),
                        _kvInfo(
                          'Objectifs',
                          '${_controller.objectives.length}',
                        ),
                        _kvInfo(
                          'Temps restant',
                          _controller.remainingSeconds != null
                              ? _formatDuration(_controller.remainingSeconds!)
                              : 'n/a',
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
                        _kvInfo(
                          'Rayon map',
                          '${config?.mapRadius ?? form?.mapRadius ?? 0} m',
                        ),
                        _kvInfo(
                          'Rayon zone objectif',
                          '${config?.objectiveZoneRadius ?? form?.objectiveZoneRadius ?? 0} m',
                        ),
                        _kvInfo(
                          'Duree',
                          '${form?.duration ?? _controller.remainingSeconds ?? 0} sec',
                        ),
                        _kvInfo(
                          'Victoire objectifs',
                          '${form?.victoryConditionObjectives ?? 'n/a'}',
                        ),
                      ],
                    ),
                  ),
                ),
                Card(
                  child: Column(
                    children: [
                      SwitchListTile(
                        value: _controller.isVoiceChatEnabled,
                        secondary: Icon(
                          _controller.isVoiceChatEnabled
                              ? Icons.mic
                              : Icons.mic_off,
                        ),
                        title: const Text('Microphone'),
                        subtitle: Text(
                          _controller.isVoiceChatEnabled
                              ? 'Micro actif — appuyer pour couper'
                              : 'Micro coupé — appuyer pour activer',
                        ),
                        onChanged: (_) {
                          _controller.toggleVoiceChatEnabled();
                          setModalState(() {});
                        },
                      ),
                      SwitchListTile(
                        value: _controller.canListenOtherRoles,
                        title: const Text('Écoute inter-rôles (option)'),
                        subtitle: const Text(
                          'Permet d’écouter les rôles différents',
                        ),
                        onChanged: (_) {
                          _controller.toggleListenOtherRoles();
                          setModalState(() {});
                        },
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
