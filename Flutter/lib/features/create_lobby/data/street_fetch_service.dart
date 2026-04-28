import 'dart:math';

import 'package:abstergo_chase/features/create_lobby/domain/geo_point.dart';
import 'package:http/http.dart' as http;
import 'package:xml/xml.dart';

class StreetFetchService {
  const StreetFetchService();

  static const double _metersPerDegreeLat = 111320.0;
  static const int _maxAttemptsPerEndpoint = 3;
  static const Duration _requestTimeout = Duration(seconds: 15);

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

          final streets = _extractStreets(response.body);
          if (streets.isEmpty) {
            lastError =
                Exception('Aucune rue trouvée pour cette zone.');
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

  List<List<GeoPoint>> _extractStreets(String body) {
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

    final streets = <List<GeoPoint>>[];
    for (final nodeList in wayNodeLists) {
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

  bool _isWalkableWay(XmlElement way) {
    final tags = <String, String>{};
    for (final tag in way.findElements('tag')) {
      final key = tag.getAttribute('k');
      final value = tag.getAttribute('v');
      if (key != null && value != null) {
        tags[key] = value;
      }
    }

    if (tags['area'] == 'yes') return false;
    return tags.containsKey('highway');
  }
}
