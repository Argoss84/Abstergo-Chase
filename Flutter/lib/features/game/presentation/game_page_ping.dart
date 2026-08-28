part of 'game_page.dart';

class _DecodedPingMessage {
  const _DecodedPingMessage({
    required this.optionId,
    required this.position,
    required this.shortMessage,
    required this.ttsMessage,
    required this.color,
    required this.timestampMs,
  });

  final String optionId;
  final GeoPoint position;
  final String shortMessage;
  final String ttsMessage;
  final Color color;
  final int timestampMs;
}

class _PingWheelPainter extends CustomPainter {
  const _PingWheelPainter({
    required this.center,
    required this.options,
    required this.highlightedIndex,
  });

  final Offset center;
  final List<_PingOption> options;
  final int? highlightedIndex;

  @override
  void paint(Canvas canvas, Size size) {
    if (options.isEmpty) return;
    const innerRadius = 32.0;
    const outerRadius = 98.0;
    final sweep = (2 * pi) / options.length;
    for (var i = 0; i < options.length; i++) {
      final option = options[i];
      final start = (i * sweep) - (pi / options.length);
      final isHighlighted = highlightedIndex == i;
      final fillPaint = Paint()
        ..style = PaintingStyle.fill
        ..color = option.color.withValues(alpha: isHighlighted ? 0.80 : 0.55);
      final borderPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = isHighlighted ? 2.6 : 1.3
        ..color = Colors.white.withValues(alpha: 0.85);
      final path = Path()
        ..moveTo(
          center.dx + innerRadius * cos(start),
          center.dy + innerRadius * sin(start),
        )
        ..arcTo(
          Rect.fromCircle(center: center, radius: innerRadius),
          start,
          sweep,
          false,
        )
        ..lineTo(
          center.dx + outerRadius * cos(start + sweep),
          center.dy + outerRadius * sin(start + sweep),
        )
        ..arcTo(
          Rect.fromCircle(center: center, radius: outerRadius),
          start + sweep,
          -sweep,
          false,
        )
        ..close();
      canvas.drawPath(path, fillPaint);
      canvas.drawPath(path, borderPaint);
      final textPainter = TextPainter(
        text: TextSpan(
          text: option.shortMessage,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: 90);
      final labelAngle = start + (sweep / 2);
      final labelRadius = 63.0;
      final labelCenter = Offset(
        center.dx + (labelRadius * cos(labelAngle)),
        center.dy + (labelRadius * sin(labelAngle)),
      );
      textPainter.paint(
        canvas,
        Offset(
          labelCenter.dx - textPainter.width / 2,
          labelCenter.dy - textPainter.height / 2,
        ),
      );
    }
    final corePaint = Paint()
      ..style = PaintingStyle.fill
      ..color = Colors.black.withValues(alpha: 0.72);
    canvas.drawCircle(center, innerRadius - 2, corePaint);
  }

  @override
  bool shouldRepaint(covariant _PingWheelPainter oldDelegate) {
    return oldDelegate.center != center ||
        oldDelegate.highlightedIndex != highlightedIndex ||
        oldDelegate.options.length != options.length;
  }
}
