import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/alert.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import '../widgets/empty_state.dart';
import '../widgets/mesh_background.dart';

/// Bell with the unread count, shown on every tab (top right).
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context) {
    final unread = context.select<DataController, int>((d) => d.unread);
    return Material(
      color: AppColors.ink900.withValues(alpha: 0.7),
      shape: const CircleBorder(side: BorderSide(color: AppColors.glassBorder)),
      child: InkWell(
        key: const ValueKey('notification-bell'),
        customBorder: const CircleBorder(),
        onTap: () => context.push('/notifications'),
        child: SizedBox(
          width: 44,
          height: 44,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Icon(
                Icons.notifications_rounded,
                color: Colors.white,
                semanticLabel: unread > 0
                    ? 'Notifications, $unread unread'
                    : 'Notifications',
              ),
              if (unread > 0)
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    key: const ValueKey('unread-badge'),
                    constraints: const BoxConstraints(minWidth: 20),
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: AppColors.danger,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      unread > 99 ? '99+' : '$unread',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        height: 1.7,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Notifications, separate from acknowledging: every alert arrives unread. Opening one (or
/// "Mark all as read") moves it to Read; it can be marked unread again.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final Map<bool, List<DriverAlert>> _lists = {false: [], true: []};
  final Map<bool, bool> _loading = {false: true, true: true};
  int _seenVersion = -1;

  @override
  void initState() {
    super.initState();
    _load(false);
    _load(true);
  }

  Future<void> _load(bool read) async {
    try {
      final r = await context.read<DataController>().api.alerts(
        AlertFilters(read: read, limit: 50),
      );
      if (mounted) setState(() => _lists[read] = r.data.alerts);
    } on ApiException catch (_) {
      // offline: keep what we have
    } finally {
      if (mounted) setState(() => _loading[read] = false);
    }
  }

  Future<void> _toggle(DriverAlert a) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<DataController>().markRead(a.id, read: !a.read);
      if (!mounted) return;
      setState(() {
        _lists[a.read]!.removeWhere((x) => x.id == a.id);
        _lists[!a.read]!.insert(0, a.copyWith(read: !a.read));
      });
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _open(DriverAlert a) async {
    if (!a.read) await _toggle(a);
    if (mounted) await context.push('/drivers/${a.driverId}');
  }

  Future<void> _markAll() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<DataController>().markAllRead();
      if (!mounted) return;
      setState(() {
        _lists[true] = [
          ..._lists[false]!.map((a) => a.copyWith(read: true)),
          ..._lists[true]!,
        ];
        _lists[false] = [];
      });
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Widget _list(bool read) {
    final items = _lists[read]!;
    if (_loading[read]!) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: () => _load(read),
      child: items.isEmpty
          ? ListView(
              children: [
                const SizedBox(height: 60),
                EmptyState(
                  icon: read
                      ? Icons.drafts_rounded
                      : Icons.notifications_none_rounded,
                  title: read
                      ? 'No read notifications yet.'
                      : 'You are all caught up.',
                ),
              ],
            )
          : ListView.separated(
              key: ValueKey('notifications-${read ? 'read' : 'unread'}'),
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _tile(items[i]),
            ),
    );
  }

  Widget _tile(DriverAlert a) {
    final dot = a.read
        ? Colors.white24
        : a.type.severe
        ? AppColors.danger
        : AppColors.warn;
    final status = a.acknowledged
        ? 'Acknowledged'
        : a.expired
        ? 'Unacknowledged (previous day)'
        : 'Needs acknowledgement';
    return Material(
      color: AppColors.glassLight,
      borderRadius: BorderRadius.circular(AppMotion.radius),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppMotion.radius),
        onTap: () => _open(a),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: CircleAvatar(radius: 5, backgroundColor: dot),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${a.driverName ?? 'Driver'}: ${a.type.label}',
                      style: TextStyle(
                        color: a.read ? AppColors.muted : Colors.white,
                        fontWeight: a.read ? FontWeight.w500 : FontWeight.w700,
                      ),
                    ),
                    if (a.fatigueReason != null)
                      Text(
                        a.fatigueReason!,
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    const SizedBox(height: 2),
                    Text(
                      '${timeAgo(a.createdAt)} · $status',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: a.read ? 'Mark unread' : 'Mark read',
                onPressed: () => _toggle(a),
                icon: Icon(
                  a.read
                      ? Icons.mark_email_unread_outlined
                      : Icons.mark_email_read_outlined,
                  color: AppColors.glow,
                  size: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    if (_seenVersion != data.alertsVersion) {
      // read / removed on another device, or a new alert arrived: reload both tabs.
      final first = _seenVersion == -1;
      _seenVersion = data.alertsVersion;
      if (!first) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _load(false);
          _load(true);
        });
      }
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        appBar: AppBar(
          title: const Text('Notifications'),
          actions: [
            if (data.unread > 0)
              TextButton(
                key: const ValueKey('mark-all-read'),
                onPressed: _markAll,
                child: const Text('Mark all as read'),
              ),
          ],
          bottom: TabBar(
            tabs: [
              Tab(text: data.unread > 0 ? 'Unread (${data.unread})' : 'Unread'),
              const Tab(text: 'Read'),
            ],
          ),
        ),
        body: MeshBackground(
          child: SafeArea(
            child: TabBarView(children: [_list(false), _list(true)]),
          ),
        ),
      ),
    );
  }
}
