import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Floating 3D orbs, a tilted ring and glass cubes drifting behind the login card.
/// Parity with web ParallaxScene (touch devices get the ambient motion only).
class FloatingShapes extends StatefulWidget {
  const FloatingShapes({super.key});

  @override
  State<FloatingShapes> createState() => _FloatingShapesState();
}

class _FloatingShapesState extends State<FloatingShapes>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 12),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduce) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final t = _c.value * 2 * math.pi;
          Widget float(
            Alignment at,
            double phase,
            double amp,
            Widget child, {
            double spin = 0,
          }) => Align(
            alignment: at,
            child: Transform.translate(
              offset: Offset(
                math.cos(t + phase) * amp * 0.5,
                math.sin(t + phase) * amp,
              ),
              child: Transform.rotate(
                angle: math.sin(t + phase) * spin,
                child: child,
              ),
            ),
          );
          return Stack(
            children: [
              float(
                const Alignment(-1.1, -0.85),
                0,
                14,
                const _Orb(140, Color(0xFF818CF8)),
              ),
              float(
                const Alignment(-0.9, 0.8),
                1.5,
                10,
                const _Orb(80, Color(0xFF34D399)),
              ),
              float(const Alignment(1.1, -0.65), 3, 12, const _Ring(120)),
              float(
                const Alignment(0.95, 0.75),
                4,
                9,
                const _Cube(48),
                spin: 0.25,
              ),
              float(
                const Alignment(0.2, -1.0),
                2.2,
                8,
                const _Cube(30),
                spin: 0.35,
              ),
              float(
                const Alignment(0.6, 0.15),
                5,
                10,
                const _Orb(54, Color(0xFFFB7185)),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Orb extends StatelessWidget {
  const _Orb(this.size, this.color);
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      gradient: RadialGradient(
        center: const Alignment(-0.4, -0.4),
        colors: [
          Colors.white.withValues(alpha: 0.55),
          color.withValues(alpha: 0.55),
          color.withValues(alpha: 0.05),
        ],
        stops: const [0, 0.35, 1],
      ),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.35),
          blurRadius: 40,
          offset: const Offset(0, 18),
        ),
      ],
    ),
  );
}

class _Ring extends StatelessWidget {
  const _Ring(this.size);
  final double size;

  @override
  Widget build(BuildContext context) => Transform(
    alignment: Alignment.center,
    transform: Matrix4.identity()
      ..setEntry(3, 2, 0.002)
      ..rotateX(1.05),
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0x55818CF8), width: 10),
        boxShadow: const [BoxShadow(color: Color(0x55818CF8), blurRadius: 30)],
      ),
    ),
  );
}

class _Cube extends StatelessWidget {
  const _Cube(this.size);
  final double size;

  @override
  Widget build(BuildContext context) => Transform(
    alignment: Alignment.center,
    transform: Matrix4.identity()
      ..setEntry(3, 2, 0.003)
      ..rotateX(0.45)
      ..rotateY(-0.45),
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.28),
            const Color(0xFF6366F1).withValues(alpha: 0.18),
          ],
        ),
        border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
        boxShadow: const [
          BoxShadow(color: Color(0x406366F1), offset: Offset(6, 6)),
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 24,
            offset: Offset(0, 14),
          ),
        ],
      ),
    ),
  );
}
