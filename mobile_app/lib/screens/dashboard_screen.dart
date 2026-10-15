import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../models/driver.dart';
import '../services/api_service.dart';
import '../state/auth_controller.dart';
import '../state/data_controller.dart';
import '../widgets/alert_card.dart';
import '../widgets/alert_detail_sheet.dart';
import '../widgets/depth_button.dart';
import '../widgets/driver_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/glass_card.dart';
import '../widgets/offline_banner.dart';
import '../widgets/page_header.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    final user = context.select<AuthController, String?>((a) => a.user?.name);
    final online = data.drivers
        .where((d) => data.statusOf(d) != DriverStatus.offline)
        .length;
    final drowsy = data.drivers
        .where((d) => data.statusOf(d) == DriverStatus.drowsy)
        .length;
    // Several drivers (different cars) can need the parent at the same time: list them all.
    final attention =
        data.drivers
            .where(
              (d) =>
                  data.statusOf(d) == DriverStatus.drowsy ||
                  data.statusOf(d) == DriverStatus.warning,
            )
            .toList()
          ..sort((a, b) {
            int rank(DriverStatus s) => s == DriverStatus.drowsy ? 0 : 1;
            final r = rank(data.statusOf(a)).compareTo(rank(data.statusOf(b)));
            return r != 0 ? r : a.name.compareTo(b.name);
          });

    return RefreshIndicator(
      onRefresh: data.refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          PageHeader(
            title: 'Dashboard',
            subtitle:
                'Welcome back${user == null ? '' : ', ${user.split(' ').first}'}',
            trailing: DepthButton(
              label: 'Add',
              icon: Icons.add_rounded,
              compact: true,
              onPressed: () => context.push('/drivers/new'),
            ),
          ),
          OfflineBanner(connected: data.connected, cachedAt: data.cachedAt),
          if (attention.isNotEmpty)
            Container(
              key: const ValueKey('attention'),
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.danger.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: AppColors.danger.withValues(alpha: 0.45),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    attention.length == 1
                        ? '1 driver needs attention'
                        : '${attention.length} drivers need attention',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final d in attention)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        Icons.warning_amber_rounded,
                        color: data.statusOf(d) == DriverStatus.drowsy
                            ? AppColors.danger
                            : AppColors.warn,
                      ),
                      title: Text(
                        d.name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      subtitle: Text(
                        data.statusOf(d) == DriverStatus.drowsy
                            ? 'Drowsy'
                            : 'Getting tired',
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right_rounded,
                        color: AppColors.muted,
                      ),
                      onTap: () => context.push('/drivers/${d.id}'),
                    ),
                ],
              ),
            ),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.9,
            children: [
              _Stat(
                label: 'Drivers',
                value: '${data.drivers.length}',
                color: Colors.white,
              ),
              _Stat(
                label: 'Driving now',
                value: '$online',
                color: const Color(0xFF6EE7B7),
              ),
              _Stat(
                label: 'Unacknowledged',
                value: '${data.unacknowledged}',
                color: data.unacknowledged > 0
                    ? const Color(0xFFFCD34D)
                    : Colors.white,
              ),
              _Stat(
                label: 'Drowsy now',
                value: '$drowsy',
                color: drowsy > 0 ? const Color(0xFFFCA5A5) : Colors.white,
              ),
            ],
          ),
          const SizedBox(height: 24),
          const Text(
            'Your drivers',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          if (data.loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (data.error != null && data.drivers.isEmpty)
            EmptyState(
              icon: Icons.cloud_off_rounded,
              title: data.error!,
              subtitle: 'Pull down to retry.',
            )
          else if (data.drivers.isEmpty)
            EmptyState(
              icon: Icons.groups_rounded,
              title: 'No drivers yet',
              subtitle: 'Register a driver with three face photos to start monitoring.',
              action: DepthButton(
                label: 'Register driver',
                onPressed: () => context.push('/drivers/new'),
              ),
            )
          else
            for (final d in data.drivers)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DriverCard(
                  driver: d,
                  status: data.statusOf(d),
                  live: data.live[d.id],
                  photoUrl: data.api.assetUrl(d.referencePhotoUrl),
                  pulsing: data.pulsing.contains(d.id),
                  onTap: () => context.push('/drivers/${d.id}'),
                ),
              ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Live alerts',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: data.connected ? AppColors.ok : AppColors.warn,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                data.connected ? 'Live' : 'Polling',
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (data.alerts.isEmpty)
            const EmptyState(
              icon: Icons.shield_rounded,
              title: 'No alerts. Everyone is driving safely.',
            )
          else
            for (final a in data.alerts.take(10))
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: AlertCard(
                  key: ValueKey(a.id),
                  alert: a,
                  compact: true,
                  onAcknowledge: () => _ack(context, a.id),
                  onFalseAlarm: () => _ack(context, a.id, falseAlarm: true),
                  onReportFalseAlarm: () => _report(context, a.id),
                  snapshotUrl: data.api.assetUrl(a.snapshotUrl),
                  onDetails: () => AlertDetailSheet.show(context, a),
                ),
              ),
        ],
      ),
    );
  }
}

Future<void> _ack(BuildContext context, String id, {bool? falseAlarm}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final won = await context.read<DataController>().acknowledge(
      id,
      falseAlarm: falseAlarm,
    );
    if (!won) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Already acknowledged on another device')),
      );
    }
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

Future<void> _report(BuildContext context, String id) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await context.read<DataController>().reportFeedback(id, true);
    messenger.showSnackBar(
      const SnackBar(content: Text('Reported as false alarm — thank you')),
    );
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 26,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
