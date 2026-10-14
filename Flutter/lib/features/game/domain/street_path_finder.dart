import 'dart:collection';

import 'package:broken_veil_protocol/features/create_lobby/domain/geo_point.dart';
import 'package:geolocator/geolocator.dart';

/// Reuses the street graph and the route until its geometry or endpoints change.
/// Street lists are treated as immutable snapshots, as in LobbyGameConfig.
class StreetPathFinder {
  List<List<GeoPoint>>? _streets;
  final List<GeoPoint> _nodes = [];
  final List<Map<int, double>> _adjacency = [];
  GeoPoint? _lastStart;
  GeoPoint? _lastTarget;
  List<GeoPoint>? _lastPath;

  List<GeoPoint> findPath({
    required GeoPoint start,
    required GeoPoint target,
    required List<List<GeoPoint>> streets,
  }) {
    if (!identical(_streets, streets)) {
      _buildGraph(streets);
      _lastPath = null;
    }
    if (_lastPath != null &&
        _samePoint(_lastStart, start) &&
        _samePoint(_lastTarget, target)) {
      return _lastPath!;
    }
    _lastStart = start;
    _lastTarget = target;
    return _lastPath = List<GeoPoint>.unmodifiable(_findPath(start, target));
  }

  bool _samePoint(GeoPoint? a, GeoPoint b) =>
      a?.latitude == b.latitude && a?.longitude == b.longitude;

  void _buildGraph(List<List<GeoPoint>> streets) {
    _streets = streets;
    _nodes.clear();
    _adjacency.clear();
    final indices = <String, int>{};

    int nodeIndex(GeoPoint point) {
      final key =
          '${point.latitude.toStringAsFixed(6)},${point.longitude.toStringAsFixed(6)}';
      return indices.putIfAbsent(key, () {
        _nodes.add(point);
        _adjacency.add(<int, double>{});
        return _nodes.length - 1;
      });
    }

    for (final street in streets) {
      if (street.length < 2) continue;
      var previous = nodeIndex(street.first);
      for (final point in street.skip(1)) {
        final current = nodeIndex(point);
        if (previous != current) {
          final weight = _distance(_nodes[previous], _nodes[current]);
          final oldWeight = _adjacency[previous][current];
          if (oldWeight == null || weight < oldWeight) {
            _adjacency[previous][current] = weight;
            _adjacency[current][previous] = weight;
          }
        }
        previous = current;
      }
    }
  }

  List<GeoPoint> _findPath(GeoPoint start, GeoPoint target) {
    if (_nodes.length < 2) return const [];
    final startIndex = _nearestNode(start);
    final targetIndex = _nearestNode(target);
    final distances = List<double>.filled(_nodes.length, double.infinity);
    final previous = List<int>.filled(_nodes.length, -1);
    final visited = <int>{};
    final pending = SplayTreeSet<(double, int)>((a, b) {
      final distanceOrder = a.$1.compareTo(b.$1);
      return distanceOrder != 0 ? distanceOrder : a.$2.compareTo(b.$2);
    });
    distances[startIndex] = 0;
    pending.add((0, startIndex));

    while (pending.isNotEmpty) {
      final (distance, node) = pending.first;
      pending.remove(pending.first);
      if (node == targetIndex) break;
      visited.add(node);
      for (final edge in _adjacency[node].entries) {
        if (visited.contains(edge.key)) continue;
        final candidate = distance + edge.value;
        if (candidate >= distances[edge.key]) continue;
        pending.remove((distances[edge.key], edge.key));
        distances[edge.key] = candidate;
        previous[edge.key] = node;
        pending.add((candidate, edge.key));
      }
    }
    if (!distances[targetIndex].isFinite) return const [];

    final reverse = <GeoPoint>[_nodes[targetIndex]];
    var cursor = targetIndex;
    while (cursor != startIndex) {
      cursor = previous[cursor];
      if (cursor < 0) return const [];
      reverse.add(_nodes[cursor]);
    }
    return [start, ...reverse.reversed, target];
  }

  int _nearestNode(GeoPoint target) {
    var nearest = 0;
    var minimum = double.infinity;
    for (var i = 0; i < _nodes.length; i++) {
      final distance = _distance(_nodes[i], target);
      if (distance < minimum) {
        minimum = distance;
        nearest = i;
      }
    }
    return nearest;
  }

  double _distance(GeoPoint a, GeoPoint b) => Geolocator.distanceBetween(
    a.latitude,
    a.longitude,
    b.latitude,
    b.longitude,
  );
}
