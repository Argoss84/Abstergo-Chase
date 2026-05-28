import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/shared/services/screen_awake_service.dart';
import 'package:broken_veil_protocol/shared/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class BrokenVeilProtocolApp extends ConsumerStatefulWidget {
  const BrokenVeilProtocolApp({super.key});

  @override
  ConsumerState<BrokenVeilProtocolApp> createState() => _BrokenVeilProtocolAppState();
}

class _BrokenVeilProtocolAppState extends ConsumerState<BrokenVeilProtocolApp>
    with WidgetsBindingObserver {
  final ScreenAwakeService _screenAwakeService = ScreenAwakeService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _screenAwakeService.applySavedSetting();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
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
