import 'dart:async';
import 'dart:math';
import 'dart:convert';

import 'package:abstergo_chase/features/game/application/game_controller.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:geolocator/geolocator.dart';

class GamePage extends StatefulWidget {
  const GamePage({
    super.key,
    required this.bootstrap,
  });

  static const String routePath = '/game';
  static const String routeName = 'game';
  final GameBootstrapData bootstrap;

  @override
  State<GamePage> createState() => _GamePageState();
}

class _GamePageState extends State<GamePage> with SingleTickerProviderStateMixin {
  late final GameController _controller;
  late final AnimationController _guidancePulseController;
  late final MapController _mapController;
  final ValueNotifier<double?> _headingDeg = ValueNotifier<double?>(null);
  StreamSubscription<CompassEvent>? _compassSub;
  final TextEditingController _chatController = TextEditingController();
  bool _chatOpen = false;
  int _lastReadCount = 0;
  bool _isActionFabOpen = false;

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
    });
  }

  @override
  void dispose() {
    _compassSub?.cancel();
    _headingDeg.dispose();
    _guidancePulseController.dispose();
    _chatController.dispose();
    _controller.dispose();
    super.dispose();
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
        final socketReady = _controller.connectionStatus == 'connected';
        final topInset = MediaQuery.of(context).padding.top + kToolbarHeight + 8;
        final objectiveZoneRadius = effectiveGameConfig?.objectiveZoneRadius ??
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
        final startCountdownSeconds = _startCountdownSeconds();
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
            backgroundColor: Colors.black.withOpacity(0.35),
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            title: Text(
              (_controller.playerRole ?? 'N/A').toUpperCase(),
            ),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Center(child: _buildConnectionBadge()),
              ),
              if (_controller.remainingSeconds != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Text(_formatDuration(_controller.remainingSeconds!)),
                  ),
                ),
              TextButton(
                onPressed: () {
                  _controller.leaveGame();
                  if (mounted) context.go('/');
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
            ],
          ),
          body: Stack(
            children: [
              (_controller.isLoading || !socketReady)
                  ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 12),
                      Text(
                        _controller.connectionStatus == 'connecting'
                            ? 'Connexion au socket en cours...'
                            : _controller.connectionStatus == 'error'
                                ? 'Erreur de connexion socket'
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
                              center: _controller.myPosition ?? fallbackCenter,
                              mapRadiusMeters:
                                  effectiveGameConfig?.mapRadius ??
                                      widget.bootstrap.lobby.form?.mapRadius ??
                                      1000,
                              outerStreetContour: effectiveGameConfig
                                      ?.mapStreets
                                      .isNotEmpty ==
                                  true
                                  ? effectiveGameConfig!.mapStreets
                                  : widget.bootstrap.lobby.outerStreetContour,
                              objectives: objectiveDisplayPoints,
                              agentStartZone:
                                  effectiveGameConfig?.startZone ??
                                      widget.bootstrap.lobby.agentStartZone,
                              rogueStartZone:
                                  effectiveGameConfig?.rogueStartZone ??
                                      widget.bootstrap.lobby.rogueStartZone,
                              objectiveZoneRadiusMeters:
                                  objectiveZoneRadius,
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
                              guidanceNeonPulse: _guidancePulseController.value,
                              highlightObjectiveZones: capturingDisplayPoints,
                              highlightObjectiveZoneRadiusMeters: objectiveZoneRadius,
                              highlightObjectivePulse:
                                  _guidancePulseController.value,
                              playerPositions: _controller.players
                                  .where(_controller.isPlayerVisibleForCurrentRole)
                                  .where(
                                    (p) => p.status.toLowerCase() != 'disconnected',
                                  )
                                  .where((p) =>
                                      p.latitude != null && p.longitude != null)
                                  .map((p) => GeoPoint(
                                        latitude: p.latitude!,
                                        longitude: p.longitude!,
                                      ))
                                  .toList(growable: false),
                            ),
                    ),
                    if (winnerType == null)
                      Positioned(
                        top: MediaQuery.of(context).padding.top + kToolbarHeight,
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
                                color: Colors.black.withOpacity(0.65),
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
                            color: Colors.black.withOpacity(0.55),
                            child: Center(
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 18,
                                  vertical: 16,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.95),
                                  borderRadius: BorderRadius.circular(14),
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Text(
                                      'La partie commence dans…',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 10),
                                    Text(
                                      '$startCountdownSeconds',
                                      style: const TextStyle(
                                        fontSize: 56,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ],
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
                    Positioned(
                      left: 12,
                      right: 12,
                      bottom: 16,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_controller.isHost && !_controller.gameStarted)
                            Container(
                              width: double.infinity,
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.9),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Verification zones de depart (${_controller.startZoneRadiusMeters}m)',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  ..._controller.players
                                      .where(
                                        (player) =>
                                            player.status.toLowerCase() !=
                                            'disconnected',
                                      )
                                      .map((player) {
                                    final inZone =
                                        _controller.isPlayerInStartZone(player);
                                    final role =
                                        (player.role ?? 'AUCUN').toUpperCase();
                                    final label = inZone ? 'Dans zone' : 'Hors zone';
                                    return Padding(
                                      padding: const EdgeInsets.only(bottom: 4),
                                      child: Text(
                                        '${player.name} [$role] - $label',
                                        style: TextStyle(
                                          color: inZone
                                              ? Colors.green.shade700
                                              : Colors.red.shade700,
                                        ),
                                      ),
                                    );
                                  }),
                                ],
                              ),
                            ),
                          if (_controller.isHost && !_controller.gameStarted)
                            FilledButton(
                              onPressed: _controller.canHostStartGame
                                  ? _controller.startGameFromHost
                                  : null,
                              child: Text(
                                _controller.canHostStartGame
                                    ? 'Démarrer'
                                    : 'En attente des zones de départ',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              if (socketReady && !_controller.isLoading)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 16,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: winnerType == null ? _buildActionFabMenu() : const SizedBox.shrink(),
                  ),
                ),
              if (winnerType != null)
                Positioned.fill(
                  child: Container(
                    color: Colors.black.withOpacity(0.72),
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
                                  onPressed: () {
                                    _controller.leaveGame();
                                    if (mounted) context.go('/');
                                  },
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

  String _formatDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Widget _buildConnectionBadge() {
    final status = _controller.connectionStatus;
    late final Color color;
    late final String label;
    late final IconData icon;
    switch (status) {
      case 'connected':
        color = Colors.green;
        label = 'Connecte';
        icon = Icons.check_circle;
        break;
      case 'connecting':
        color = Colors.orange;
        label = 'Reconnexion';
        icon = Icons.sync;
        break;
      case 'error':
        color = Colors.red;
        label = 'Erreur';
        icon = Icons.error_outline;
        break;
      case 'closed':
        color = Colors.grey;
        label = 'Ferme';
        icon = Icons.cancel_outlined;
        break;
      default:
        color = Colors.blueGrey;
        label = 'Initialisation';
        icon = Icons.hourglass_bottom;
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        border: Border.all(color: color.withOpacity(0.45)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w600,
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
        color: Colors.red.shade700.withOpacity(0.88),
        borderRadius: BorderRadius.circular(10),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.redAccent.withOpacity(0.45),
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
              backgroundColor: Colors.white.withOpacity(0.25),
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.orangeAccent),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionFabMenu() {
    final role = (_controller.playerRole ?? '').toUpperCase();
    final roleActionIcon =
        role == 'ROGUE' ? Icons.terminal : Icons.center_focus_strong;
    final roleActionLabel =
        role == 'ROGUE' ? 'Hacker objectif' : 'Capturer rogue';
    final rogueActionReady = role == 'ROGUE' && _controller.canTriggerRogueObjectiveCapture;
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
                icon: Icons.fitness_center,
                tooltip: 'Contrôle santé',
                onTap: () => _showFabPlaceholder('Contrôle santé'),
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
                  _openAgentCaptureScanner();
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

  Widget _fanSecondaryFab({
    double? left,
    double? right,
    required double bottom,
    required Widget child,
  }) {
    return Positioned(
      left: left,
      right: right,
      bottom: bottom,
      child: child,
    );
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
                  color: Colors.redAccent.withOpacity(0.35 + (pulseValue * 0.45)),
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
    _mapController.move(LatLng(target.latitude, target.longitude), 16.5);
  }

  Future<void> _openVitalityQr() async {
    setState(() => _isActionFabOpen = false);
    final payload = _buildVitalityQrPayload();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return Dialog(
          insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
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
                  (_controller.gameCode ?? widget.bootstrap.lobby.code).toUpperCase(),
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
      'gameCode': (_controller.gameCode ?? widget.bootstrap.lobby.code).toUpperCase(),
      'playerId': selfId,
      'playerName': playerName,
      'role': (_controller.playerRole ?? '').toUpperCase(),
    });
  }

  Future<void> _openAgentCaptureScanner() async {
    setState(() => _isActionFabOpen = false);
    if ((_controller.playerRole ?? '').toUpperCase() != 'AGENT') {
      _showFabPlaceholder('Action réservée agent');
      return;
    }
    if (!_controller.gameStarted) {
      _showFabPlaceholder('Partie non démarrée');
      return;
    }
    QRViewController? scannerController;
    StreamSubscription<Barcode>? scanSubscription;
    var handled = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) {
        final qrKey = GlobalKey(debugLabel: 'agent-capture-qr');
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
                    scanSubscription = controller.scannedDataStream.listen((scan) {
                      if (handled) return;
                      final raw = scan.code?.trim() ?? '';
                      if (raw.isEmpty) return;
                      handled = true;
                      Navigator.of(dialogContext).pop();
                      _handleScannedCaptureQr(raw);
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
                      'Scannez le QR Vitalité du Rogue',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    scanSubscription?.cancel();
    scannerController?.dispose();
  }

  void _handleScannedCaptureQr(String rawQr) {
    final feedback = _controller.triggerAgentCaptureFromQr(rawQr);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(feedback)));
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
    final metersPerDegLng = metersPerDegLat * cos(objective.latitude * pi / 180);
    final lat = objective.latitude + (dy / metersPerDegLat);
    final lng = objective.longitude + (dx / (metersPerDegLng.abs() < 1e-6 ? 1e-6 : metersPerDegLng));
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

  Future<void> _openChat() async {
    setState(() {
      _chatOpen = true;
      _lastReadCount = _controller.roleChat.length;
    });
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.65,
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text('Chat équipe'),
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
                          alignment:
                              isMe ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color:
                                  isMe ? Colors.blue.shade100 : Colors.grey.shade200,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text('${m.playerName}: ${m.text}'),
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
                        decoration:
                            const InputDecoration(hintText: 'Votre message...'),
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
      builder: (context) => SafeArea(
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
                      _kvInfo('Role', role),
                      _kvInfo('Etat socket', _controller.connectionStatus),
                      _kvInfo('Joueurs', '${_controller.players.length}'),
                      _kvInfo('Objectifs', '${_controller.objectives.length}'),
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
                      _kvInfo('Serveur', bootstrap.serverUrl),
                      _kvInfo('Socket path', bootstrap.socketPath),
                      _kvInfo('Rayon map', '${config?.mapRadius ?? form?.mapRadius ?? 0} m'),
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
            ],
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

  String _winnerReasonMessage({
    required String winnerType,
    required String winnerReason,
  }) {
    final type = winnerType.toUpperCase();
    if (type == 'ROGUE') {
      final captured = _controller.objectives.where((o) => o.captured).length;
      final required = _controller.victoryObjectivesRequired ??
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

class _CompassTarget {
  const _CompassTarget({
    required this.label,
    required this.icon,
    required this.color,
    required this.bearingDeg,
    required this.distanceMeters,
  });

  final String label;
  final IconData icon;
  final Color color;
  final double bearingDeg;
  final double distanceMeters;
}

class _CompassBanner extends StatelessWidget {
  const _CompassBanner({
    required this.roleUpper,
    required this.headingDeg,
    required this.myPosition,
    required this.players,
    required this.objectives,
    required this.selfPlayerId,
  });

  final String roleUpper;
  final double? headingDeg;
  final GeoPoint? myPosition;
  final List<GamePlayer> players;
  final List<GameObjective> objectives;
  final String? selfPlayerId;

  @override
  Widget build(BuildContext context) {
    if (myPosition == null) return const SizedBox.shrink();
    final heading = headingDeg;
    final targets = _buildTargets();
    if (targets.isEmpty) return const SizedBox.shrink();

    return _FpsCompassBar(
      headingDeg: heading,
      targets: targets,
    );
  }

  List<_CompassTarget> _buildTargets() {
    final meId = selfPlayerId;
    final mePos = myPosition!;
    final out = <_CompassTarget>[];

    void addPlayer(GamePlayer p, {required IconData icon, required Color color}) {
      if (meId != null && p.id == meId) return;
      if ((p.status).toLowerCase() == 'disconnected') return;
      if ((p.status).toUpperCase() == 'CAPTURED') return;
      if (p.latitude == null || p.longitude == null) return;
      final bearing = Geolocator.bearingBetween(
        mePos.latitude,
        mePos.longitude,
        p.latitude!,
        p.longitude!,
      );
      final d = Geolocator.distanceBetween(
        mePos.latitude,
        mePos.longitude,
        p.latitude!,
        p.longitude!,
      );
      out.add(
        _CompassTarget(
          label: p.name,
          icon: icon,
          color: color,
          bearingDeg: bearing,
          distanceMeters: d,
        ),
      );
    }

    void addObjective(GameObjective o) {
      if (o.captured) return;
      final bearing = Geolocator.bearingBetween(
        mePos.latitude,
        mePos.longitude,
        o.point.latitude,
        o.point.longitude,
      );
      final d = Geolocator.distanceBetween(
        mePos.latitude,
        mePos.longitude,
        o.point.latitude,
        o.point.longitude,
      );
      out.add(
        _CompassTarget(
          label: o.name ?? 'Objectif',
          icon: Icons.location_on,
          color: Colors.purpleAccent,
          bearingDeg: bearing,
          distanceMeters: d,
        ),
      );
    }

    if (roleUpper == 'ROGUE') {
      // Objectives still active
      for (final o in objectives) {
        addObjective(o);
      }
      // Other rogues + agents
      for (final p in players) {
        final role = (p.role ?? '').toUpperCase();
        if (role == 'AGENT') {
          addPlayer(p, icon: Icons.shield, color: Colors.blueAccent);
        } else if (role == 'ROGUE') {
          addPlayer(p, icon: Icons.person, color: Colors.greenAccent);
        }
      }
    } else if (roleUpper == 'AGENT') {
      for (final p in players) {
        final role = (p.role ?? '').toUpperCase();
        if (role == 'AGENT') {
          addPlayer(p, icon: Icons.person, color: Colors.blueAccent);
        }
      }
    }

    out.sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));
    return out.take(12).toList(growable: false);
  }

}

class _TargetDelta {
  const _TargetDelta(this.target, this.deltaDeg);
  final _CompassTarget target;
  final double deltaDeg;
}

class _FpsCompassBar extends StatelessWidget {
  const _FpsCompassBar({
    required this.headingDeg,
    required this.targets,
  });

  final double? headingDeg;
  final List<_CompassTarget> targets;

  static const double _windowDeg = 90; // +/-45°
  static const double _height = 46;

  @override
  Widget build(BuildContext context) {
    final heading = _normalizeDeg(headingDeg ?? 0);

    return Container(
      height: _height,
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.45),
        border: Border(
          bottom: BorderSide(color: Colors.white.withOpacity(0.12)),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final pxPerDeg = width / _windowDeg;
          final centerX = width / 2;

          final visibleTargets = targets
              .map((t) {
                final delta = _shortestAngleDeltaDeg(
                  heading,
                  _normalizeDeg(t.bearingDeg),
                );
                return _TargetDelta(t, delta);
              })
              .where((pair) => pair.deltaDeg.abs() <= (_windowDeg / 2))
              .toList(growable: false);

          // Handle stacking when multiple targets overlap.
          final xBuckets = <int, int>{};

          return Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _FpsCompassPainter(
                    headingDeg: heading,
                    pxPerDeg: pxPerDeg,
                    centerX: centerX,
                    windowDeg: _windowDeg,
                  ),
                ),
              ),
              // Center caret
              Positioned(
                left: centerX - 6,
                top: 0,
                child: Icon(
                  Icons.arrow_drop_down,
                  size: 18,
                  color: Colors.white.withOpacity(0.95),
                ),
              ),
              Positioned(
                left: centerX - 18,
                bottom: 2,
                width: 36,
                child: Text(
                  heading.round().toString().padLeft(3, '0'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.9),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
              ),
              // Targets
              for (final pair in visibleTargets)
                _buildTargetMarker(
                  context: context,
                  target: pair.target,
                  deltaDeg: pair.deltaDeg,
                  centerX: centerX,
                  pxPerDeg: pxPerDeg,
                  xBuckets: xBuckets,
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildTargetMarker({
    required BuildContext context,
    required _CompassTarget target,
    required double deltaDeg,
    required double centerX,
    required double pxPerDeg,
    required Map<int, int> xBuckets,
  }) {
    final x = centerX + (deltaDeg * pxPerDeg);
    final key = (x / 16).round(); // bucket by ~16px
    final idx = (xBuckets[key] ?? 0);
    xBuckets[key] = idx + 1;
    final top = 16 + (idx * 12.0);
    final meters = target.distanceMeters.isFinite ? target.distanceMeters.round() : 0;
    final shortLabel = target.label.length > 10 ? '${target.label.substring(0, 10)}…' : target.label;

    return Positioned(
      left: x - 18,
      top: top,
      width: 36,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.arrow_drop_down, color: target.color, size: 18),
          Icon(target.icon, color: target.color, size: 14),
          Text(
            meters > 0 ? '${meters}m' : '',
            style: TextStyle(
              color: Colors.white.withOpacity(0.85),
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            shortLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  static double _normalizeDeg(double v) {
    var d = v % 360.0;
    if (d < 0) d += 360.0;
    return d;
  }

  static double _shortestAngleDeltaDeg(double fromDeg, double toDeg) {
    var d = (toDeg - fromDeg) % 360.0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
}

class _FpsCompassPainter extends CustomPainter {
  _FpsCompassPainter({
    required this.headingDeg,
    required this.pxPerDeg,
    required this.centerX,
    required this.windowDeg,
  });

  final double headingDeg;
  final double pxPerDeg;
  final double centerX;
  final double windowDeg;

  @override
  void paint(Canvas canvas, Size size) {
    final tickPaint = Paint()
      ..color = Colors.white.withOpacity(0.65)
      ..strokeWidth = 1;
    final minorPaint = Paint()
      ..color = Colors.white.withOpacity(0.35)
      ..strokeWidth = 1;

    final textStyle = TextStyle(
      color: Colors.white.withOpacity(0.9),
      fontSize: 10,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.5,
    );
    final tp = TextPainter(
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    );

    const tickStep = 5.0;
    final startDeg = headingDeg - (windowDeg / 2);
    final endDeg = headingDeg + (windowDeg / 2);

    // draw ticks every 5°, labels every 15°
    for (var deg = (startDeg / tickStep).floor() * tickStep;
        deg <= endDeg;
        deg += tickStep) {
      final delta = _shortestAngleDeltaDeg(headingDeg, _normalizeDeg(deg));
      final x = centerX + (delta * pxPerDeg);
      final isMajor = (deg.round() % 15 == 0);
      const y0 = 0.0;
      final y1 = isMajor ? 14.0 : 8.0;
      canvas.drawLine(Offset(x, y0), Offset(x, y1), isMajor ? tickPaint : minorPaint);

      if (isMajor) {
        final label = _labelForDeg(deg.round());
        tp.text = TextSpan(text: label, style: textStyle);
        tp.layout(minWidth: 0, maxWidth: 60);
        tp.paint(canvas, Offset(x - (tp.width / 2), y1 + 1));
      }
    }
  }

  static String _labelForDeg(int deg) {
    final d = _normalizeDeg(deg.toDouble()).round() % 360;
    switch (d) {
      case 0:
        return 'N';
      case 45:
        return 'NE';
      case 90:
        return 'E';
      case 135:
        return 'SE';
      case 180:
        return 'S';
      case 225:
        return 'SW';
      case 270:
        return 'W';
      case 315:
        return 'NW';
      default:
        return d.toString();
    }
  }

  static double _normalizeDeg(double v) {
    var d = v % 360.0;
    if (d < 0) d += 360.0;
    return d;
  }

  static double _shortestAngleDeltaDeg(double fromDeg, double toDeg) {
    var d = (toDeg - fromDeg) % 360.0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  @override
  bool shouldRepaint(covariant _FpsCompassPainter oldDelegate) {
    return oldDelegate.headingDeg != headingDeg ||
        oldDelegate.pxPerDeg != pxPerDeg ||
        oldDelegate.windowDeg != windowDeg ||
        oldDelegate.centerX != centerX;
  }
}
