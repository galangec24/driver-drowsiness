import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../state/data_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/driver_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/offline_banner.dart';
import '../widgets/page_header.dart';

class DriversScreen extends StatelessWidget {
  const DriversScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    return RefreshIndicator(
      onRefresh: data.refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          PageHeader(
            title: 'Drivers',
            subtitle: 'Personal, self-tuning thresholds',
            trailing: DepthButton(
              label: 'Add',
              icon: Icons.add_rounded,
              compact: true,
              onPressed: () => context.push('/drivers/new'),
            ),
          ),
          OfflineBanner(connected: data.connected, cachedAt: data.cachedAt),
          if (data.loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
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
        ],
      ),
    );
  }
}
