import 'package:abstergo_chase/app/providers.dart';
import 'package:abstergo_chase/features/account/data/account_api_service.dart';
import 'package:abstergo_chase/features/create_lobby/application/create_lobby_controller.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/widgets/create_lobby_map.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/lobby_page.dart';
import 'package:abstergo_chase/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class CreateLobbyPage extends ConsumerStatefulWidget {
  const CreateLobbyPage({super.key});

  static const String routePath = '/create-lobby';
  static const String routeName = 'create-lobby';

  @override
  ConsumerState<CreateLobbyPage> createState() => _CreateLobbyPageState();
}

class _CreateLobbyPageState extends ConsumerState<CreateLobbyPage> {
  late final CreateLobbyController _controller;
  final AccountApiService _accountApiService = AccountApiService();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  bool _isLoadingAccountUsername = true;

  @override
  void initState() {
    super.initState();
    _controller = CreateLobbyController();
    _controller.loadCurrentPosition();
    _loadAccountUsername();
    _restoreSocketEnvironment();
  }

  @override
  void dispose() {
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

  Future<void> _loadAccountUsername() async {
    if (!mounted) {
      return;
    }
    try {
      final auth = ref.read(authControllerProvider);
      final token = await auth.getAccessToken();
      if (token == null || token.isEmpty) {
        throw Exception('Session invalide, reconnectez-vous.');
      }
      await _accountApiService.syncUser(token, username: auth.username);
      final profile = await _accountApiService.getMyProfile(token);
      _controller.cognitoSub = await auth.getCurrentUserSub();
      final username = profile.username?.trim() ?? '';
      if (username.isEmpty) {
        throw Exception(
          'Username manquant. Configurez-le dans "Mon compte" avant de creer une partie.',
        );
      }
      _controller.setDisplayName(username);
    } catch (error) {
      if (error is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(error.message);
        return;
      }
      _controller.lastError = error.toString();
    }
    setState(() {
      _isLoadingAccountUsername = false;
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
                      if (_isLoadingAccountUsername)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 10),
                          child: LinearProgressIndicator(minHeight: 2),
                        )
                      else
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.person),
                          title: const Text('Joueur connecte'),
                          subtitle: Text(
                            _controller.displayName.isEmpty
                                ? 'Username non configure (Mon compte)'
                                : _controller.displayName,
                          ),
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
                      if (_controller.selectedPosition != null)
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
                      if (_controller.objectives.isNotEmpty)
                        FilledButton(
                          onPressed: _controller.canCreateLobby
                              ? () async {
                                  await _controller.createLobby();
                                  if (!mounted) {
                                    return;
                                  }
                                  if (_controller.createdLobbyCode != null) {
                                    final session =
                                        _controller.createdLobbySession;
                                    final bootstrap = LobbyBootstrapData(
                                      code: _controller.createdLobbyCode!,
                                      serverUrl: _controller.serverUrl,
                                      socketPath: _controller.socketPath,
                                      playerName: _controller.displayName
                                          .trim(),
                                      cognitoSub: _controller.cognitoSub,
                                      previousPlayerId: session?.playerId,
                                      reconnectAsHost: true,
                                      form: _controller.form,
                                      objectives: _controller.objectives,
                                      agentStartZone:
                                          _controller.agentStartZone,
                                      rogueStartZone:
                                          _controller.rogueStartZone,
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
