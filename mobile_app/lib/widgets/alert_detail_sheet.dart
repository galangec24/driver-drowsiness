import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/alert.dart';
import '../state/data_controller.dart';
import 'location_map.dart';

/// What happened, who was driving (camera snapshot) and where (map + directions).
class AlertDetailSheet extends StatelessWidget {
  const AlertDetailSheet({super.key, required this.initial});

  final DriverAlert initial;

  static Future<void> show(BuildContext context, DriverAlert alert) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: AppColors.ink900,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (_) => AlertDetailSheet(initial: alert),
      );

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    // Prefer the live copy so a snapshot that arrives while the sheet is open appears.
    final alert = data.alerts.firstWhere(
      (a) => a.id == initial.id,
      orElse: () => initial,
    );
    final snapshot = data.api.assetUrl(alert.snapshotUrl);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.4,
      builder: (context, scroll) => ListView(
        key: const ValueKey('alert-detail'),
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.glassBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '${alert.type.label} · ${alert.driverName ?? 'Driver'}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          Text(
            timeAgo(alert.createdAt),
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: 18),
          const _Label('Driver at the moment of the alert'),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: snapshot != null
                ? Image.network(
                    snapshot,
                    key: const ValueKey('alert-snapshot-large'),
                    fit: BoxFit.cover,
                    loadingBuilder: (context, child, progress) =>
                        progress == null
                        ? child
                        : const SizedBox(
                            height: 220,
                            child: Center(child: CircularProgressIndicator()),
                          ),
                    errorBuilder: (_, _, _) => const _NoSnapshot(
                      text: 'Snapshot could not be loaded.',
                    ),
                  )
                : const _NoSnapshot(text: 'No camera snapshot for this alert.'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _Metric('Confidence', pct(alert.confidence)),
              _Metric('EAR', fixed(alert.ear, 3)),
              _Metric('PERCLOS', pct(alert.perclos)),
              _Metric(
                'HR',
                alert.heartRate == null || alert.heartRate == 0
                    ? '—'
                    : '${alert.heartRate!.round()}',
              ),
            ],
          ),
          const SizedBox(height: 22),
          const _Label('Where it happened'),
          LocationMap(location: alert.location, live: false, height: 240),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text.toUpperCase(),
      style: const TextStyle(
        color: AppColors.muted,
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.1,
      ),
    ),
  );
}

class _NoSnapshot extends StatelessWidget {
  const _NoSnapshot({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    height: 180,
    color: Colors.black.withValues(alpha: 0.25),
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.image_outlined, color: AppColors.muted, size: 32),
          const SizedBox(height: 8),
          Text(text, style: const TextStyle(color: AppColors.muted)),
        ],
      ),
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      margin: const EdgeInsets.symmetric(horizontal: 3),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: AppColors.muted, fontSize: 11),
          ),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ),
  );
}
