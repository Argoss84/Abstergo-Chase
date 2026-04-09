import 'package:abstergo_chase/features/create_lobby/application/create_lobby_controller.dart';
import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_map.dart';
import 'package:flutter/material.dart';

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
  late final TextEditingController _serverController;
  late final TextEditingController _pathController;

  @override
  void initState() {
    super.initState();
    _controller = CreateLobbyController();
    _nameController = TextEditingController();
    _serverController = TextEditingController(text: _controller.serverUrl);
    _pathController = TextEditingController(text: _controller.socketPath);
    _controller.loadCurrentPosition();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _serverController.dispose();
    _pathController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openDetailsSheet() async {
    final data = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => CreateLobbyDetailsSheet(initialData: _controller.form),
    );

    if (data != null) {
      _controller.updateForm(data);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Créer une partie'),
          ),
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
                      TextField(
                        controller: _serverController,
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          labelText: 'URL serveur',
                        ),
                        onChanged: _controller.setServerUrl,
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _pathController,
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          labelText: 'Socket path',
                        ),
                        onChanged: _controller.setSocketPath,
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
                      else if (_controller.currentPosition != null &&
                          _controller.selectedPosition != null)
                        CreateLobbyMap(
                          currentPosition: _controller.currentPosition!,
                          selectedPosition: _controller.selectedPosition!,
                          mapRadiusMeters: _controller.form.mapRadius,
                          objectiveZoneRadiusMeters:
                              _controller.form.objectiveZoneRadius,
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
                      FilledButton.tonal(
                        onPressed: _controller.generateObjectives,
                        child: const Text('Générer les objectifs'),
                      ),
                      const SizedBox(height: 8),
                      if (_controller.objectives.isNotEmpty)
                        Text(
                          'Objectifs: ${_controller.objectives.length} | '
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
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        'Lobby créé: ${_controller.createdLobbyCode}',
                                      ),
                                    ),
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
