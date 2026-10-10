import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../config/theme.dart';

/// Parity with web GlassCard: glass fill + 12px backdrop blur + border, depth-2 at rest,
/// lifts (y -4, scale 1.01, depth-3) while pressed; enters with fade + scale 0.98 → 1 (250 ms).
class GlassCard extends StatefulWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.onTap,
    this.danger = false,
    this.padding = const EdgeInsets.all(20),
    this.interactive = true,
    this.animateIn = true,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool danger;
  final EdgeInsetsGeometry padding;
  final bool interactive;
  final bool animateIn;

  @override
  State<GlassCard> createState() => _GlassCardState();
}

class _GlassCardState extends State<GlassCard> {
  bool _pressed = false;

  void _setPressed(bool v) {
    if (widget.interactive && _pressed != v) setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppMotion.radius);
    final lifted = _pressed && widget.interactive;

    Widget card = AnimatedContainer(
      key: const ValueKey('glass-card'),
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      transform: Matrix4.translationValues(0, lifted ? -4 : 0, 0)
        ..scaleByDouble(lifted ? 1.01 : 1, lifted ? 1.01 : 1, 1, 1),
      transformAlignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: [
          ...(lifted ? AppShadows.depth3 : AppShadows.depth2),
          if (widget.danger) ...AppShadows.glowDanger,
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: AppMotion.blur,
            sigmaY: AppMotion.blur,
          ),
          child: Stack(
            children: [
              if (widget.danger)
                Positioned.fill(
                  child: IgnorePointer(
                    child:
                        DecoratedBox(
                              decoration: BoxDecoration(
                                borderRadius: radius,
                                color: AppColors.danger.withValues(alpha: 0.10),
                              ),
                            )
                            .animate(onPlay: (c) => c.repeat(reverse: true))
                            .fade(
                              begin: 0.3,
                              end: 1,
                              duration: 1500.ms,
                              curve: Curves.easeInOut,
                            ),
                  ),
                ),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                padding: widget.padding,
                decoration: BoxDecoration(
                  color: lifted ? AppColors.glassHover : AppColors.glassLight,
                  borderRadius: radius,
                  border: Border.all(
                    color: widget.danger
                        ? AppColors.danger.withValues(alpha: 0.5)
                        : AppColors.glassBorder,
                  ),
                ),
                child: widget.child,
              ),
            ],
          ),
        ),
      ),
    );

    if (widget.onTap != null || widget.interactive) {
      card = GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _setPressed(true),
        onTapUp: (_) => _setPressed(false),
        onTapCancel: () => _setPressed(false),
        onTap: widget.onTap,
        child: card,
      );
    }

    if (!widget.animateIn) return card;
    return card
        .animate()
        .fadeIn(duration: AppMotion.card, curve: Curves.easeOut)
        .scale(
          begin: const Offset(0.98, 0.98),
          end: const Offset(1, 1),
          duration: AppMotion.card,
        );
  }
}
