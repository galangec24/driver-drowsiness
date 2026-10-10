import 'package:flutter/material.dart';

import '../config/theme.dart';

enum DepthVariant { primary, secondary, danger, ghost }

/// Parity with web DepthButton: depth-1 shadow, glow for primary, 1px press-down.
class DepthButton extends StatefulWidget {
  const DepthButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.variant = DepthVariant.primary,
    this.loading = false,
    this.expand = false,
    this.compact = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final DepthVariant variant;
  final bool loading;
  final bool expand;
  final bool compact;

  @override
  State<DepthButton> createState() => _DepthButtonState();
}

class _DepthButtonState extends State<DepthButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !widget.loading;
    final (
      Gradient? gradient,
      Color? fill,
      Color fg,
      List<BoxShadow> glow,
    ) = switch (widget.variant) {
      DepthVariant.primary => (
        const LinearGradient(
          colors: [AppColors.glow, AppColors.primary],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        null,
        Colors.white,
        AppShadows.glow,
      ),
      DepthVariant.danger => (
        const LinearGradient(
          colors: [Color(0xFFF87171), AppColors.danger],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        null,
        Colors.white,
        AppShadows.glowDanger,
      ),
      DepthVariant.secondary => (
        null,
        AppColors.glassLight,
        AppColors.text,
        const <BoxShadow>[],
      ),
      DepthVariant.ghost => (
        null,
        Colors.transparent,
        AppColors.muted,
        const <BoxShadow>[],
      ),
    };

    final content = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.loading)
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          )
        else if (widget.icon != null)
          Icon(widget.icon, size: 18, color: fg),
        if (widget.loading || widget.icon != null) const SizedBox(width: 8),
        Flexible(
          child: Text(
            widget.label,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: fg,
              fontWeight: FontWeight.w700,
              fontSize: widget.compact ? 13 : 15,
            ),
          ),
        ),
      ],
    );

    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTap: enabled ? widget.onPressed : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          transform: Matrix4.translationValues(0, _down ? 1 : 0, 0),
          height: widget.compact ? 38 : 48,
          padding: EdgeInsets.symmetric(horizontal: widget.compact ? 14 : 20),
          decoration: BoxDecoration(
            gradient: gradient,
            color: fill,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: widget.variant == DepthVariant.ghost
                  ? Colors.transparent
                  : widget.variant == DepthVariant.secondary
                  ? AppColors.glassBorder
                  : Colors.white.withValues(alpha: 0.2),
            ),
            boxShadow: [
              if (widget.variant != DepthVariant.ghost) ...AppShadows.depth1,
              if (_down) ...glow,
            ],
          ),
          child: Center(child: content),
        ),
      ),
    );
  }
}
