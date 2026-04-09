import 'package:abstergo_chase/features/create_lobby/data/create_lobby_service.dart';
import 'package:abstergo_chase/features/create_lobby/data/location_service.dart';
import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/foundation.dart';

class CreateLobbyController extends ChangeNotifier {
  CreateLobbyController({
    CreateLobbyService? service,
    LocationService? locationService,
  })  : _service = service ?? CreateLobbyService.instance,
        _locationService = locationService ?? const LocationService();

  final CreateLobbyService _service;
  final LocationService _locationService;

  CreateLobbyFormData form = CreateLobbyFormData.initial();
  String displayName = '';
  String serverUrl = 'http://10.0.2.2:5174';
  String socketPath = '/socket.io';
  bool isSubmitting = false;
  bool objectivesGenerated = false;
  bool isLoadingGps = false;
  GeoPoint? currentPosition;
  GeoPoint? selectedPosition;
  String? lastError;
  String? createdLobbyCode;

  bool get canCreateLobby =>
      !isSubmitting && displayName.trim().isNotEmpty && objectivesGenerated;

  void setDisplayName(String value) {
    displayName = value;
    notifyListeners();
  }

  void setServerUrl(String value) {
    serverUrl = value;
    notifyListeners();
  }

  void setSocketPath(String value) {
    socketPath = value;
    notifyListeners();
  }

  void updateForm(CreateLobbyFormData value) {
    form = value;
    notifyListeners();
  }

  Future<void> loadCurrentPosition() async {
    isLoadingGps = true;
    lastError = null;
    notifyListeners();

    try {
      final point = await _locationService.getCurrentPosition();
      currentPosition = point;
      selectedPosition = point;
      form = form.copyWith(
        mapCenterLatitude: point.latitude.toString(),
        mapCenterLongitude: point.longitude.toString(),
      );
    } catch (error) {
      lastError = error.toString();
    } finally {
      isLoadingGps = false;
      notifyListeners();
    }
  }

  void setSelectedPosition(GeoPoint point) {
    selectedPosition = point;
    form = form.copyWith(
      mapCenterLatitude: point.latitude.toString(),
      mapCenterLongitude: point.longitude.toString(),
    );
    objectivesGenerated = false;
    notifyListeners();
  }

  void generateObjectives() {
    objectivesGenerated = true;
    lastError = null;
    notifyListeners();
  }

  Future<void> createLobby() async {
    final uri = Uri.tryParse(serverUrl.trim());
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      lastError = 'URL serveur invalide.';
      notifyListeners();
      return;
    }
    if (displayName.trim().isEmpty) {
      lastError = 'Veuillez entrer un nom.';
      notifyListeners();
      return;
    }
    if (!objectivesGenerated) {
      lastError = 'Générez les objectifs avant de créer la partie.';
      notifyListeners();
      return;
    }

    isSubmitting = true;
    lastError = null;
    createdLobbyCode = null;
    notifyListeners();

    try {
      final code = await _service.createLobby(
        playerName: displayName.trim(),
        serverUrl: uri,
        socketPath:
            socketPath.trim().isEmpty ? '/socket.io' : socketPath.trim(),
      );
      createdLobbyCode = code;
    } catch (error) {
      lastError = error.toString();
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }
}
