import 'dart:math' as math;

import 'package:flutter/material.dart';

/// 3D card that leans toward your finger while dragging and springs back when released,
/// with a slow idle sway so it never looks flat. Parity with web TiltCard.
/// Disabled when the platform asks for reduced motion.
class Tilt3D extends StatefulWidget {
  const Tilt3D({super.key, required this.child, this.maxTilt = 0.16});

  final Widget child;

  /// Maximum rotation in radians (~9°).
  final double maxTilt;

  @override
  State<Tilt3D> createState() => _Tilt3DState();
}

class _Tilt3DState extends State<Tilt3D> with TickerProviderStateMixin {
  late final AnimationController _idle = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  );
  late final AnimationController _release = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  );
  Offset _tilt = Offset.zero; // x = rotateY, y = rotateX (radians)
  Offset _from = Offset.zero;
  bool _reduce = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (_reduce) {
      _idle.stop();
    } else if (!_idle.isAnimating) {
      _idle.repeat();
    }
  }

  @override
  void dispose() {
    _idle.dispose();
    _release.dispose();
    super.dispose();
  }

  void _update(Offset local, Size size) {
    if (_reduce) return;
    _release.stop();
    final dx = (local.dx / size.width - 0.5).clamp(-0.5, 0.5);
    final dy = (local.dy / size.height - 0.5).clamp(-0.5, 0.5);
    setState(
      () => _tilt = Offset(dx * 2 * widget.maxTilt, -dy * 2 * widget.maxTilt),
    );
  }

  void _springBack() {
    _from = _tilt;
    _release
      ..reset()
      ..forward();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(
          constraints.maxWidth,
          constraints.maxHeight.isFinite ? constraints.maxHeight : 500,
        );
        return GestureDetector(
          onPanDown: (d) => _update(d.localPosition, size),
          onPanUpdate: (d) => _update(d.localPosition, size),
          onPanEnd: (_) => _springBack(),
          onPanCancel: _springBack,
          child: AnimatedBuilder(
            animation: Listenable.merge([_idle, _release]),
            builder: (context, child) {
              var tilt = _tilt;
              if (_release.isAnimating || _release.isCompleted) {
                final t = Curves.elasticOut.transform(_release.value);
                tilt = Offset.lerp(_from, Offset.zero, t)!;
                _tilt = tilt;
              }
              final phase = _idle.value * 2 * math.pi;
              final idleX = _reduce ? 0.0 : math.sin(phase) * 0.035;
              final idleY = _reduce ? 0.0 : math.cos(phase) * 0.025;
              final m = Matrix4.identity()
                ..setEntry(3, 2, 0.0012) // perspective
                ..rotateX(tilt.dy + idleY)
                ..rotateY(tilt.dx + idleX);
              return Transform(
                key: const ValueKey('tilt-3d'),
                alignment: Alignment.center,
                transform: m,
                child: child,
              );
            },
            child: widget.child,
          ),
        );
      },
    );
  }
}
