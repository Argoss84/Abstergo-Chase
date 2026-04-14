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

class _GamePageState extends State<GamePage> {
  late final GameController _controller;
  final TextEditingController _chatController = TextEditingController();
  bool _chatOpen = false;
  int _lastReadCount = 0;

  @override
  void initState() {
    super.initState();
    _controller = GameController()..initialize(widget.bootstrap);
  }

  @override
  void dispose() {
    _chatController.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final unread = _chatOpen
            ? 0
            : (_controller.roleChat.length - _lastReadCount).clamp(0, 999);
        final fallbackCenter = _resolveCenter();
        final socketReady = _controller.connectionStatus == 'connected';

        return Scaffold(
          appBar: AppBar(
            title: Text(
              'Game (${(_controller.playerRole ?? 'N/A').toUpperCase()})',
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
          floatingActionButton: FloatingActionButton(
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
                        style: const TextStyle(fontSize: 10, color: Colors.white),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          body: (_controller.isLoading || !socketReady)
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
              : Column(
                  children: [
                    if (_controller.error != null)
                      Container(
                        width: double.infinity,
                        color: Colors.red.shade100,
                        padding: const EdgeInsets.all(8),
                        child: Text(_controller.error!),
                      ),
                    Expanded(
                      child: fallbackCenter == null
                          ? const Center(child: Text('Carte indisponible'))
                          : Padding(
                              padding: const EdgeInsets.all(12),
                              child: LobbyMapPreview(
                                center: _controller.myPosition ??
                                    fallbackCenter,
                                mapRadiusMeters:
                                    widget.bootstrap.gameConfig?.mapRadius ??
                                        widget.bootstrap.lobby.form?.mapRadius ??
                                        1000,
                                outerStreetContour: widget
                                        .bootstrap.gameConfig?.mapStreets
                                        .isNotEmpty ==
                                    true
                                    ? widget.bootstrap.gameConfig!.mapStreets
                                    : widget.bootstrap.lobby.outerStreetContour,
                                objectives: _controller.objectives
                                    .where((o) => !o.captured)
                                    .map((o) => o.point)
                                    .toList(growable: false),
                                agentStartZone:
                                    widget.bootstrap.gameConfig?.startZone ??
                                        widget.bootstrap.lobby.agentStartZone,
                                rogueStartZone:
                                    widget.bootstrap.gameConfig?.rogueStartZone ??
                                        widget.bootstrap.lobby.rogueStartZone,
                                objectiveZoneRadiusMeters:
                                    widget.bootstrap.gameConfig?.objectiveZoneRadius ??
                                        widget.bootstrap.lobby.form?.objectiveZoneRadius ??
                                        50,
                                showObjectives: true,
                                guidancePath: _controller.gameStarted
                                    ? const <GeoPoint>[]
                                    : _controller.buildPathToMyStartZone(),
                                playerPositions: _controller.players
                                    .where(_controller.isPlayerVisibleForCurrentRole)
                                    .where((p) =>
                                        p.latitude != null && p.longitude != null)
                                    .map((p) => GeoPoint(
                                          latitude: p.latitude!,
                                          longitude: p.longitude!,
                                        ))
                                    .toList(growable: false),
                              ),
                            ),
                    ),
                    if (_controller.isHost && !_controller.gameStarted)
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.symmetric(horizontal: 12),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade100,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Verification zones de depart (${_controller.startZoneRadiusMeters}m)',
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 6),
                            ..._controller.players.map((player) {
                              final inZone = _controller.isPlayerInStartZone(player);
                              final role = (player.role ?? 'AUCUN').toUpperCase();
                              final label = inZone ? 'Dans zone' : 'Hors zone';
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 4),
                                child: Text(
                                  '${player.name} [$role] - $label',
                                  style: TextStyle(
                                    color: inZone ? Colors.green.shade700 : Colors.red.shade700,
                                  ),
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
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

  GeoPoint? _resolveCenter() {
    if (widget.bootstrap.gameConfig != null) {
      return widget.bootstrap.gameConfig!.mapCenter;
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
}
