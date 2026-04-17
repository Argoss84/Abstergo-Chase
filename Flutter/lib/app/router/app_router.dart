import 'package:abstergo_chase/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:abstergo_chase/features/game/domain/game_models.dart';
import 'package:abstergo_chase/features/game/presentation/game_page.dart';
import 'package:abstergo_chase/features/home/presentation/home_menu_page.dart';
import 'package:abstergo_chase/features/join_lobby/presentation/join_lobby_page.dart';
import 'package:abstergo_chase/features/lab/presentation/lab_page.dart';
import 'package:abstergo_chase/features/lobby/domain/lobby_models.dart';
import 'package:abstergo_chase/features/lobby/presentation/lobby_page.dart';
import 'package:abstergo_chase/features/settings/presentation/vibration_settings_page.dart';
import 'package:go_router/go_router.dart';

GoRouter buildAppRouter() {
  return GoRouter(
    initialLocation: BootstrapPage.routePath,
    routes: <RouteBase>[
      GoRoute(
        path: BootstrapPage.routePath,
        name: BootstrapPage.routeName,
        builder: (context, state) => const BootstrapPage(),
      ),
      GoRoute(
        path: LabPage.routePath,
        name: LabPage.routeName,
        builder: (context, state) => const LabPage(),
      ),
      GoRoute(
        path: CreateLobbyPage.routePath,
        name: CreateLobbyPage.routeName,
        builder: (context, state) => const CreateLobbyPage(),
      ),
      GoRoute(
        path: HomeMenuPage.joinLobbyPath,
        name: JoinLobbyPage.routeName,
        builder: (context, state) => JoinLobbyPage(
          initialCode: state.uri.queryParameters['code'],
        ),
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
        builder: (context, state) => GamePage(
          bootstrap: state.extra! as GameBootstrapData,
        ),
      ),
      GoRoute(
        path: SettingsPage.routePath,
        name: SettingsPage.routeName,
        builder: (context, state) => const SettingsPage(),
      ),
    ],
  );
}
