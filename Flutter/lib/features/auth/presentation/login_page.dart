import 'package:abstergo_chase/app/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  static const String routePath = '/login';
  static const String routeName = 'login';

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isSubmittingLocal = false;

  void _showInfo(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _submitLogin() async {
    if (_isSubmittingLocal) return;
    setState(() {
      _isSubmittingLocal = true;
    });
    try {
      final auth = ref.read(authControllerProvider);
      if (!auth.isConfigured) {
        _showInfo('Configuration Cognito manquante.');
        return;
      }
      final username = _usernameController.text.trim();
      final password = _passwordController.text;
      if (username.isEmpty || password.isEmpty) {
        _showInfo('Renseignez utilisateur et mot de passe avant de continuer.');
        return;
      }
      final ok = await auth.signIn(username: username, password: password);
      if (!ok && mounted && auth.error != null) {
        _showInfo(auth.error!);
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSubmittingLocal = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final isSubmitting = _isSubmittingLocal || auth.isSubmitting;
    final viewInsetsBottom = MediaQuery.of(context).viewInsets.bottom;
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion')),
      body: SafeArea(
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + viewInsetsBottom),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Stack(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextField(
                            controller: _usernameController,
                            enabled: !isSubmitting,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Utilisateur',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _passwordController,
                            enabled: !isSubmitting,
                            obscureText: true,
                            onSubmitted: (_) async {
                              if (isSubmitting) {
                                return;
                              }
                              await _submitLogin();
                            },
                            decoration: const InputDecoration(
                              labelText: 'Mot de passe',
                            ),
                          ),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: isSubmitting ? null : _submitLogin,
                            child: const Text('Se connecter'),
                          ),
                        ],
                      ),
                    ),
                    if (isSubmitting)
                      Positioned.fill(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Theme.of(
                              context,
                            ).colorScheme.surface.withOpacity(0.6),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          alignment: Alignment.center,
                          child: const CircularProgressIndicator(),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
