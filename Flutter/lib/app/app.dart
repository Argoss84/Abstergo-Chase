import 'dart:async';

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:broken_veil_protocol/core/logging/error_journal.dart';
import 'package:broken_veil_protocol/shared/services/screen_awake_service.dart';
import 'package:broken_veil_protocol/shared/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class BrokenVeilProtocolApp extends ConsumerStatefulWidget {
  const BrokenVeilProtocolApp({super.key});

  @override
  ConsumerState<BrokenVeilProtocolApp> createState() =>
      _BrokenVeilProtocolAppState();
}

class _BrokenVeilProtocolAppState extends ConsumerState<BrokenVeilProtocolApp>
    with WidgetsBindingObserver {
  final ScreenAwakeService _screenAwakeService = ScreenAwakeService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final auth = ref.read(authControllerProvider);
    ref.read(playBillingProvider);
    unawaited(
      ErrorJournal.instance
          .initialize(
            accessTokenProvider: () =>
                auth.isAuthenticated ? auth.getAccessToken() : Future.value(),
            isAuthenticated: () => auth.isAuthenticated,
          )
          .catchError((Object _) {}),
    );
    _screenAwakeService.applySavedSetting();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    AppLogger.appState = state.name;
    if (state == AppLifecycleState.resumed) {
      ErrorJournal.instance.scheduleUpload();
      unawaited(ref.read(playBillingProvider).refresh());
      _screenAwakeService.applySavedSetting();
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: 'Broken Veil Protocol',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
