import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SocketEnvironmentConfig {
  const SocketEnvironmentConfig({
    required this.serverUrl,
    required this.socketPath,
    required this.useProduction,
  });

  final String serverUrl;
  final String socketPath;
  final bool useProduction;
}

class SocketEnvironmentService {
  SocketEnvironmentService({bool defaultUseProduction = kReleaseMode})
    : _defaultUseProduction = defaultUseProduction;

  static const String _useProductionKey = 'socket.environment.use_production';
  final bool _defaultUseProduction;

  Future<bool> useProduction() async {
    final prefs = await SharedPreferences.getInstance();
    // New store installations use production; local debug stays on Docker.
    return prefs.getBool(_useProductionKey) ?? _defaultUseProduction;
  }

  Future<void> setUseProduction(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_useProductionKey, value);
  }

  Future<SocketEnvironmentConfig> loadConfig() async {
    final prod = await useProduction();
    return SocketEnvironmentConfig(
      useProduction: prod,
      serverUrl: prod
          ? CreateLobbyDefaults.productionServerUrl
          : CreateLobbyDefaults.developmentServerUrl,
      socketPath: CreateLobbyDefaults.socketPath,
    );
  }
}
