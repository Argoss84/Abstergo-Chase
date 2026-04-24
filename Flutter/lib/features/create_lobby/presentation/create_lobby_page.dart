import 'package:abstergo_chase/features/create_lobby/application/create_lobby_controller.dart';
import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_map.dart';
import 'package:abstergo_chase/features/lobby/data/player_name_store.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/lobby_page.dart';
import 'package:abstergo_chase/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class CreateLobbyPage extends StatefulWidget {
  const CreateLobbyPage({super.key});

  static const String routePath = '/create-lobby';
  static const String routeName = 'create-lobby';

  @override
  State<CreateLobbyPage> createState() => _CreateLobbyPageState();
}

class _CreateLobbyPageState extends State<CreateLobbyPage> {
  late final CreateLobbyController _controller;
  late final TextEditingController _nameController;
  final PlayerNameStore _playerNameStore = PlayerNameStore();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  bool _isRestoringPlayerName = true;

  @override
  void initState() {
    super.initState();
    _controller = CreateLobbyController();
    _nameController = TextEditingController();
    _controller.loadCurrentPosition();
    _restorePlayerName();
    _restoreSocketEnvironment();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openDetailsSheet() async {
    final data = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => CreateLobbyDetailsSheet(initialData: _controller.form),
    );

    if (data is CreateLobbyDetailsResult) {
      _controller.updateForm(data.form);
    }
  }

  Future<void> _restorePlayerName() async {
    final saved = await _playerNameStore.load();
    if (!mounted) {
      return;
    }
    if (saved != null) {
      _nameController.text = saved;
      _controller.setDisplayName(saved);
    }
    setState(() {
      _isRestoringPlayerName = false;
    });
  }

  Future<void> _restoreSocketEnvironment() async {
    final config = await _socketEnvironmentService.loadConfig();
    if (!mounted) return;
    _controller.setServerUrl(config.serverUrl);
    _controller.setSocketPath(config.socketPath);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Créer une partie')),
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
                        'Créer une nouvelle partie',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                        ),
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
                          onChanged: _controller.setDisplayName,
                        ),
                      const SizedBox(height: 12),
                      FilledButton.tonal(
                        onPressed: _openDetailsSheet,
                        child: const Text('Détails Partie'),
                      ),
                      const SizedBox(height: 12),
                      if (_controller.isLoadingGps)
                        const SizedBox(
                          height: 300,
                          child: Center(
                            child: Text('Chargement de la position GPS...'),
                          ),
                        )
                      else if (_controller.currentPosition != null)
                        CreateLobbyMap(
                          currentPosition: _controller.currentPosition!,
                          selectedPosition: _controller.selectedPosition,
                          mapRadiusMeters: _controller.form.mapRadius,
                          objectiveZoneRadiusMeters:
                              _controller.form.objectiveZoneRadius,
                          startZoneRadiusMeters:
                              _controller.form.startZoneRadius,
                          streets: _controller.streets,
                          outerStreetContour: _controller.outerStreetContour,
                          objectives: _controller.objectives,
                          agentStartZone: _controller.agentStartZone,
                          rogueStartZone: _controller.rogueStartZone,
                          onTap: _controller.setSelectedPosition,
                        )
                      else
                        SizedBox(
                          height: 300,
                          child: Center(
                            child: Text(
                              _controller.lastError ??
                                  'Position GPS non disponible.',
                            ),
                          ),
                        ),
                      const SizedBox(height: 8),
                      if (_controller.isLoadingStreets)
                        const Text(
                          'Chargement des rues accessibles...',
                          style: TextStyle(fontSize: 13),
                        ),
                      if (_controller.selectedPosition == null &&
                          !_controller.isLoadingGps)
                        const Text(
                          'Cliquez sur la carte pour définir le centre de jeu.',
                          style: TextStyle(fontSize: 13),
                        ),
                      if (_controller.streetsLoadError != null) ...[
                        Text(
                          _controller.streetsLoadError!,
                          style: const TextStyle(
                            color: Colors.red,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: OutlinedButton(
                            onPressed: _controller.fetchStreets,
                            child: const Text('Réessayer chargement rues'),
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      FilledButton.tonal(
                        onPressed: _controller.generateObjectives,
                        child: const Text('Générer les objectifs'),
                      ),
                      const SizedBox(height: 8),
                      if (_controller.objectives.isNotEmpty)
                        Text(
                          'Objectifs: ${_controller.objectives.length} | '
                          'Contour: ${_controller.outerStreetContour.length >= 3 ? 'Rues' : 'Cercle'} | '
                          'Agent: ${_controller.agentStartZone != null ? 'OK' : 'N/A'} | '
                          'Rogue: ${_controller.rogueStartZone != null ? 'OK' : 'N/A'}',
                          style: const TextStyle(fontSize: 13),
                        ),
                      const SizedBox(height: 8),
                      FilledButton(
                        onPressed: _controller.canCreateLobby
                            ? () async {
                                await _controller.createLobby();
                                if (!mounted) {
                                  return;
                                }
                                if (_controller.createdLobbyCode != null) {
                                  await _playerNameStore.save(
                                    _controller.displayName,
                                  );
                                  if (!mounted) {
                                    return;
                                  }
                                  final session =
                                      _controller.createdLobbySession;
                                  final bootstrap = LobbyBootstrapData(
                                    code: _controller.createdLobbyCode!,
                                    serverUrl: _controller.serverUrl,
                                    socketPath: _controller.socketPath,
                                    playerName: _controller.displayName.trim(),
                                    previousPlayerId: session?.playerId,
                                    reconnectAsHost: true,
                                    form: _controller.form,
                                    objectives: _controller.objectives,
                                    agentStartZone: _controller.agentStartZone,
                                    rogueStartZone: _controller.rogueStartZone,
                                    outerStreetContour:
                                        _controller.outerStreetContour,
                                  );
                                  context.go(
                                    '${LobbyPage.routePath}?code=${_controller.createdLobbyCode}',
                                    extra: bootstrap,
                                  );
                                } else if (_controller.lastError != null) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(_controller.lastError!),
                                    ),
                                  );
                                }
                              }
                            : null,
                        child: Text(
                          _controller.isSubmitting
                              ? 'Création en cours...'
                              : 'Créer la partie',
                        ),
                      ),
                      if (_controller.lastError != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _controller.lastError!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
