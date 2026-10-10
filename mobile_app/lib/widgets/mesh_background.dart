import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../config/theme.dart';

/// Slowly drifting radial-gradient mesh, same palette as the web background.
class MeshBackground extends StatelessWidget {
  const MeshBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: AppColors.ink950)),
        Positioned.fill(
          child:
              const Stack(
                    children: [
                      _Blob(
                        alignment: Alignment(-0.7, -0.8),
                        color: Color(0x596366F1),
                        size: 1.1,
                      ),
                      _Blob(
                        alignment: Alignment(0.9, -0.9),
                        color: Color(0x38818CF8),
                        size: 0.9,
                      ),
                      _Blob(
                        alignment: Alignment(0.6, 0.9),
                        color: Color(0x2410B981),
                        size: 1.2,
                      ),
                      _Blob(
                        alignment: Alignment(-0.9, 1.0),
                        color: Color(0x1AEF4444),
                        size: 1.0,
                      ),
                    ],
                  )
                  .animate(onPlay: (c) => c.repeat(reverse: true))
                  .move(
                    begin: Offset.zero,
                    end: const Offset(-18, 14),
                    duration: 24.seconds,
                    curve: Curves.easeInOut,
                  )
                  .scale(
                    begin: const Offset(1, 1),
                    end: const Offset(1.08, 1.08),
                    duration: 24.seconds,
                  ),
        ),
        Positioned.fill(child: child),
      ],
    );
  }
}

class _Blob extends StatelessWidget {
  const _Blob({
    required this.alignment,
    required this.color,
    required this.size,
  });

  final Alignment alignment;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width * size;
    return Align(
      alignment: alignment,
      child: Container(
        width: w,
        height: w,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}
