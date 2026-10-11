import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../models/alert.dart';
import '../services/update_service.dart';
import '../state/data_controller.dart';
import '../widgets/mesh_background.dart';

/// Bottom-nav shell (parity with the web's mobile BottomNav). Shows an in-app banner for new alerts.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  static const tabs = [
    (path: '/', label: 'Dashboard', icon: Icons.dashboard_rounded),
    (path: '/drivers', label: 'Drivers', icon: Icons.groups_rounded),
    (path: '/alerts', label: 'Alerts', icon: Icons.notifications_rounded),
    (path: '/settings', label: 'Settings', icon: Icons.settings_rounded),
  ];

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  StreamSubscription<DriverAlert>? _sub;
  // Once per app start: is a newer APK published?
  static bool _updateChecked = false;

  @override
  void initState() {
    super.initState();
    if (!_updateChecked) {
      _updateChecked = true;
      Future<void>.delayed(const Duration(seconds: 4), _checkForUpdate);
    }
  }

  Future<void> _checkForUpdate() async {
    try {
      final update = await UpdateService().check();
      if (update != null && mounted) await showUpdateDialog(context, update);
    } catch (_) {
      // Offline or GitHub unavailable: try again next time the app starts.
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sub ??= context.read<DataController>().newAlerts.listen(_showBanner);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _showBanner(DriverAlert a) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: a.type.severe
              ? const Color(0xFF3B0D12)
              : AppColors.ink800,
          duration: Duration(seconds: a.type.severe ? 8 : 5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: (a.type.severe ? AppColors.danger : AppColors.warn)
                  .withValues(alpha: 0.6),
            ),
          ),
          content: Text(
            '${a.driverName ?? 'Driver'}: ${a.type.label} · ${(a.confidence * 100).round()}%',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
          action: SnackBarAction(
            label: 'View',
            onPressed: () => context.go('/alerts'),
          ),
        ),
      );
  }

  int get _index {
    final i = HomeShell.tabs.indexWhere(
      (t) => t.path != '/' && widget.location.startsWith(t.path),
    );
    return i < 0 ? 0 : i;
  }

  @override
  Widget build(BuildContext context) {
    final unack = context.select<DataController, int>((d) => d.unacknowledged);
    return Scaffold(
      extendBody: true,
      body: MeshBackground(child: SafeArea(bottom: false, child: widget.child)),
      bottomNavigationBar: SafeArea(
        child: Container(
          margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          decoration: BoxDecoration(
            color: AppColors.ink900.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(AppMotion.radius),
            border: Border.all(color: AppColors.glassBorder),
            boxShadow: AppShadows.depth3,
          ),
          child: NavigationBar(
            height: 64,
            backgroundColor: Colors.transparent,
            indicatorColor: AppColors.primary.withValues(alpha: 0.3),
            selectedIndex: _index,
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            onDestinationSelected: (i) => context.go(HomeShell.tabs[i].path),
            destinations: [
              for (final t in HomeShell.tabs)
                NavigationDestination(
                  icon: t.path == '/alerts' && unack > 0
                      ? Badge(
                          label: Text(unack > 9 ? '9+' : '$unack'),
                          child: Icon(t.icon),
                        )
                      : Icon(t.icon),
                  label: t.label,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
