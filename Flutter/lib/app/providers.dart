import 'package:abstergo_chase/app/router/app_router.dart';
import 'package:abstergo_chase/features/auth/application/cognito_auth_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

final authControllerProvider = Provider<CognitoAuthController>((ref) {
  final controller = CognitoAuthController();
  controller.initialize();
  ref.onDispose(controller.dispose);
  return controller;
});

final appRouterProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  return buildAppRouter(auth);
});
