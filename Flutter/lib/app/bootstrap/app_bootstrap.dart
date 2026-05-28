import 'dart:async';

import 'package:broken_veil_protocol/app/app.dart';
import 'package:broken_veil_protocol/core/errors/global_error_handler.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void bootstrapApp() {
  runZonedGuarded<void>(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      GlobalErrorHandler.initialize();
      runApp(
        const ProviderScope(
          child: BrokenVeilProtocolApp(),
        ),
      );
    },
    GlobalErrorHandler.onZoneError,
  );
}
