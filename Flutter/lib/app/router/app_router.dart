import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'package:broken_veil_protocol/features/auth/presentation/login_page.dart';
import 'package:broken_veil_protocol/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:broken_veil_protocol/features/game/domain/game_models.dart';
import 'package:broken_veil_protocol/features/game/presentation/game_page.dart';
import 'package:broken_veil_protocol/features/home/presentation/home_menu_page.dart';
import 'package:broken_veil_protocol/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:broken_veil_protocol/features/settings/presentation/vibration_settings_page.dart';
import 'package:go_router/go_router.dart';

GoRouter buildAppRouter(CognitoAuthController authController) {
  return GoRouter(
    initialLocation: BootstrapPage.routePath,
    refreshListenable: authController,
    redirect: (context, state) {
      final isLoggingIn = state.uri.path == LoginPage.routePath;
      if (authController.isInitializing) {
        return null;
      }
      if (!authController.isAuthenticated) {
        return isLoggingIn ? null : LoginPage.routePath;
      }
      if (isLoggingIn) {
        return BootstrapPage.routePath;
      }
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: LoginPage.routePath,
        name: LoginPage.routeName,
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: BootstrapPage.routePath,
        name: BootstrapPage.routeName,
        builder: (context, state) => const BootstrapPage(),
      ),
      GoRoute(
        path: CreateLobbyPage.routePath,
        name: CreateLobbyPage.routeName,
        builder: (context, state) => const CreateLobbyPage(),
      ),
      GoRoute(
        path: HomeMenuPage.joinLobbyPath,
        name: JoinLobbyPage.routeName,
        builder: (context, state) =>
            JoinLobbyPage(initialCode: state.uri.queryParameters['code']),
      ),
      GoRoute(
        path: LobbyPage.routePath,
        name: LobbyPage.routeName,
        builder: (context, state) => LobbyPage(
          initialCode: state.uri.queryParameters['code'],
          bootstrapData: state.extra is LobbyBootstrapData
              ? state.extra! as LobbyBootstrapData
              : null,
        ),
      ),
      GoRoute(
        path: GamePage.routePath,
        name: GamePage.routeName,
        builder: (context, state) =>
            GamePage(bootstrap: state.extra! as GameBootstrapData),
      ),
      GoRoute(
        path: SettingsPage.routePath,
        name: SettingsPage.routeName,
        builder: (context, state) => const SettingsPage(),
      ),
      GoRoute(
        path: AccountPage.routePath,
        name: AccountPage.routeName,
        builder: (context, state) => const AccountPage(),
      ),
    ],
  );
}
