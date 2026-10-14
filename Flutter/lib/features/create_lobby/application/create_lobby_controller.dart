import 'dart:async';

import 'package:broken_veil_protocol/features/create_lobby/data/create_lobby_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/street_contour_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/location_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/objective_generation_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/street_fetch_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/data/street_snap_service.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_defaults.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/create_lobby_form_data.dart';
import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:flutter/foundation.dart';

class CreateLobbyController extends ChangeNotifier {
  CreateLobbyController({
    CreateLobbyService? service,
    LocationService? locationService,
    ObjectiveGenerationService? objectiveGenerationService,
    StreetFetchService? streetFetchService,
    StreetContourService? streetContourService,
    StreetSnapService? streetSnapService,
  }) : _service = service ?? CreateLobbyService(),
       _locationService = locationService ?? const LocationService(),
       _objectiveGenerationService =
           objectiveGenerationService ?? ObjectiveGenerationService(),
       _streetFetchService = streetFetchService ?? const StreetFetchService(),
       _streetContourService =
           streetContourService ?? const StreetContourService(),
       _streetSnapService = streetSnapService ?? const StreetSnapService();

  final CreateLobbyService _service;
  final LocationService _locationService;
  final ObjectiveGenerationService _objectiveGenerationService;
  final StreetFetchService _streetFetchService;
  final StreetContourService _streetContourService;
  final StreetSnapService _streetSnapService;
  bool _disposed = false;
  int _streetRequestId = 0;
  StreetFetchCancellation? _streetCancellation;

  CreateLobbyFormData form = CreateLobbyFormData.initial();
  String displayName = '';
  String? cognitoSub;
  String serverUrl = CreateLobbyDefaults.serverUrl;
  String socketPath = CreateLobbyDefaults.socketPath;
  bool isSubmitting = false;
  bool objectivesGenerated = false;
  bool isManualPlacement = false;
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
      !isSubmitting &&
      !isLoadingStreets &&
      selectedPosition != null &&
      displayName.trim().isNotEmpty &&
      objectivesGenerated &&
      hasCompleteMapConfiguration;

  bool get hasCompleteMapConfiguration =>
      agentStartZone != null &&
      rogueStartZone != null &&
      objectives.length == form.objectiveNumber;

  String? get manualPlacementInstruction {
    if (!isManualPlacement) {
      return null;
    }
    if (agentStartZone == null) {
      return 'Placez la zone de départ des agents.';
    }
    if (rogueStartZone == null) {
      return 'Placez la zone de départ des rogues.';
    }
    if (objectives.length < form.objectiveNumber) {
      return 'Placez l’objectif ${objectives.length + 1}/${form.objectiveNumber}.';
    }
    return 'Configuration manuelle complète.';
  }

  void setDisplayName(String value) {
    if (_disposed || displayName == value) return;
    displayName = value;
    notifyListeners();
  }

  void setServerUrl(String value) {
    if (_disposed || serverUrl == value) return;
    serverUrl = value;
    notifyListeners();
  }

  void setSocketPath(String value) {
    if (_disposed || socketPath == value) return;
    socketPath = value;
    notifyListeners();
  }

  void updateForm(CreateLobbyFormData value) {
    if (_disposed) return;
    final objectiveCountChanged = value.objectiveNumber != form.objectiveNumber;
    final radiusChanged = value.mapRadius != form.mapRadius;
    form = value;
    if (objectiveCountChanged || radiusChanged) {
      _resetMapConfiguration();
    }
    if (radiusChanged && selectedPosition != null) {
      unawaited(fetchStreets());
    } else {
      notifyListeners();
    }
  }

  Future<void> loadCurrentPosition() async {
    if (_disposed || isLoadingGps) return;
    isLoadingGps = true;
    lastError = null;
    notifyListeners();

    try {
      final point = await _locationService.getCurrentPosition();
      if (_disposed) return;
      currentPosition = point;
      selectedPosition = null;
      _streetRequestId++;
      _streetCancellation?.cancel();
      isLoadingStreets = false;
      _resetMapConfiguration();
      streets = <List<GeoPoint>>[];
      outerStreetContour = <GeoPoint>[];
      streetsLoadError = null;
    } on TimeoutException {
      if (_disposed) return;
      lastError =
          'Aucune position GPS reçue. Vérifiez la localisation et réessayez.';
    } catch (error) {
      if (_disposed) return;
      lastError = error.toString();
    } finally {
      isLoadingGps = false;
      if (!_disposed) notifyListeners();
    }
  }

  void setSelectedPosition(GeoPoint point) {
    if (_disposed) return;
    selectedPosition = point;
    form = form.copyWith(
      mapCenterLatitude: point.latitude.toString(),
      mapCenterLongitude: point.longitude.toString(),
    );
    _resetMapConfiguration();
    notifyListeners();
    fetchStreets();
  }

  void handleMapTap(GeoPoint point) {
    if (_disposed) return;
    if (isManualPlacement) {
      _placeManualPoint(point);
      return;
    }
    setSelectedPosition(point);
  }

  void beginManualPlacement() {
    if (_disposed || isLoadingStreets) return;
    if (selectedPosition == null) {
      lastError = 'Sélectionnez un centre de carte.';
      notifyListeners();
      return;
    }
    if (!streets.any((street) => street.length >= 2)) {
      _resetMapConfiguration();
      lastError = 'Les rues doivent être chargées avant de placer les points.';
      notifyListeners();
      return;
    }
    _resetMapConfiguration();
    isManualPlacement = true;
    lastError = null;
    notifyListeners();
  }

  void _placeManualPoint(GeoPoint point) {
    final snappedPoint = _streetSnapService.snapToNearestStreet(
      point: point,
      streets: streets,
    );
    if (snappedPoint == null) {
      lastError = 'Aucune rue accessible disponible.';
      notifyListeners();
      return;
    }
    if (agentStartZone == null) {
      agentStartZone = snappedPoint;
    } else if (rogueStartZone == null) {
      rogueStartZone = snappedPoint;
    } else if (objectives.length < form.objectiveNumber) {
      objectives = <GeoPoint>[...objectives, snappedPoint];
    }
    objectivesGenerated = hasCompleteMapConfiguration;
    lastError = null;
    notifyListeners();
  }

  void _resetMapConfiguration() {
    objectivesGenerated = false;
    isManualPlacement = false;
    objectives = <GeoPoint>[];
    agentStartZone = null;
    rogueStartZone = null;
  }

  void generateObjectives() {
    if (_disposed || isLoadingStreets) return;
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
        finalZoneContour: outerStreetContour,
      );
      objectives = result.objectives;
      agentStartZone = result.agentStartZone;
      rogueStartZone = result.rogueStartZone;
      objectivesGenerated = hasCompleteMapConfiguration;
      isManualPlacement = false;
      lastError = null;
    } catch (error) {
      objectivesGenerated = false;
      lastError = error.toString();
    }
    notifyListeners();
  }

  Future<void> fetchStreets() async {
    if (_disposed) return;
    _streetCancellation?.cancel();
    final requestId = ++_streetRequestId;
    final center = selectedPosition;
    final radius = form.mapRadius;
    if (center == null) {
      isLoadingStreets = false;
      _streetCancellation = null;
      _resetMapConfiguration();
      streets = <List<GeoPoint>>[];
      outerStreetContour = <GeoPoint>[];
      streetsLoadError = null;
      notifyListeners();
      return;
    }

    isLoadingStreets = true;
    final cancellation = _streetCancellation = StreetFetchCancellation();
    streetsLoadError = null;
    streets = <List<GeoPoint>>[];
    outerStreetContour = <GeoPoint>[];
    _resetMapConfiguration();
    notifyListeners();

    try {
      final fetched = await _streetFetchService.fetchWalkableStreets(
        center: center,
        mapRadiusMeters: radius,
        cancellation: cancellation,
      );
      if (_disposed || requestId != _streetRequestId) return;
      final contour = await _streetContourService.computeOuterContourAsync(
        center: center,
        radiusMeters: radius,
        streets: fetched,
      );
      if (_disposed || requestId != _streetRequestId) return;
      streets = fetched;
      outerStreetContour = contour;
    } catch (error) {
      if (_disposed || requestId != _streetRequestId) return;
      streetsLoadError = error.toString();
      outerStreetContour = <GeoPoint>[];
    } finally {
      cancellation.cancel();
      if (identical(_streetCancellation, cancellation)) {
        _streetCancellation = null;
      }
      if (!_disposed && requestId == _streetRequestId) {
        isLoadingStreets = false;
        notifyListeners();
      }
    }
  }

  Future<void> createLobby() async {
    if (_disposed || isSubmitting || isLoadingStreets) return;
    final uri = Uri.tryParse(serverUrl.trim());
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      lastError = 'Connexion impossible : paramètres invalides.';
      notifyListeners();
      return;
    }
    if (displayName.trim().isEmpty) {
      lastError = 'Veuillez entrer un nom.';
      notifyListeners();
      return;
    }
    if (!hasCompleteMapConfiguration) {
      lastError = 'Générez ou placez tous les points avant de créer la partie.';
      notifyListeners();
      return;
    }

    isSubmitting = true;
    lastError = null;
    createdLobbyCode = null;
    createdLobbySession = null;
    notifyListeners();

    try {
      final safeDuration = form.duration > 0 ? form.duration : 900;
      final session = await _service.createLobby(
        playerName: displayName.trim(),
        serverUrl: uri,
        socketPath: socketPath.trim().isEmpty
            ? '/socket.io'
            : socketPath.trim(),
        cognitoSub: cognitoSub,
        gameConfig: <String, dynamic>{
          'objectif_number': form.objectiveNumber,
          'duration': safeDuration,
          'victory_condition_nb_objectivs': form.victoryConditionObjectives,
          'hack_duration_ms': form.hackDurationMs,
          'start_zone_radius': form.startZoneRadius,
          'rogue_range': form.rogueRange,
          'agent_range': form.agentRange,
          'map_center_latitude': selectedPosition?.latitude.toString() ?? '',
          'map_center_longitude': selectedPosition?.longitude.toString() ?? '',
          'map_radius': form.mapRadius,
          'start_zone_latitude': agentStartZone?.latitude.toString(),
          'start_zone_longitude': agentStartZone?.longitude.toString(),
          'start_zone_rogue_latitude': rogueStartZone?.latitude.toString(),
          'start_zone_rogue_longitude': rogueStartZone?.longitude.toString(),
          'objective_points': objectives
              .map((p) => <double>[p.latitude, p.longitude])
              .toList(growable: false),
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
      if (_disposed) return;
      createdLobbySession = session;
      createdLobbyCode = session.code;
    } catch (error) {
      if (_disposed) return;
      lastError = error.toString();
    } finally {
      isSubmitting = false;
      if (!_disposed) notifyListeners();
    }
  }

  void releaseSignalingSocket() {
    _service.disconnect();
  }

  @override
  void dispose() {
    _disposed = true;
    _streetCancellation?.cancel();
    _service.disconnect();
    super.dispose();
  }
}
