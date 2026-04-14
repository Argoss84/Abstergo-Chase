import 'package:abstergo_chase/features/create_lobby/data/create_lobby_service.dart';
import 'package:abstergo_chase/features/create_lobby/data/street_contour_service.dart';
import 'package:abstergo_chase/features/create_lobby/data/location_service.dart';
import 'package:abstergo_chase/features/create_lobby/data/objective_generation_service.dart';
import 'package:abstergo_chase/features/create_lobby/data/street_fetch_service.dart';
import 'package:abstergo_chase/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/foundation.dart';

class CreateLobbyController extends ChangeNotifier {
  CreateLobbyController({
    CreateLobbyService? service,
    LocationService? locationService,
    ObjectiveGenerationService? objectiveGenerationService,
    StreetFetchService? streetFetchService,
    StreetContourService? streetContourService,
  })  : _service = service ?? CreateLobbyService.instance,
        _locationService = locationService ?? const LocationService(),
        _objectiveGenerationService =
            objectiveGenerationService ?? ObjectiveGenerationService(),
        _streetFetchService = streetFetchService ?? const StreetFetchService(),
        _streetContourService =
            streetContourService ?? const StreetContourService();

  final CreateLobbyService _service;
  final LocationService _locationService;
  final ObjectiveGenerationService _objectiveGenerationService;
  final StreetFetchService _streetFetchService;
  final StreetContourService _streetContourService;

  CreateLobbyFormData form = CreateLobbyFormData.initial();
  String displayName = '';
  String serverUrl = 'http://10.0.2.2:5174';
  String socketPath = '/socket.io';
  bool isSubmitting = false;
  bool objectivesGenerated = false;
  bool isLoadingGps = false;
  bool isLoadingStreets = false;
  GeoPoint? currentPosition;
  GeoPoint? selectedPosition;
  List<GeoPoint> objectives = <GeoPoint>[];
  GeoPoint? agentStartZone;
  GeoPoint? rogueStartZone;
  List<List<GeoPoint>> streets = <List<GeoPoint>>[];
  List<GeoPoint> outerStreetContour = <GeoPoint>[];
  String? streetsLoadError;
  String? lastError;
  String? createdLobbyCode;
  CreatedLobbySession? createdLobbySession;

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
      selectedPosition = null;
      streets = <List<GeoPoint>>[];
      outerStreetContour = <GeoPoint>[];
      streetsLoadError = null;
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
    objectives = <GeoPoint>[];
    agentStartZone = null;
    rogueStartZone = null;
    notifyListeners();
    fetchStreets();
  }

  void generateObjectives() {
    final center = selectedPosition;
    if (center == null) {
      lastError = 'Sélectionnez un centre de carte.';
      notifyListeners();
      return;
    }
    if (streets.isEmpty) {
      lastError =
          'Les rues doivent être chargées avant de générer les objectifs.';
      notifyListeners();
      return;
    }
    try {
      final result = _objectiveGenerationService.generate(
        center: center,
        mapRadiusMeters: form.mapRadius,
        objectiveCount: form.objectiveNumber,
        streets: streets,
      );
      objectives = result.objectives;
      agentStartZone = result.agentStartZone;
      rogueStartZone = result.rogueStartZone;
      objectivesGenerated = true;
      lastError = null;
    } catch (error) {
      objectivesGenerated = false;
      lastError = error.toString();
    }
    notifyListeners();
  }

  Future<void> fetchStreets() async {
    final center = selectedPosition;
    if (center == null) {
      streets = <List<GeoPoint>>[];
      outerStreetContour = <GeoPoint>[];
      streetsLoadError = null;
      notifyListeners();
      return;
    }

    isLoadingStreets = true;
    streetsLoadError = null;
    streets = <List<GeoPoint>>[];
    notifyListeners();

    try {
      final fetched = await _streetFetchService.fetchWalkableStreets(
        center: center,
        mapRadiusMeters: form.mapRadius,
      );
      streets = fetched;
      outerStreetContour = _streetContourService.computeOuterContour(
        center: center,
        radiusMeters: form.mapRadius,
        streets: streets,
      );
    } catch (error) {
      streetsLoadError = error.toString();
      outerStreetContour = <GeoPoint>[];
    } finally {
      isLoadingStreets = false;
      notifyListeners();
    }
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
    createdLobbySession = null;
    notifyListeners();

    try {
      final session = await _service.createLobby(
        playerName: displayName.trim(),
        serverUrl: uri,
        socketPath:
            socketPath.trim().isEmpty ? '/socket.io' : socketPath.trim(),
        gameConfig: <String, dynamic>{
          'objectif_number': form.objectiveNumber,
          'duration': form.duration,
          'victory_condition_nb_objectivs': form.victoryConditionObjectives,
          'hack_duration_ms': form.hackDurationMs,
          'objectiv_zone_radius': form.objectiveZoneRadius,
          'rogue_range': form.rogueRange,
          'agent_range': form.agentRange,
          'map_center_latitude': selectedPosition?.latitude.toString() ?? '',
          'map_center_longitude': selectedPosition?.longitude.toString() ?? '',
          'map_radius': form.mapRadius,
          'start_zone_latitude': agentStartZone?.latitude.toString(),
          'start_zone_longitude': agentStartZone?.longitude.toString(),
          'start_zone_rogue_latitude': rogueStartZone?.latitude.toString(),
          'start_zone_rogue_longitude': rogueStartZone?.longitude.toString(),
          'map_streets': outerStreetContour.length >= 3
              ? <dynamic>[
                  outerStreetContour
                      .map((p) => <double>[p.latitude, p.longitude])
                      .toList(growable: false),
                ]
              : null,
          'street_network': streets
              .where((street) => street.length >= 2)
              .map(
                (street) => street
                    .map((p) => <double>[p.latitude, p.longitude])
                    .toList(growable: false),
              )
              .toList(growable: false),
        },
      );
      createdLobbySession = session;
      createdLobbyCode = session.code;
    } catch (error) {
      lastError = error.toString();
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }
}
