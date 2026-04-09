import 'package:abstergo_chase/features/bootstrap/presentation/bootstrap_page.dart';
import 'package:abstergo_chase/features/create_lobby/presentation/create_lobby_page.dart';
import 'package:abstergo_chase/features/home/presentation/home_menu_page.dart';
import 'package:abstergo_chase/features/lab/presentation/lab_page.dart';
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
        name: 'join-lobby',
        builder: (context, state) =>
            const HomeMenuPage(title: 'Rejoindre une partie'),
      ),
      GoRoute(
        path: HomeMenuPage.sessionDiagnosticsPath,
        name: 'session-diagnostics',
        builder: (context, state) =>
            const HomeMenuPage(title: 'Diagnostic de session'),
      ),
    ],
  );
}
