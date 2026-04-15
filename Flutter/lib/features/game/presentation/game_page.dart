import 'dart:math';

import 'package:abstergo_chase/features/game/application/game_controller.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

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
    _controller = GameController()..initialize(widget.bootstrap);
  }

  @override
  void dispose() {
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
                    child: _buildActionFabMenu(),
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

  Widget _buildActionFabMenu() {
    final role = (_controller.playerRole ?? '').toUpperCase();
    final roleActionIcon =
        role == 'ROGUE' ? Icons.radio_button_checked : Icons.warning_amber;
    final roleActionLabel =
        role == 'ROGUE' ? 'Action rogue' : 'Détection menace';
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
                icon: Icons.visibility,
                tooltip: 'Mode vision',
                onTap: () => _showFabPlaceholder('Mode vision'),
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
                onTap: () => _showFabPlaceholder('Recentrage carte'),
              ),
            ),
          if (_isActionFabOpen)
            _fanSecondaryFab(
              right: 36,
              bottom: 78,
              child: _miniActionFab(
                icon: roleActionIcon,
                tooltip: roleActionLabel,
                onTap: () => _showFabPlaceholder(roleActionLabel),
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
  }) {
    return FloatingActionButton(
      heroTag: 'game-action-${icon.codePoint}-$tooltip',
      mini: true,
      tooltip: tooltip,
      onPressed: onTap,
      backgroundColor: Colors.white,
      foregroundColor: Colors.black87,
      child: Icon(icon),
    );
  }

  void _showFabPlaceholder(String label) {
    setState(() => _isActionFabOpen = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label: fonctionnalité bientôt disponible.')),
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
}
