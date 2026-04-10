import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:abstergo_chase/features/lobby/data/player_name_store.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/lobby_page.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class JoinLobbyPage extends StatefulWidget {
  const JoinLobbyPage({super.key, this.initialCode});

  static const String routePath = '/join-lobby';
  static const String routeName = 'join-lobby';

  final String? initialCode;

  @override
  State<JoinLobbyPage> createState() => _JoinLobbyPageState();
}

class _JoinLobbyPageState extends State<JoinLobbyPage> {
  late final TextEditingController _nameController;
  late final TextEditingController _codeController;
  final PlayerNameStore _playerNameStore = PlayerNameStore();

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController();
    _codeController = TextEditingController(
      text: (widget.initialCode ?? '').trim().toUpperCase(),
    );
    _restorePlayerName();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _restorePlayerName() async {
    final saved = await _playerNameStore.load();
    if (!mounted || saved == null) {
      return;
    }
    _nameController.text = saved;
    setState(() {});
  }

  void _joinLobby() {
    final displayName = _nameController.text.trim();
    final code = _codeController.text.trim().toUpperCase();
    if (displayName.isEmpty) {
      _showError('Veuillez entrer un nom de joueur');
      return;
    }
    if (code.isEmpty) {
      _showError('Veuillez entrer un code de partie');
      return;
    }
    if (code.length != 6) {
      _showError('Le code de partie doit contenir exactement 6 caractères');
      return;
    }

    _playerNameStore.save(displayName);
    final bootstrap = LobbyBootstrapData(
      code: code,
      serverUrl: 'http://10.0.2.2:5174',
      socketPath: '/socket.io',
      playerName: displayName,
    );
    context.go('${LobbyPage.routePath}?code=$code', extra: bootstrap);
  }

  void _showError(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final code = _codeController.text.trim().toUpperCase();
    final canJoin = code.length == 6 && _nameController.text.trim().isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Rejoindre une partie')),
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
                    'Rejoindre une partie',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
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
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _codeController,
                    maxLength: 6,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'Code de la partie',
                      hintText: 'Entrez le code de la partie',
                    ),
                    onChanged: (value) {
                      final up = value.toUpperCase();
                      if (up != value) {
                        _codeController.value = _codeController.value.copyWith(
                          text: up,
                          selection:
                              TextSelection.collapsed(offset: up.length),
                        );
                      }
                      setState(() {});
                    },
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: canJoin ? _joinLobby : null,
                    child: const Text('Rejoindre la partie'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
