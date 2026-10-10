import 'package:flutter/material.dart';

/// Design tokens — mirrors web/tailwind.config.js (web/CLAUDE.md § 3.1).
abstract final class AppColors {
  static const glassLight = Color(0x14FFFFFF); // rgba(255,255,255,0.08)
  static const glassBorder = Color(0x26FFFFFF); // rgba(255,255,255,0.15)
  static const glassHover = Color(0x1FFFFFFF); // rgba(255,255,255,0.12)

  static const primary = Color(0xFF6366F1);
  static const glow = Color(0xFF818CF8);
  static const danger = Color(0xFFEF4444);
  static const warn = Color(0xFFF59E0B);
  static const ok = Color(0xFF10B981);

  static const ink950 = Color(0xFF05060F);
  static const ink900 = Color(0xFF0B0D1F);
  static const ink800 = Color(0xFF141735);
  static const muted = Color(0xFF9AA0C3);
  static const text = Color(0xFFF1F5F9);
}

/// Depth shadows — same layers as Tailwind's depth-1/2/3, glow, glow-danger.
abstract final class AppShadows {
  static const depth1 = [
    BoxShadow(color: Color(0x14000000), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x0F000000), offset: Offset(0, 2), blurRadius: 4),
  ];
  static const depth2 = [
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 4), blurRadius: 8),
    BoxShadow(color: Color(0x14000000), offset: Offset(0, 8), blurRadius: 16),
  ];
  static const depth3 = [
    BoxShadow(color: Color(0x1F000000), offset: Offset(0, 10), blurRadius: 20),
    BoxShadow(color: Color(0x1A000000), offset: Offset(0, 20), blurRadius: 40),
  ];
  static const glow = [BoxShadow(color: Color(0x736366F1), blurRadius: 24)];
  static const glowDanger = [
    BoxShadow(color: Color(0x8CEF4444), blurRadius: 24),
  ];
}

abstract final class AppMotion {
  static const page = Duration(milliseconds: 200);
  static const card = Duration(milliseconds: 250);
  static const alert = Duration(milliseconds: 400);
  static const blur = 12.0;
  static const radius = 16.0;
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.dark,
      primary: AppColors.primary,
      secondary: AppColors.glow,
      error: AppColors.danger,
      surface: AppColors.ink900,
    ),
    scaffoldBackgroundColor: AppColors.ink950,
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(
      bodyColor: AppColors.text,
      displayColor: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      foregroundColor: Colors.white,
      centerTitle: false,
    ),
    sliderTheme: base.sliderTheme.copyWith(
      activeTrackColor: AppColors.primary,
      inactiveTrackColor: AppColors.glassLight,
      thumbColor: AppColors.primary,
      overlayColor: AppColors.glow.withValues(alpha: 0.2),
      trackHeight: 6,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: AppColors.ink800,
      contentTextStyle: TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
    ),
    dividerColor: AppColors.glassBorder,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.black.withValues(alpha: 0.25),
      labelStyle: const TextStyle(color: AppColors.muted),
      floatingLabelStyle: const TextStyle(color: AppColors.glow),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0x1AFFFFFF)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0x1AFFFFFF)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppColors.glow.withValues(alpha: 0.7)),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppColors.danger.withValues(alpha: 0.7)),
      ),
    ),
  );
}
