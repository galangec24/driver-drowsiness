import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../config/theme.dart';

/// 3D loader: three glowing rings orbiting on different axes around the logo.
/// Parity with web OrbitLoader.
class OrbitLoader extends StatefulWidget {
  const OrbitLoader({super.key, this.size = 96, this.label});

  final double size;
  final String? label;

  @override
  State<OrbitLoader> createState() => _OrbitLoaderState();
}

class _OrbitLoaderState extends State<OrbitLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Widget _ring(double inset, Color color, Matrix4 transform) => Positioned.fill(
    left: inset,
    top: inset,
    right: inset,
    bottom: inset,
    child: Transform(
      alignment: Alignment.center,
      transform: transform,
      child: CustomPaint(painter: _ArcPainter(color)),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return Semantics(
      label: widget.label ?? 'Loading',
      liveRegion: true,
      child: Column(
        key: const ValueKey('orbit-loader'),
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: s,
            height: s,
            child: AnimatedBuilder(
              animation: _c,
              builder: (context, _) {
                final a = _c.value * 2 * math.pi;
                Matrix4 persp() => Matrix4.identity()..setEntry(3, 2, 0.002);
                final pulse = 1 + 0.1 * math.sin(a * 2);
                return Stack(
                  children: [
                    _ring(
                      0,
                      AppColors.glow,
                      persp()
                        ..rotateX(1.1)
                        ..rotateZ(a),
                    ),
                    _ring(
                      s * 0.1,
                      AppColors.ok,
                      persp()
                        ..rotateY(1.1)
                        ..rotateZ(-a * 1.3),
                    ),
                    _ring(
                      s * 0.2,
                      const Color(0xFFF472B6),
                      persp()
                        ..rotateX(-0.5)
                        ..rotateY(0.5)
                        ..rotateZ(a * 2),
                    ),
                    Center(
                      child: Transform.scale(
                        scale: pulse,
                        child: Image.asset(
                          'assets/icon.png',
                          width: s * 0.38,
                          height: s * 0.38,
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          if (widget.label != null) ...[
            const SizedBox(height: 14),
            Text(
              widget.label!,
              style: const TextStyle(
                color: Color(0xFFE0E7FF),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  _ArcPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final glow = Paint()
      ..color = color.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
    final line = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    final faint = Paint()
      ..color = color.withValues(alpha: 0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    canvas.drawArc(rect.deflate(3), 0, 2 * math.pi, false, faint);
    canvas.drawArc(rect.deflate(3), -math.pi / 2, math.pi * 0.7, false, glow);
    canvas.drawArc(rect.deflate(3), -math.pi / 2, math.pi * 0.7, false, line);
  }

  @override
  bool shouldRepaint(_ArcPainter old) => old.color != color;
}
