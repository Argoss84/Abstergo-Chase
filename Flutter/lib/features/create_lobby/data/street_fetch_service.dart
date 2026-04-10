import 'dart:math';

import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:http/http.dart' as http;
import 'package:xml/xml.dart';

class StreetFetchService {
  const StreetFetchService();

  static const double _metersPerDegreeLat = 111320.0;
  static const int _maxAttemptsPerEndpoint = 3;
  static const Duration _requestTimeout = Duration(seconds: 15);

  static const Set<String> _disallowedHighways = <String>{
    'motorway',
    'motorway_link',
    'trunk',
    'trunk_link',
    'bus_guideway',
    'raceway',
    'construction',
    'proposed',
  };

  Future<List<List<GeoPoint>>> fetchWalkableStreets({
    required GeoPoint center,
    required int mapRadiusMeters,
  }) async {
    final bbox = _buildBbox(center, mapRadiusMeters.toDouble());
    final endpoints = <Uri>[
      Uri.https('api.openstreetmap.org', '/api/0.6/map', {'bbox': bbox}),
      Uri.https('www.openstreetmap.org', '/api/0.6/map', {'bbox': bbox}),
    ];

    Object? lastError;
    for (final endpoint in endpoints) {
      for (var attempt = 1; attempt <= _maxAttemptsPerEndpoint; attempt++) {
        try {
          final response = await http.get(endpoint).timeout(_requestTimeout);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            lastError = Exception(
              'Erreur récupération rues: ${response.statusCode} ${response.reasonPhrase}',
            );
            if (_shouldRetry(response.statusCode, attempt)) {
              await _backoffDelay(attempt);
              continue;
            }
            break;
          }

          final streets = _extractStreets(response.body, center: center);
          if (streets.isEmpty) {
            lastError =
                Exception('Aucune rue piétonne trouvée pour cette zone.');
            break;
          }
          return streets;
        } catch (error) {
          lastError = error;
          if (attempt < _maxAttemptsPerEndpoint) {
            await _backoffDelay(attempt);
            continue;
          }
          break;
        }
      }
    }

    throw Exception(
      'Impossible de charger les rues (service cartographique indisponible). Détail: $lastError',
    );
  }

  String _buildBbox(GeoPoint center, double radiusMeters) {
    final latDelta = radiusMeters / _metersPerDegreeLat;
    final lngMetersPerDegree =
        _metersPerDegreeLat * cos(center.latitude * pi / 180);
    final lngDelta = radiusMeters / max(lngMetersPerDegree.abs(), 1e-6);
    final minLon = center.longitude - lngDelta;
    final minLat = center.latitude - latDelta;
    final maxLon = center.longitude + lngDelta;
    final maxLat = center.latitude + latDelta;
    return '$minLon,$minLat,$maxLon,$maxLat';
  }

  bool _shouldRetry(int statusCode, int attempt) {
    if (attempt >= _maxAttemptsPerEndpoint) {
      return false;
    }
    return statusCode == 429 || statusCode >= 500;
  }

  Future<void> _backoffDelay(int attempt) async {
    await Future<void>.delayed(Duration(milliseconds: 400 * attempt));
  }

  List<List<GeoPoint>> _extractStreets(
    String body, {
    required GeoPoint center,
  }) {
    final XmlDocument document;
    try {
      document = XmlDocument.parse(body);
    } catch (_) {
      throw Exception('Réponse cartographique invalide.');
    }

    final root = document.rootElement;
    if (root.name.local != 'osm') {
      throw Exception('Réponse cartographique inattendue.');
    }

    final nodes = <int, GeoPoint>{};
    for (final node in root.findElements('node')) {
      final id = int.tryParse(node.getAttribute('id') ?? '');
      final lat = double.tryParse(node.getAttribute('lat') ?? '');
      final lon = double.tryParse(node.getAttribute('lon') ?? '');
      if (id != null && lat != null && lon != null) {
        nodes[id] = GeoPoint(latitude: lat, longitude: lon);
      }
    }

    final wayNodeLists = <List<int>>[];
    for (final way in root.findElements('way')) {
      if (!_isWalkableWay(way)) {
        continue;
      }

      final wayNodes = way
          .findElements('nd')
          .map((nd) => int.tryParse(nd.getAttribute('ref') ?? ''))
          .whereType<int>()
          .toList(growable: false);

      if (wayNodes.length >= 2) {
        wayNodeLists.add(wayNodes.toList(growable: true));
      }
    }

    final cleanedWays = _trimExteriorDeadEnds(
      center: center,
      wayNodeLists: wayNodeLists,
      nodes: nodes,
    );

    final streets = <List<GeoPoint>>[];
    for (final nodeList in cleanedWays) {
      final points = <GeoPoint>[];
      for (final nodeId in nodeList) {
        final point = nodes[nodeId];
        if (point != null) {
          points.add(point);
        }
      }
      if (points.length >= 2) {
        streets.add(points);
      }
    }
    return streets;
  }

  List<List<int>> _trimExteriorDeadEnds({
    required GeoPoint center,
    required List<List<int>> wayNodeLists,
    required Map<int, GeoPoint> nodes,
  }) {
    if (wayNodeLists.isEmpty) return const <List<int>>[];

    final allDistances = <double>[];
    for (final way in wayNodeLists) {
      for (final nodeId in way) {
        final point = nodes[nodeId];
        if (point != null) {
          allDistances.add(_distanceMeters(center, point));
        }
      }
    }
    allDistances.sort();
    final exteriorThreshold = allDistances.isEmpty
        ? 0.0
        : allDistances[((allDistances.length - 1) * 0.70).round()];

    final ways = wayNodeLists.map((w) => [...w]).toList(growable: true);
    for (var round = 0; round < 10; round++) {
      final degrees = _computeNodeDegrees(ways);
      var changed = false;

      for (final way in ways) {
        while (way.length >= 2 &&
            _isExteriorLeaf(
              nodeId: way.first,
              degrees: degrees,
              nodes: nodes,
              center: center,
              exteriorThreshold: exteriorThreshold,
            )) {
          way.removeAt(0);
          changed = true;
        }
        while (way.length >= 2 &&
            _isExteriorLeaf(
              nodeId: way.last,
              degrees: degrees,
              nodes: nodes,
              center: center,
              exteriorThreshold: exteriorThreshold,
            )) {
          way.removeLast();
          changed = true;
        }
      }

      ways.removeWhere((w) => w.length < 2);
      if (!changed) break;
    }
    return ways;
  }

  Map<int, int> _computeNodeDegrees(List<List<int>> ways) {
    final degree = <int, int>{};
    for (final way in ways) {
      for (var i = 0; i < way.length - 1; i++) {
        final a = way[i];
        final b = way[i + 1];
        degree[a] = (degree[a] ?? 0) + 1;
        degree[b] = (degree[b] ?? 0) + 1;
      }
    }
    return degree;
  }

  bool _isExteriorLeaf({
    required int nodeId,
    required Map<int, int> degrees,
    required Map<int, GeoPoint> nodes,
    required GeoPoint center,
    required double exteriorThreshold,
  }) {
    if ((degrees[nodeId] ?? 0) != 1) {
      return false;
    }
    final point = nodes[nodeId];
    if (point == null) {
      return false;
    }
    return _distanceMeters(center, point) >= exteriorThreshold;
  }

  double _distanceMeters(GeoPoint a, GeoPoint b) {
    const earthRadius = 6371000.0;
    final dLat = _degToRad(b.latitude - a.latitude);
    final dLng = _degToRad(b.longitude - a.longitude);
    final la1 = _degToRad(a.latitude);
    final la2 = _degToRad(b.latitude);
    final h = sin(dLat / 2) * sin(dLat / 2) +
        cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2);
    final c = 2 * atan2(sqrt(h), sqrt(1 - h));
    return earthRadius * c;
  }

  double _degToRad(double deg) => deg * pi / 180;

  bool _isWalkableWay(XmlElement way) {
    final tags = <String, String>{};
    for (final tag in way.findElements('tag')) {
      final key = tag.getAttribute('k');
      final value = tag.getAttribute('v');
      if (key != null && value != null) {
        tags[key] = value;
      }
    }

    if (tags['area'] == 'yes') {
      return false;
    }
    if (tags['foot'] == 'no' || tags['access'] == 'private') {
      return false;
    }

    final highway = tags['highway'];
    if (highway != null) {
      return !_disallowedHighways.contains(highway);
    }

    return tags['amenity'] == 'square' && tags['foot'] != 'no';
  }
}
