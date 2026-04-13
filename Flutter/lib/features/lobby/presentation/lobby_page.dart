import 'package:abstergo_chase/features/lobby/application/lobby_controller.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/game/presentation/game_page.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/widgets/lobby_map_preview.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class LobbyPage extends StatefulWidget {
  const LobbyPage({
    super.key,
    this.initialCode,
    this.bootstrapData,
  });

  static const String routePath = '/lobby';
  static const String routeName = 'lobby';

  final String? initialCode;
  final LobbyBootstrapData? bootstrapData;

  @override
  State<LobbyPage> createState() => _LobbyPageState();
}

class _LobbyPageState extends State<LobbyPage> {
  late final LobbyController _controller;
  late final TextEditingController _chatController;
  int _lastReadCount = 0;
  bool _isChatOpen = false;
  bool _didRouteToGame = false;

  @override
  void initState() {
    super.initState();
    _controller = LobbyController();
    _chatController = TextEditingController();
    final bootstrap = widget.bootstrapData;
    if (bootstrap != null) {
      _controller.initialize(bootstrap: bootstrap);
    } else if ((widget.initialCode ?? '').trim().isNotEmpty) {
      _controller.initialize(
        bootstrap: LobbyBootstrapData(
          code: widget.initialCode!.trim().toUpperCase(),
          serverUrl: 'http://10.0.2.2:5174',
          socketPath: '/socket.io',
          playerName: 'Joueur',
        ),
      );
    } else {
      _controller.error = 'Code lobby manquant.';
      _controller.isLoading = false;
    }
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
        final bootstrap = _controller.bootstrapData;
        final config = _controller.gameConfig;
        final rawUnread = _controller.chatMessages.length - _lastReadCount;
        final int unreadCount = _isChatOpen
            ? 0
            : rawUnread < 0
                ? 0
                : (rawUnread > 999 ? 999 : rawUnread);
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
          floatingActionButton: FloatingActionButton(
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
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'Code de la partie',
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 8),
                            SelectableText(
                              (_controller.lobbyCode ?? '').toUpperCase(),
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
                    ),
                    if (config != null ||
                        (bootstrap?.form != null &&
                            bootstrap!.form!.mapCenterLatitude.isNotEmpty &&
                            bootstrap.form!.mapCenterLongitude.isNotEmpty))
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: LobbyMapPreview(
                            center: config?.mapCenter ??
                                (bootstrap!.form!.mapCenterLatitude.isEmpty
                                    ? bootstrap.objectives.first
                                    : _pointFromForm(bootstrap)),
                            mapRadiusMeters:
                                config?.mapRadius ?? bootstrap!.form!.mapRadius,
                            outerStreetContour:
                                config?.mapStreets ?? bootstrap!.outerStreetContour,
                            objectives: _controller.isHost
                                ? bootstrap?.objectives ?? const <GeoPoint>[]
                                : const <GeoPoint>[],
                            agentStartZone:
                                config?.startZone ?? bootstrap?.agentStartZone,
                            rogueStartZone:
                                config?.rogueStartZone ?? bootstrap?.rogueStartZone,
                            objectiveZoneRadiusMeters: config?.objectiveZoneRadius ??
                                bootstrap!.form!.objectiveZoneRadius,
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
                            ..._controller.players.map(
                              (player) => ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  player.name +
                                      (player.id == _controller.playerId
                                          ? ' (Vous)'
                                          : ''),
                                ),
                                subtitle: Text(player.isHost ? 'Host' : 'Joueur'),
                                trailing: _controller.isHost
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
                              ),
                            ),
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
                              const Text(
                                'Prerequis pour demarrer',
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 8),
                              Text(_controller.canStartGame
                                  ? 'OK: au moins 1 Agent et 1 Rogue'
                                  : 'Attribuez au moins 1 Agent et 1 Rogue'),
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
                    Card(
                      child: ExpansionTile(
                        title: const Text('Details Partie'),
                        childrenPadding: const EdgeInsets.all(12),
                        children: [
                          if (bootstrap?.form != null) ...[
                            _kv('Objectifs', '${bootstrap!.form!.objectiveNumber}'),
                            _kv('Duree', '${bootstrap.form!.duration} secondes'),
                            _kv(
                              'Objectifs victoire',
                              '${bootstrap.form!.victoryConditionObjectives}',
                            ),
                            _kv(
                              'Rayon map',
                              '${bootstrap.form!.mapRadius} m',
                            ),
                          ] else
                            const Text('Details non disponibles sur ce client.'),
                          if (_controller.objectiveNames.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            const Text(
                              'Noms des objectifs',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                            ..._controller.objectiveNames
                                .map((name) => Text('- $name')),
                          ],
                        ],
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
      child: Text(
        status,
        style: TextStyle(color: color, fontSize: 12),
      ),
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

  Future<void> _openChatSheet() async {
    setState(() {
      _isChatOpen = true;
      _lastReadCount = _controller.chatMessages.length;
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
                child: Text(
                  'Chat du lobby',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
              ),
              Expanded(
                child: AnimatedBuilder(
                  animation: _controller,
                  builder: (context, _) {
                    if (_controller.chatMessages.isEmpty) {
                      return const Center(
                        child: Text('Aucun message.'),
                      );
                    }
                    return ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: _controller.chatMessages.length,
                      itemBuilder: (context, index) {
                        final m = _controller.chatMessages[index];
                        final isMe = m.playerId == _controller.playerId;
                        return Align(
                          alignment:
                              isMe ? Alignment.centerRight : Alignment.centerLeft,
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
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(m.text),
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
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          hintText: 'Votre message...',
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
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _isChatOpen = false;
      _lastReadCount = _controller.chatMessages.length;
    });
  }
}
