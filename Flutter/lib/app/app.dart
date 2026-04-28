import 'package:abstergo_chase/app/providers.dart';
import 'package:abstergo_chase/shared/services/screen_awake_service.dart';
import 'package:abstergo_chase/shared/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AbstergoChaseApp extends ConsumerStatefulWidget {
  const AbstergoChaseApp({super.key});

  @override
  ConsumerState<AbstergoChaseApp> createState() => _AbstergoChaseAppState();
}

class _AbstergoChaseAppState extends ConsumerState<AbstergoChaseApp>
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
      title: 'AbstergoChase',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
