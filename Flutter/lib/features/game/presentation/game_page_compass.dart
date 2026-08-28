part of 'game_page.dart';

class _CompassTarget {
  const _CompassTarget({
    required this.label,
    required this.icon,
    required this.color,
    required this.bearingDeg,
    required this.distanceMeters,
  });

  final String label;
  final IconData icon;
  final Color color;
  final double bearingDeg;
  final double distanceMeters;
}

class _CompassBanner extends StatelessWidget {
  const _CompassBanner({
    required this.roleUpper,
    required this.headingDeg,
    required this.myPosition,
    required this.players,
    required this.objectives,
    required this.selfPlayerId,
  });

  final String roleUpper;
  final double? headingDeg;
  final GeoPoint? myPosition;
  final List<GamePlayer> players;
  final List<GameObjective> objectives;
  final String? selfPlayerId;

  @override
  Widget build(BuildContext context) {
    if (myPosition == null) return const SizedBox.shrink();
    final heading = headingDeg;
    final targets = _buildTargets();
    if (targets.isEmpty) return const SizedBox.shrink();

    return _FpsCompassBar(headingDeg: heading, targets: targets);
  }

  List<_CompassTarget> _buildTargets() {
    final meId = selfPlayerId;
    final mePos = myPosition!;
    final out = <_CompassTarget>[];

    void addPlayer(
      GamePlayer p, {
      required IconData icon,
      required Color color,
    }) {
      if (meId != null && p.id == meId) return;
      if ((p.status).toLowerCase() == 'disconnected') return;
      if ((p.status).toUpperCase() == 'CAPTURED') return;
      if (p.latitude == null || p.longitude == null) return;
      final bearing = Geolocator.bearingBetween(
        mePos.latitude,
        mePos.longitude,
        p.latitude!,
        p.longitude!,
      );
      final d = Geolocator.distanceBetween(
        mePos.latitude,
        mePos.longitude,
        p.latitude!,
        p.longitude!,
      );
      out.add(
        _CompassTarget(
          label: p.name,
          icon: icon,
          color: color,
          bearingDeg: bearing,
          distanceMeters: d,
        ),
      );
    }

    void addObjective(GameObjective o) {
      if (o.captured) return;
      final bearing = Geolocator.bearingBetween(
        mePos.latitude,
        mePos.longitude,
        o.point.latitude,
        o.point.longitude,
      );
      final d = Geolocator.distanceBetween(
        mePos.latitude,
        mePos.longitude,
        o.point.latitude,
        o.point.longitude,
      );
      out.add(
        _CompassTarget(
          label: o.name ?? 'Objectif',
          icon: Icons.location_on,
          color: Colors.purpleAccent,
          bearingDeg: bearing,
          distanceMeters: d,
        ),
      );
    }

    if (roleUpper == 'ROGUE') {
      // Objectives still active
      for (final o in objectives) {
        addObjective(o);
      }
      // Other rogues + agents
      for (final p in players) {
        final role = (p.role ?? '').toUpperCase();
        if (role == 'AGENT') {
          addPlayer(p, icon: Icons.shield, color: Colors.blueAccent);
        } else if (role == 'ROGUE') {
          addPlayer(p, icon: Icons.person, color: Colors.greenAccent);
        }
      }
    } else if (roleUpper == 'AGENT') {
      for (final p in players) {
        final role = (p.role ?? '').toUpperCase();
        if (role == 'AGENT') {
          addPlayer(p, icon: Icons.person, color: Colors.blueAccent);
        }
      }
    }

    out.sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));
    return out.take(12).toList(growable: false);
  }
}

class _TargetDelta {
  const _TargetDelta(this.target, this.deltaDeg);
  final _CompassTarget target;
  final double deltaDeg;
}

class _FpsCompassBar extends StatelessWidget {
  const _FpsCompassBar({required this.headingDeg, required this.targets});

  final double? headingDeg;
  final List<_CompassTarget> targets;

  static const double _windowDeg = 90; // +/-45°
  static const double _height = 46;

  @override
  Widget build(BuildContext context) {
    final heading = _normalizeDeg(headingDeg ?? 0);

    return Container(
      height: _height,
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final pxPerDeg = width / _windowDeg;
          final centerX = width / 2;

          final visibleTargets = targets
              .map((t) {
                final delta = _shortestAngleDeltaDeg(
                  heading,
                  _normalizeDeg(t.bearingDeg),
                );
                return _TargetDelta(t, delta);
              })
              .where((pair) => pair.deltaDeg.abs() <= (_windowDeg / 2))
              .toList(growable: false);

          // Handle stacking when multiple targets overlap.
          final xBuckets = <int, int>{};

          return Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _FpsCompassPainter(
                    headingDeg: heading,
                    pxPerDeg: pxPerDeg,
                    centerX: centerX,
                    windowDeg: _windowDeg,
                  ),
                ),
              ),
              // Center caret
              Positioned(
                left: centerX - 6,
                top: 0,
                child: Icon(
                  Icons.arrow_drop_down,
                  size: 18,
                  color: Colors.white.withValues(alpha: 0.95),
                ),
              ),
              Positioned(
                left: centerX - 18,
                bottom: 2,
                width: 36,
                child: Text(
                  heading.round().toString().padLeft(3, '0'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
              ),
              // Targets
              for (final pair in visibleTargets)
                _buildTargetMarker(
                  context: context,
                  target: pair.target,
                  deltaDeg: pair.deltaDeg,
                  centerX: centerX,
                  pxPerDeg: pxPerDeg,
                  xBuckets: xBuckets,
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildTargetMarker({
    required BuildContext context,
    required _CompassTarget target,
    required double deltaDeg,
    required double centerX,
    required double pxPerDeg,
    required Map<int, int> xBuckets,
  }) {
    final x = centerX + (deltaDeg * pxPerDeg);
    final key = (x / 16).round(); // bucket by ~16px
    final idx = (xBuckets[key] ?? 0);
    xBuckets[key] = idx + 1;
    final top = 16 + (idx * 12.0);
    final meters = target.distanceMeters.isFinite
        ? target.distanceMeters.round()
        : 0;
    final shortLabel = target.label.length > 10
        ? '${target.label.substring(0, 10)}…'
        : target.label;

    return Positioned(
      left: x - 18,
      top: top,
      width: 36,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.arrow_drop_down, color: target.color, size: 18),
          Icon(target.icon, color: target.color, size: 14),
          Text(
            meters > 0 ? '${meters}m' : '',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.85),
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            shortLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  static double _normalizeDeg(double v) {
    var d = v % 360.0;
    if (d < 0) d += 360.0;
    return d;
  }

  static double _shortestAngleDeltaDeg(double fromDeg, double toDeg) {
    var d = (toDeg - fromDeg) % 360.0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
}

class _FpsCompassPainter extends CustomPainter {
  _FpsCompassPainter({
    required this.headingDeg,
    required this.pxPerDeg,
    required this.centerX,
    required this.windowDeg,
  });

  final double headingDeg;
  final double pxPerDeg;
  final double centerX;
  final double windowDeg;

  @override
  void paint(Canvas canvas, Size size) {
    final tickPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.65)
      ..strokeWidth = 1;
    final minorPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.35)
      ..strokeWidth = 1;

    final textStyle = TextStyle(
      color: Colors.white.withValues(alpha: 0.9),
      fontSize: 10,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.5,
    );
    final tp = TextPainter(
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    );

    const tickStep = 5.0;
    final startDeg = headingDeg - (windowDeg / 2);
    final endDeg = headingDeg + (windowDeg / 2);

    // draw ticks every 5°, labels every 15°
    for (
      var deg = (startDeg / tickStep).floor() * tickStep;
      deg <= endDeg;
      deg += tickStep
    ) {
      final delta = _shortestAngleDeltaDeg(headingDeg, _normalizeDeg(deg));
      final x = centerX + (delta * pxPerDeg);
      final isMajor = (deg.round() % 15 == 0);
      const y0 = 0.0;
      final y1 = isMajor ? 14.0 : 8.0;
      canvas.drawLine(
        Offset(x, y0),
        Offset(x, y1),
        isMajor ? tickPaint : minorPaint,
      );

      if (isMajor) {
        final label = _labelForDeg(deg.round());
        tp.text = TextSpan(text: label, style: textStyle);
        tp.layout(minWidth: 0, maxWidth: 60);
        tp.paint(canvas, Offset(x - (tp.width / 2), y1 + 1));
      }
    }
  }

  static String _labelForDeg(int deg) {
    final d = _normalizeDeg(deg.toDouble()).round() % 360;
    switch (d) {
      case 0:
        return 'N';
      case 45:
        return 'NE';
      case 90:
        return 'E';
      case 135:
        return 'SE';
      case 180:
        return 'S';
      case 225:
        return 'SW';
      case 270:
        return 'W';
      case 315:
        return 'NW';
      default:
        return d.toString();
    }
  }

  static double _normalizeDeg(double v) {
    var d = v % 360.0;
    if (d < 0) d += 360.0;
    return d;
  }

  static double _shortestAngleDeltaDeg(double fromDeg, double toDeg) {
    var d = (toDeg - fromDeg) % 360.0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  @override
  bool shouldRepaint(covariant _FpsCompassPainter oldDelegate) {
    return oldDelegate.headingDeg != headingDeg ||
        oldDelegate.pxPerDeg != pxPerDeg ||
        oldDelegate.windowDeg != windowDeg ||
        oldDelegate.centerX != centerX;
  }
}
