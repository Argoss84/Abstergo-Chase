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

  void _showInfo(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
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
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Authentification requise',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Connectez-vous avec votre utilisateur Cognito pour accéder à l’application.',
                      ),
                      if (!auth.isConfigured) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Configuration Cognito manquante. '
                          'Ajoutez --dart-define=COGNITO_USER_POOL_ID=... '
                          'et --dart-define=COGNITO_CLIENT_ID=... au lancement.',
                          style: TextStyle(
                            color: Colors.orange.shade300,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      const Divider(),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _usernameController,
                        enabled: !auth.isSubmitting,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Utilisateur',
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _passwordController,
                        enabled: !auth.isSubmitting,
                        obscureText: true,
                        onSubmitted: (_) async {
                          if (auth.isSubmitting || !auth.isConfigured) {
                            return;
                          }
                          final username = _usernameController.text.trim();
                          final password = _passwordController.text;
                          if (username.isEmpty || password.isEmpty) {
                            _showInfo(
                              'Renseignez utilisateur et mot de passe avant de continuer.',
                            );
                            return;
                          }
                          final ok = await auth.signIn(
                            username: username,
                            password: password,
                          );
                          if (!ok && mounted && auth.error != null) {
                            _showInfo(auth.error!);
                          }
                        },
                        decoration: const InputDecoration(
                          labelText: 'Mot de passe',
                        ),
                      ),
                      if (auth.error != null) ...[
                        const SizedBox(height: 10),
                        Text(
                          auth.error!,
                          style: const TextStyle(color: Colors.redAccent),
                        ),
                      ],
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: auth.isSubmitting
                            ? null
                            : () async {
                                if (!auth.isConfigured) {
                                  _showInfo('Configuration Cognito manquante.');
                                  return;
                                }
                                final username = _usernameController.text
                                    .trim();
                                final password = _passwordController.text;
                                if (username.isEmpty || password.isEmpty) {
                                  _showInfo(
                                    'Renseignez utilisateur et mot de passe avant de continuer.',
                                  );
                                  return;
                                }
                                final ok = await auth.signIn(
                                  username: username,
                                  password: password,
                                );
                                if (!ok && mounted && auth.error != null) {
                                  _showInfo(auth.error!);
                                }
                              },
                        child: auth.isSubmitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Se connecter'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
