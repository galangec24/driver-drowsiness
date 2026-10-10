import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../models/alert.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import '../widgets/alert_card.dart';
import '../widgets/alert_detail_sheet.dart';
import '../widgets/empty_state.dart';
import '../widgets/offline_banner.dart';
import '../widgets/page_header.dart';

/// Chronological feed with driver / type / status filters and acknowledge.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  String? _driverId;
  AlertType? _type;
  bool? _acknowledged;
  List<DriverAlert> _alerts = [];
  bool _loading = true;
  String? _error;
  DateTime? _cachedAt;
  final Set<String> _acking = {};

  AlertFilters get _filters => AlertFilters(
    driverId: _driverId,
    type: _type,
    acknowledged: _acknowledged,
  );

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _alerts.isEmpty;
      _error = null;
    });
    try {
      final r = await context.read<DataController>().api.alerts(_filters);
      if (!mounted) return;
      setState(() {
        _alerts = r.data.alerts;
        _cachedAt = r.cachedAt;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Merge live updates from the shared controller (new alerts, acknowledgements on other devices).
  List<DriverAlert> _visible(DataController data) {
    final shared = {for (final a in data.alerts) a.id: a};
    final fresh = data.alerts.where(
      (a) => _filters.matches(a) && !_alerts.any((x) => x.id == a.id),
    );
    return [
      ...fresh,
      for (final a in _alerts)
        if (_filters.matches(shared[a.id] ?? a)) shared[a.id] ?? a,
    ];
  }

  Future<void> _ack(String id, {bool? falseAlarm}) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _acking.add(id));
    try {
      final won = await context.read<DataController>().acknowledge(
        id,
        falseAlarm: falseAlarm,
      );
      if (!won) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Already acknowledged on another device'),
          ),
        );
      }
      final i = _alerts.indexWhere((a) => a.id == id);
      if (i >= 0 && mounted) {
        setState(
          () =>
              _alerts = List.of(_alerts)
                ..[i] = _alerts[i].acknowledge('apk', falseAlarm: falseAlarm),
        );
      }
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _acking.remove(id));
    }
  }

  Future<void> _report(String id) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<DataController>().reportFeedback(id, true);
      final i = _alerts.indexWhere((a) => a.id == id);
      if (i >= 0 && mounted) {
        setState(
          () => _alerts = List.of(_alerts)..[i] = _alerts[i].withFeedback(true),
        );
      }
      messenger.showSnackBar(
        const SnackBar(content: Text('Reported as false alarm — thank you')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Widget _chip<T>(
    String label,
    T? value,
    T? current,
    ValueChanged<T?> onSelect,
  ) {
    final selected = value == current;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          onSelect(value);
          _load();
        },
        selectedColor: AppColors.primary.withValues(alpha: 0.35),
        backgroundColor: AppColors.glassLight,
        side: const BorderSide(color: AppColors.glassBorder),
        labelStyle: TextStyle(
          color: selected ? Colors.white : AppColors.muted,
          fontWeight: FontWeight.w600,
        ),
        showCheckmark: false,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    final alerts = _visible(data);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          PageHeader(
            title: 'Alerts',
            subtitle: '${data.unacknowledged} unacknowledged',
          ),
          OfflineBanner(connected: data.connected, cachedAt: _cachedAt),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _chip<String>(
                  'All drivers',
                  null,
                  _driverId,
                  (v) => setState(() => _driverId = v),
                ),
                for (final d in data.drivers)
                  _chip<String>(
                    d.name,
                    d.id,
                    _driverId,
                    (v) => setState(() => _driverId = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _chip<bool>(
                  'All',
                  null,
                  _acknowledged,
                  (v) => setState(() => _acknowledged = v),
                ),
                _chip<bool>(
                  'Open',
                  false,
                  _acknowledged,
                  (v) => setState(() => _acknowledged = v),
                ),
                _chip<bool>(
                  'Acknowledged',
                  true,
                  _acknowledged,
                  (v) => setState(() => _acknowledged = v),
                ),
                const SizedBox(width: 8),
                _chip<AlertType>(
                  'Any type',
                  null,
                  _type,
                  (v) => setState(() => _type = v),
                ),
                for (final t in AlertType.values)
                  _chip<AlertType>(
                    t.label,
                    t,
                    _type,
                    (v) => setState(() => _type = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null && alerts.isEmpty)
            EmptyState(
              icon: Icons.cloud_off_rounded,
              title: _error!,
              subtitle: 'Pull down to retry.',
            )
          else if (alerts.isEmpty)
            const EmptyState(
              icon: Icons.shield_rounded,
              title: 'No alerts match these filters.',
            )
          else
            for (final a in alerts)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: AlertCard(
                  key: ValueKey(a.id),
                  alert: a,
                  acknowledging: _acking.contains(a.id),
                  onAcknowledge: () => _ack(a.id),
                  onFalseAlarm: () => _ack(a.id, falseAlarm: true),
                  onReportFalseAlarm: () => _report(a.id),
                  snapshotUrl: context.read<DataController>().api.assetUrl(
                    a.snapshotUrl,
                  ),
                  onDetails: () => AlertDetailSheet.show(context, a),
                ),
              ),
        ],
      ),
    );
  }
}
