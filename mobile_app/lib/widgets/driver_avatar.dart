import 'package:flutter/material.dart';

import '../config/theme.dart';

class DriverAvatar extends StatelessWidget {
  const DriverAvatar({super.key, required this.name, this.url, this.size = 56});

  final String name;
  final String? url;
  final double size;

  String get _initials => name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .take(2)
      .map((p) => p[0].toUpperCase())
      .join();

  @override
  Widget build(BuildContext context) {
    final fallback = Center(
      child: Text(
        _initials,
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
          fontSize: size * 0.32,
        ),
      ),
    );
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: AppColors.glassBorder),
        gradient: const LinearGradient(
          colors: [Color(0x806366F1), AppColors.ink800],
        ),
        boxShadow: AppShadows.depth2,
      ),
      clipBehavior: Clip.antiAlias,
      child: url == null
          ? fallback
          : Image.network(
              url!,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => fallback,
            ),
    );
  }
}
