import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/alert.dart';
import '../models/driver.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import '../widgets/alert_card.dart';
import '../widgets/alert_detail_sheet.dart';
import '../widgets/depth_button.dart';
import '../widgets/driver_avatar.dart';
import '../widgets/glass_card.dart';
import '../widgets/location_map.dart';
import '../widgets/mesh_background.dart';
import '../widgets/signal_chart.dart';
import '../widgets/status_pill.dart';

/// Threshold sliders, EAR/HR/score charts, face verify, delete.
class DriverDetailScreen extends StatefulWidget {
  const DriverDetailScreen({super.key, required this.driverId});

  final String driverId;

  @override
  State<DriverDetailScreen> createState() => _DriverDetailScreenState();
}

class _DriverDetailScreenState extends State<DriverDetailScreen> {
  Driver? _driver;
  List<SensorPoint> _points = [];
  List<DriverAlert> _alerts = [];
  String? _error;
  bool _verifying = false;
  DateTime? _lastLive;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = context.read<DataController>();
    try {
      final results = await Future.wait([
        data.api.driver(widget.driverId),
        data.api.logs(widget.driverId),
        data.api.alerts(AlertFilters(driverId: widget.driverId, limit: 10)),
      ]);
      if (!mounted) return;
      setState(() {
        _driver = results[0] as Driver;
        _points = results[1] as List<SensorPoint>;
        _alerts =
            (results[2]
                    as ({
                      ({List<DriverAlert> alerts, int unacknowledged}) data,
                      DateTime? cachedAt,
                    }))
                .data
                .alerts;
      });
      data.subscribeDriver(widget.driverId);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _appendLive(DriverLive? live) {
    if (live == null || live.lastUpdate == _lastLive) return;
    _lastLive = live.lastUpdate;
    _points = [..._points, SensorPoint.fromLive(live)];
    if (_points.length > 120) _points = _points.sublist(_points.length - 120);
  }

  Future<void> _verify(ImageSource source) async {
    final file = await ImagePicker().pickImage(
      source: source,
      preferredCameraDevice: CameraDevice.front,
      maxWidth: 720,
      imageQuality: 88,
    );
    if (file == null || !mounted) return;
    final data = context.read<DataController>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _verifying = true);
    try {
      final bytes = await file.readAsBytes();
      final r = await data.api.verify(
        widget.driverId,
        'data:image/jpeg;base64,${base64Encode(bytes)}',
      );
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            '${r.match ? 'Face matches this driver' : 'Face does not match'} · confidence ${pct(r.confidence)}',
          ),
        ),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _delete() async {
    final d = _driver;
    if (d == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.ink900,
        title: Text('Remove ${d.name}?'),
        content: const Text(
          'This deletes the face profile and reference photo. It cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text(
              'Remove',
              style: TextStyle(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final data = context.read<DataController>();
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await data.api.deleteDriver(d.id);
      data.removeDriver(d.id);
      router.go('/drivers');
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DataController>();
    final live = data.live[widget.driverId];
    _appendLive(live);
    final d = _driver;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(title: Text(d?.name ?? 'Driver')),
      body: MeshBackground(
        child: SafeArea(
          child: d == null
              ? Center(
                  child: _error != null
                      ? Text(
                          _error!,
                          style: const TextStyle(color: Color(0xFFFECACA)),
                        )
                      : const CircularProgressIndicator(),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 64, 16, 32),
                  children: [
                    _header(
                      d,
                      data.statusOf(
                        data.drivers.firstWhere(
                          (x) => x.id == d.id,
                          orElse: () => d,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    GlassCard(
                      interactive: false,
                      child: Column(
                        children: [
                          SignalChart(
                            label: 'Eye aspect ratio (EAR)',
                            values: _points.map((p) => p.ear).toList(),
                            color: AppColors.glow,
                            threshold: d.thresholds.earThreshold,
                            minY: 0,
                            maxY: 0.4,
                          ),
                          const SizedBox(height: 16),
                          SignalChart(
                            label: 'Heart rate',
                            values: _points
                                .map(
                                  (p) => p.heartRate == 0 ? null : p.heartRate,
                                )
                                .toList(),
                            color: const Color(0xFFF472B6),
                            unit: ' bpm',
                            height: 90,
                          ),
                          const SizedBox(height: 16),
                          SignalChart(
                            label: 'Drowsiness score',
                            values: _points.map((p) => p.fusionScore).toList(),
                            color: AppColors.warn,
                            threshold: 0.7,
                            minY: 0,
                            maxY: 1,
                            height: 90,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Dashed red line on EAR = this driver’s personal threshold.',
                            style: TextStyle(
                              color: AppColors.muted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    GlassCard(
                      key: const ValueKey('live-location'),
                      interactive: false,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.place_rounded, color: AppColors.glow),
                              SizedBox(width: 6),
                              Text(
                                'Live location',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          LocationMap(
                            location:
                                live?.location ??
                                data.drivers
                                    .firstWhere(
                                      (x) => x.id == d.id,
                                      orElse: () => d,
                                    )
                                    .lastLocation,
                            label: d.name,
                            height: 280,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    _verifyCard(d),
                    const SizedBox(height: 16),
                    const Text(
                      'Recent alerts',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (_alerts.isEmpty)
                      const Text(
                        'No alerts for this driver yet.',
                        style: TextStyle(color: AppColors.muted),
                      )
                    else
                      for (final a in _mergeAlerts(data))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AlertCard(
                            alert: a,
                            animateIn: false,
                            snapshotUrl: data.api.assetUrl(a.snapshotUrl),
                            onDetails: () => AlertDetailSheet.show(context, a),
                          ),
                        ),
                    const SizedBox(height: 16),
                    DepthButton(
                      label: 'Remove driver',
                      icon: Icons.delete_outline_rounded,
                      variant: DepthVariant.danger,
                      expand: true,
                      onPressed: _delete,
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  /// Keep this list in sync with acknowledgements/new alerts from the shared controller.
  List<DriverAlert> _mergeAlerts(DataController data) {
    final shared = {for (final a in data.alerts) a.id: a};
    final newer = data.alerts.where(
      (a) => a.driverId == widget.driverId && !_alerts.any((x) => x.id == a.id),
    );
    return [
      ...newer,
      for (final a in _alerts) shared[a.id] ?? a,
    ].take(10).toList();
  }

  Widget _header(Driver d, DriverStatus status) {
    return GlassCard(
      interactive: false,
      danger: status == DriverStatus.drowsy,
      child: Row(
        children: [
          DriverAvatar(
            name: d.name,
            url: context.read<DataController>().api.assetUrl(
              d.referencePhotoUrl,
            ),
            size: 72,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  d.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  '${capitalize(d.relationship.isEmpty ? 'driver' : d.relationship)} · '
                  '${d.faceEnrolled ? 'face enrolled (${d.photoCount} photos)' : 'no face enrolled'}',
                  style: const TextStyle(color: AppColors.muted, fontSize: 13),
                ),
                if (d.lastTunedAt != null)
                  Text(
                    'Auto-tuned ${timeAgo(d.lastTunedAt)}',
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ),
          StatusPill(status: status),
        ],
      ),
    );
  }

  Widget _verifyCard(Driver d) {
    return GlassCard(
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Verify face',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Check a new photo against the enrolled face (matched on our server).',
            style: TextStyle(color: AppColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: DepthButton(
                  label: 'Camera',
                  icon: Icons.photo_camera_rounded,
                  variant: DepthVariant.secondary,
                  compact: true,
                  loading: _verifying,
                  onPressed: d.faceEnrolled
                      ? () => _verify(ImageSource.camera)
                      : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DepthButton(
                  label: 'Gallery',
                  icon: Icons.photo_library_rounded,
                  variant: DepthVariant.secondary,
                  compact: true,
                  onPressed: d.faceEnrolled && !_verifying
                      ? () => _verify(ImageSource.gallery)
                      : null,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
