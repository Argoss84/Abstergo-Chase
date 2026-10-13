import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
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

      if (!mounted) return;
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
      if (!mounted) return;
      final fallbackUsername = auth.username?.trim() ?? '';
      _usernameController.text = fallbackUsername;
      _error = fallbackUsername.isEmpty
          ? 'Impossible de charger le profil. Réessayez dans un instant.'
          : 'Profil indisponible. Votre nom de connexion est utilisé temporairement.';
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

      if (!mounted) return;
      _usernameController.text = profile.username ?? '';
      _displayNameController.text = profile.displayName ?? '';
      _avatarUrlController.text = profile.avatarUrl ?? '';
      _bioController.text = profile.bio ?? '';
      _regionController.text = profile.region ?? '';
      _success = 'Profil mis à jour.';
    } catch (e) {
      if (e is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(e.message);
        return;
      }
      _error = 'Impossible d’enregistrer le profil. Réessayez dans un instant.';
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
      body: AppPageBody(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(20),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                children: [
                  const AppSectionHeading(
                    title: 'Votre profil',
                    subtitle:
                        'Votre nom de joueur permet à votre équipe de vous identifier.',
                  ),
                  const SizedBox(height: 20),
                  if (_error != null) ...[
                    AppNotice(message: _error!, isError: true),
                    const SizedBox(height: 16),
                  ],
                  if (_success != null) ...[
                    AppNotice(message: _success!),
                    const SizedBox(height: 16),
                  ],
                  TextField(
                    enabled: !_isSaving,
                    textInputAction: TextInputAction.next,
                    controller: _usernameController,
                    decoration: const InputDecoration(
                      labelText: 'Nom de joueur',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    enabled: !_isSaving,
                    textInputAction: TextInputAction.next,
                    controller: _displayNameController,
                    decoration: const InputDecoration(labelText: 'Nom affiché'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    enabled: !_isSaving,
                    textInputAction: TextInputAction.next,
                    controller: _avatarUrlController,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(labelText: 'URL avatar'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    enabled: !_isSaving,
                    textInputAction: TextInputAction.next,
                    controller: _regionController,
                    decoration: const InputDecoration(labelText: 'Région'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    enabled: !_isSaving,
                    textInputAction: TextInputAction.next,
                    controller: _bioController,
                    keyboardType: TextInputType.multiline,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(labelText: 'Bio'),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      FilledButton.icon(
                        onPressed: _isSaving ? null : _saveProfile,
                        icon: const Icon(Icons.save),
                        label: Text(
                          _isSaving ? 'Sauvegarde...' : 'Sauvegarder',
                        ),
                      ),
                      OutlinedButton.icon(
                        onPressed: _isSaving ? null : _loadProfile,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Actualiser'),
                      ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}
