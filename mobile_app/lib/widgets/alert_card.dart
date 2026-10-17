import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/alert.dart';
import 'depth_button.dart';

/// Parity with web AlertCard: coloured leading edge, red glow + pulse for unacknowledged
/// drowsy/microsleep, slide-x + glow entrance (400 ms), acknowledge action.
class AlertCard extends StatelessWidget {
  const AlertCard({
    super.key,
    required this.alert,
    this.onAcknowledge,
    this.onFalseAlarm,
    this.onReportFalseAlarm,
    this.acknowledging = false,
    this.compact = false,
    this.animateIn = true,
    this.snapshotUrl,
    this.onDetails,
    this.onRemove,
  });

  final DriverAlert alert;
  final VoidCallback? onAcknowledge;

  /// Acknowledge and label as a false alarm in one step.
  final VoidCallback? onFalseAlarm;

  /// Label an already-acknowledged alert as a false alarm.
  final VoidCallback? onReportFalseAlarm;
  final bool acknowledging;
  final bool compact;
  final bool animateIn;

  /// Resolved URL of the driver's camera frame at the trigger moment.
  final String? snapshotUrl;

  /// Opens the snapshot + map sheet (shown when there is a snapshot or a location).
  final VoidCallback? onDetails;

  /// Remove from every list (any alert; the only option once it has expired). Asks first.
  final VoidCallback? onRemove;

  Future<void> _confirmRemove(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove this alert?'),
        content: const Text(
          'It disappears from your alerts and notifications.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Keep'),
          ),
          TextButton(
            key: const ValueKey('confirm-remove'),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok == true) onRemove?.call();
  }

  static const _ackBy = {
    'apk': 'Android app',
    'web': 'Web',
    'unknown': 'another device',
  };

  @override
  Widget build(BuildContext context) {
    final severe = alert.type.severe;
    final active = alert.open;
    final expired = !alert.acknowledged && alert.expired;
    final edge = severe
        ? AppColors.danger
        : alert.type == AlertType.warning
        ? AppColors.warn
        : AppColors.glow;

    // Uniform rounded border + a separate leading-edge strip (Flutter can't round
    // a border whose sides differ in colour).
    Widget card = Container(
      key: ValueKey('alert-${alert.id}'),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppMotion.radius),
        color: active ? null : AppColors.glassLight,
        gradient: active
            ? LinearGradient(
                colors: [
                  edge.withValues(alpha: severe ? 0.30 : 0.2),
                  AppColors.glassLight,
                ],
                stops: const [0, 0.35],
              )
            : null,
        border: Border.all(color: AppColors.glassBorder),
        boxShadow: [
          ...AppShadows.depth2,
          if (severe && active) ...AppShadows.glowDanger,
        ],
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 4, color: edge),
            Expanded(
              child: Padding(
                padding: EdgeInsets.all(compact ? 12 : 16),
                child: Opacity(
                  opacity: active ? 1 : 0.7,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (snapshotUrl != null)
                        GestureDetector(
                          key: const ValueKey('alert-snapshot'),
                          onTap: onDetails,
                          child: Container(
                            width: 48,
                            height: 48,
                            clipBehavior: Clip.antiAlias,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.glassBorder),
                              boxShadow: AppShadows.depth2,
                            ),
                            child: Image.network(
                              snapshotUrl!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) => Icon(
                                Icons.image_not_supported_outlined,
                                color: edge,
                                size: 20,
                              ),
                            ),
                          ),
                        )
                      else
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: edge.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(
                            alert.type == AlertType.faceMatch
                                ? Icons.visibility_rounded
                                : Icons.notifications_active_rounded,
                            color: edge,
                            size: 20,
                          ),
                        ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    alert.type.label,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 15,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Flexible(
                                  child: Text(
                                    alert.driverName ?? 'Driver',
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                Text(
                                  alert.delayedS != null
                                      ? '${timeAgo(alert.createdAt)} · sent late (offline)'
                                      : timeAgo(alert.createdAt),
                                  style: const TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                            if (alert.fatigueReason != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  alert.fatigueReason!,
                                  key: const ValueKey('fatigue-reason'),
                                  style: const TextStyle(
                                    color: Color(0xFFFDE68A),
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            if (!compact) ...[
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  _Metric('Confidence', pct(alert.confidence)),
                                  _Metric('EAR', fixed(alert.ear, 3)),
                                  _Metric('PERCLOS', pct(alert.perclos)),
                                  _Metric(
                                    'HR',
                                    alert.heartRate == null ||
                                            alert.heartRate == 0
                                        ? '—'
                                        : '${alert.heartRate!.round()}',
                                  ),
                                ],
                              ),
                            ],
                            const SizedBox(height: 10),
                            if (onDetails != null &&
                                (snapshotUrl != null || alert.location != null))
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: DepthButton(
                                  key: const ValueKey('alert-details'),
                                  label:
                                      snapshotUrl != null &&
                                          alert.location != null
                                      ? 'Snapshot & map'
                                      : alert.location != null
                                      ? 'Map'
                                      : 'Snapshot',
                                  icon: alert.location != null
                                      ? Icons.place_rounded
                                      : Icons.image_rounded,
                                  compact: true,
                                  variant: DepthVariant.secondary,
                                  onPressed: onDetails,
                                ),
                              ),
                            if (expired)
                              Container(
                                key: const ValueKey('expired-label'),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: const Text(
                                  'Unacknowledged · from a previous day',
                                  style: TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              )
                            else if (active && onAcknowledge != null)
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  DepthButton(
                                    key: const ValueKey('ack-button'),
                                    label: 'Acknowledge',
                                    icon: Icons.check_rounded,
                                    compact: true,
                                    variant: severe
                                        ? DepthVariant.danger
                                        : DepthVariant.primary,
                                    loading: acknowledging,
                                    onPressed: onAcknowledge,
                                  ),
                                  if (onFalseAlarm != null)
                                    DepthButton(
                                      key: const ValueKey('false-alarm-button'),
                                      label: 'False alarm',
                                      compact: true,
                                      variant: DepthVariant.ghost,
                                      onPressed: acknowledging
                                          ? null
                                          : onFalseAlarm,
                                    ),
                                ],
                              )
                            else if (alert.acknowledged)
                              Row(
                                children: [
                                  const Icon(
                                    Icons.check_rounded,
                                    size: 14,
                                    color: Color(0xFF6EE7B7),
                                  ),
                                  const SizedBox(width: 4),
                                  Flexible(
                                    child: Text(
                                      'Acknowledged via ${_ackBy[alert.acknowledgedBy] ?? 'another device'}'
                                      '${alert.acknowledgedAt != null ? ' · ${timeAgo(alert.acknowledgedAt)}' : ''}',
                                      style: const TextStyle(
                                        color: Color(0xFF6EE7B7),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            if (alert.acknowledged && alert.falseAlarm == true)
                              const Padding(
                                padding: EdgeInsets.only(top: 4),
                                child: Text(
                                  'Reported as false alarm',
                                  key: ValueKey('fa-label'),
                                  style: TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              )
                            else if (alert.acknowledged &&
                                alert.falseAlarm == null &&
                                onReportFalseAlarm != null)
                              TextButton(
                                key: const ValueKey('report-false-alarm'),
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  minimumSize: const Size(0, 32),
                                ),
                                onPressed: onReportFalseAlarm,
                                child: const Text(
                                  'Report false alarm',
                                  style: TextStyle(
                                    color: AppColors.glow,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            if (onRemove != null)
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton.icon(
                                  key: const ValueKey('remove-alert'),
                                  style: TextButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                    ),
                                    minimumSize: const Size(0, 32),
                                  ),
                                  onPressed: () => _confirmRemove(context),
                                  icon: const Icon(
                                    Icons.delete_outline_rounded,
                                    size: 16,
                                    color: AppColors.muted,
                                  ),
                                  label: const Text(
                                    'Remove',
                                    style: TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );

    if (severe && active) {
      card = card
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .boxShadow(
            begin: const BoxShadow(color: Color(0x33EF4444), blurRadius: 8),
            end: const BoxShadow(color: Color(0x8CEF4444), blurRadius: 24),
            borderRadius: BorderRadius.circular(AppMotion.radius),
            duration: 1500.ms,
          );
    }
    if (!animateIn) return card;
    return card
        .animate()
        .fadeIn(duration: AppMotion.alert)
        .slideX(
          begin: -0.08,
          end: 0,
          duration: AppMotion.alert,
          curve: Curves.easeOut,
        );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
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
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
