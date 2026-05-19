import 'package:abstergo_chase/app/providers.dart';
import 'package:abstergo_chase/features/account/data/account_api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AccountPage extends ConsumerStatefulWidget {
  const AccountPage({super.key});

  static const String routePath = '/account';
  static const String routeName = 'account';

  @override
  ConsumerState<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends ConsumerState<AccountPage> {
  final AccountApiService _accountApi = AccountApiService();

  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _displayNameController = TextEditingController();
  final TextEditingController _avatarUrlController = TextEditingController();
  final TextEditingController _bioController = TextEditingController();
  final TextEditingController _regionController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  String? _error;
  String? _success;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _displayNameController.dispose();
    _avatarUrlController.dispose();
    _bioController.dispose();
    _regionController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    setState(() {
      _isLoading = true;
      _error = null;
      _success = null;
    });
    final auth = ref.read(authControllerProvider);
    try {
      final token = await auth.getAccessToken();
      if (token == null || token.isEmpty) {
        throw Exception('Session invalide, reconnectez-vous.');
      }

      await _accountApi.syncUser(token, username: auth.username);
      final profile = await _accountApi.getMyProfile(token);

      _usernameController.text = profile.username ?? '';
      _displayNameController.text = profile.displayName ?? '';
      _avatarUrlController.text = profile.avatarUrl ?? '';
      _bioController.text = profile.bio ?? '';
      _regionController.text = profile.region ?? '';
    } catch (e) {
      if (e is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(e.message);
        return;
      }
      final fallbackUsername = auth.username?.trim() ?? '';
      _usernameController.text = fallbackUsername;
      _error = fallbackUsername.isEmpty
          ? 'Chargement profil impossible: $e'
          : 'BDD inaccessible: username Cognito utilise temporairement.';
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _saveProfile() async {
    setState(() {
      _isSaving = true;
      _error = null;
      _success = null;
    });
    try {
      final token = await ref.read(authControllerProvider).getAccessToken();
      if (token == null || token.isEmpty) {
        throw Exception('Session invalide, reconnectez-vous.');
      }

      final profile = await _accountApi.updateMyProfile(
        token,
        username: _usernameController.text,
        displayName: _displayNameController.text,
        avatarUrl: _avatarUrlController.text,
        bio: _bioController.text,
        region: _regionController.text,
      );

      _usernameController.text = profile.username ?? '';
      _displayNameController.text = profile.displayName ?? '';
      _avatarUrlController.text = profile.avatarUrl ?? '';
      _bioController.text = profile.bio ?? '';
      _regionController.text = profile.region ?? '';
      _success = 'Profil mis a jour.';
    } catch (e) {
      if (e is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(e.message);
        return;
      }
      _error = 'Mise a jour impossible: $e';
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mon compte')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                  ),
                if (_success != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _success!,
                      style: const TextStyle(color: Colors.greenAccent),
                    ),
                  ),
                TextField(
                  controller: _usernameController,
                  decoration: const InputDecoration(labelText: 'Username'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _displayNameController,
                  decoration: const InputDecoration(labelText: 'Nom affiche'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _avatarUrlController,
                  decoration: const InputDecoration(labelText: 'URL avatar'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _regionController,
                  decoration: const InputDecoration(labelText: 'Region'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _bioController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Bio'),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    FilledButton.icon(
                      onPressed: _isSaving ? null : _saveProfile,
                      icon: const Icon(Icons.save),
                      label: Text(_isSaving ? 'Sauvegarde...' : 'Sauvegarder'),
                    ),
                    const SizedBox(width: 12),
                    OutlinedButton.icon(
                      onPressed: _isSaving ? null : _loadProfile,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Rafraichir'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
