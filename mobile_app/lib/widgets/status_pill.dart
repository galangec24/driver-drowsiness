import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/driver.dart';

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});

  final DriverStatus status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      DriverStatus.alert => AppColors.ok,
      DriverStatus.warning => AppColors.warn,
      DriverStatus.drowsy => AppColors.danger,
      DriverStatus.offline => const Color(0xFF64748B),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.45)),
        boxShadow: status == DriverStatus.drowsy ? AppShadows.glowDanger : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            status.label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
