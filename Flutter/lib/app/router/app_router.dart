import 'package:abstergo_chase/features/bootstrap/presentation/bootstrap_page.dart';
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
    ],
  );
}
