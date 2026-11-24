import 'package:broken_veil_protocol/app/router/app_router.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:broken_veil_protocol/features/account/application/play_billing.dart';
import 'package:broken_veil_protocol/shared/services/signaling_session.dart';

final authControllerProvider = Provider<CognitoAuthController>((ref) {
  final controller = CognitoAuthController();
  SignalingSession.ticketProvider = controller.signalingTicket;
  controller.initialize();
  ref.onDispose(controller.dispose);
  return controller;
});

final playBillingProvider = Provider<PlayBilling>((ref) {
  final billing = PlayBilling(ref.watch(authControllerProvider));
  ref.onDispose(billing.dispose);
  return billing;
});

final appRouterProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  final router = buildAppRouter(auth);
  ref.onDispose(router.dispose);
  return router;
});
