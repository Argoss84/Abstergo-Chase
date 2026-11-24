import 'dart:async';

import 'package:broken_veil_protocol/app/app.dart';
import 'package:broken_veil_protocol/core/errors/global_error_handler.dart';
import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:broken_veil_protocol/core/logging/error_journal.dart';
import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void bootstrapApp() {
  runZonedGuarded<void>(() {
    WidgetsFlutterBinding.ensureInitialized();
    AppLogger.setErrorSink(ErrorJournal.instance.record);
    GlobalErrorHandler.initialize();
    unawaited(
      PackageInfo.fromPlatform()
          .then((package) {
            AppLogger.appVersion = '${package.version}+${package.buildNumber}';
          })
          .catchError((Object _) {}),
    );
    runApp(const ProviderScope(child: BrokenVeilProtocolApp()));
  }, GlobalErrorHandler.onZoneError);
}
