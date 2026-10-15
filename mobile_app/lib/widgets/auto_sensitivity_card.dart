import 'package:flutter/material.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/driver.dart';
import 'glass_card.dart';

/// Replaces the old threshold sliders: parents don't tune numbers. Sensitivity is learned from the
/// driver's own readings (hourly) and from the parent's "False alarm" / "Real" taps.
class AutoSensitivityCard extends StatelessWidget {
  const AutoSensitivityCard({
    super.key,
    required this.name,
    required this.tuning,
  });

  final String name;
  final DriverTuning tuning;

  static const _modes = {
    'learning': (
      'Learning',
      'Guardian Drive is still getting to know how this driver normally looks when awake. '
          'Alerts already work with safe default settings.',
      AppColors.primary,
    ),
    'standard': (
      'Standard',
      "Tuned to this driver's eyes. Alerts use the normal, safe sensitivity.",
      AppColors.ok,
    ),
    'reduced': (
      'Fewer false alarms',
      'You marked several alerts as false alarms, so this driver now needs a little more evidence '
          'before an alert. It goes back to normal as alerts are confirmed real.',
      AppColors.warn,
    ),
  };

  @override
  Widget build(BuildContext context) {
    final m = _modes[tuning.mode] ?? _modes['learning']!;
    final feedback = tuning.falseAlarms + tuning.realAlarms;
    return GlassCard(
      key: const ValueKey('auto-sensitivity'),
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Alert sensitivity',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: m.$3.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  'Automatic · ${m.$1}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(m.$2, style: const TextStyle(color: AppColors.muted)),
          const SizedBox(height: 12),
          _line(
            Icons.visibility_rounded,
            tuning.eyeSamples > 0
                ? "Learned from ${tuning.eyeSamples} readings of $name's eyes in the last 7 days."
                : "Needs a few minutes of driving to learn $name's normal eye openness.",
          ),
          if (feedback > 0)
            _line(
              Icons.fact_check_rounded,
              'Your feedback (last 30 days): ${tuning.realAlarms} real, '
              '${tuning.falseAlarms} false alarm${tuning.falseAlarms == 1 ? '' : 's'}.',
            ),
          if (tuning.updatedAt != null)
            _line(
              Icons.autorenew_rounded,
              'Updated ${timeAgo(tuning.updatedAt!)}. It keeps adjusting every hour.',
            ),
          const SizedBox(height: 8),
          const Text(
            "Tip: on an alert that wasn't real, tap False alarm. Guardian Drive learns from it right away.",
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _line(IconData icon, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: AppColors.glow),
        const SizedBox(width: 8),
        Expanded(
          child: Text(text, style: const TextStyle(color: AppColors.muted)),
        ),
      ],
    ),
  );
}
