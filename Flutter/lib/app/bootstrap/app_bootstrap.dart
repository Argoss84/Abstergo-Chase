import 'dart:async';

import 'package:abstergo_chase/app/app.dart';
import 'package:abstergo_chase/core/errors/global_error_handler.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void bootstrapApp() {
  runZonedGuarded<void>(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      GlobalErrorHandler.initialize();
      runApp(
        const ProviderScope(
          child: AbstergoChaseApp(),
        ),
      );
    },
    GlobalErrorHandler.onZoneError,
  );
}
