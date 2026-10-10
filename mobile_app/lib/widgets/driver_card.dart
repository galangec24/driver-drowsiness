import 'package:flutter/material.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/driver.dart';
import 'driver_avatar.dart';
import 'glass_card.dart';
import 'status_pill.dart';

/// Parity with web DriverCard: avatar, status pill, score bar, EAR/PERCLOS/HR tiles.
class DriverCard extends StatelessWidget {
  const DriverCard({
    super.key,
    required this.driver,
    required this.status,
    this.live,
    this.photoUrl,
    this.pulsing = false,
    this.onTap,
  });

  final Driver driver;
  final DriverStatus status;
  final DriverLive? live;
  final String? photoUrl;
  final bool pulsing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final offline = status == DriverStatus.offline;
    final score = live?.fusionScore ?? 0;
    final barColor = score > 0.7
        ? AppColors.danger
        : score > 0.4
        ? AppColors.warn
        : AppColors.ok;

    return GlassCard(
      danger: pulsing || status == DriverStatus.drowsy,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              DriverAvatar(name: driver.name, url: photoUrl),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      driver.name,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      capitalize(
                        driver.relationship.isEmpty
                            ? 'driver'
                            : driver.relationship,
                      ),
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              StatusPill(status: status),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Drowsiness score',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              Text(
                offline ? '—' : pct(score),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: Stack(
              children: [
                Container(
                  height: 8,
                  color: Colors.black.withValues(alpha: 0.3),
                ),
                AnimatedFractionallySizedBox(
                  duration: const Duration(milliseconds: 300),
                  widthFactor: offline ? 0 : score.clamp(0, 1),
                  child: Container(height: 8, color: barColor),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _Tile(label: 'EAR', value: offline ? '—' : fixed(live?.ear, 3)),
              const SizedBox(width: 8),
              _Tile(
                label: 'PERCLOS',
                value: offline ? '—' : pct(live?.perclos),
              ),
              const SizedBox(width: 8),
              _Tile(
                label: 'HR',
                value:
                    offline || live?.heartRate == null || live!.heartRate == 0
                    ? '—'
                    : '${live!.heartRate!.round()}',
              ),
              const SizedBox(width: 8),
              _Tile(
                label: 'Yawn·Nod',
                value: offline || live?.yawnCount == null
                    ? '—'
                    : '${live!.yawnCount}·${live!.nodCount ?? 0}',
              ),
            ],
          ),
          if (!offline && live?.radarConnected != null) ...[
            const SizedBox(height: 8),
            Row(
              key: const ValueKey('radar-status'),
              children: [
                Icon(
                  Icons.sensors_rounded,
                  size: 14,
                  color: live!.radarConnected!
                      ? const Color(0xFF6EE7B7)
                      : AppColors.muted,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    !live!.radarConnected!
                        ? 'Dashboard radar offline'
                        : live!.radarPresent == false
                        ? 'Radar: driver not in range'
                        : 'Radar · ${live!.breathingRate != null ? '${live!.breathingRate!.toStringAsFixed(1)} breaths/min' : 'measuring…'}',
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (!offline && live?.watchConnected != null) ...[
            const SizedBox(height: 8),
            Row(
              key: const ValueKey('wearable-status'),
              children: [
                Icon(
                  Icons.watch_rounded,
                  size: 14,
                  color: live!.watchConnected!
                      ? const Color(0xFFF472B6)
                      : AppColors.muted,
                ),
                const SizedBox(width: 4),
                Text(
                  live!.watchConnected!
                      ? 'Watch connected${live!.watchBattery != null ? ' · ${live!.watchBattery}%' : ''}'
                      : 'Watch not connected',
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'Last update ${timeAgo(live?.lastUpdate ?? driver.lastUpdate)}',
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Column(
          children: [
            Text(
              label,
              style: const TextStyle(
                color: AppColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
