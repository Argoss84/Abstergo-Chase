import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_defaults.dart';
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
  static const String _useProductionKey = 'socket.environment.use_production';

  Future<bool> useProduction() async {
    final prefs = await SharedPreferences.getInstance();
    // Default to development for local/docker test workflows.
    return prefs.getBool(_useProductionKey) ?? false;
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
