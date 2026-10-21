import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/driver.dart';
import '../models/history.dart';
import '../services/api_service.dart';
import 'glass_card.dart';
import 'status_pill.dart';

/// Reading history: last reading, km driven, and one row per minute (time, state, eyes, place).
class ReadingHistory extends StatefulWidget {
  const ReadingHistory({super.key, required this.api, required this.driverId});

  final ApiService api;
  final String driverId;

  @override
  State<ReadingHistory> createState() => _ReadingHistoryState();
}

class _ReadingHistoryState extends State<ReadingHistory> {
  static const _ranges = [('Today', 0), ('24 h', 24), ('7 days', 168)];
  int _range = 0;
  int _shown = 15;
  DriverHistory? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final now = DateTime.now();
    final hours = _ranges[_range].$2;
    final from = hours == 0
        ? DateTime(now.year, now.month, now.day)
        : now.subtract(Duration(hours: hours));
    try {
      final h = await widget.api.history(widget.driverId, from: from, to: now);
      if (mounted) {
        setState(() {
          _data = h;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Widget _tile(String label, String value, [String? hint]) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.glassBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(color: AppColors.muted, fontSize: 10),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (hint != null)
            Text(
              hint,
              style: const TextStyle(color: AppColors.muted, fontSize: 10),
            ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = d?.rows ?? const <HistoryRow>[];
    return GlassCard(
      key: const ValueKey('reading-history'),
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Reading history',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              for (var i = 0; i < _ranges.length; i++)
                ChoiceChip(
                  label: Text(_ranges[i].$1),
                  selected: _range == i,
                  onSelected: (_) {
                    setState(() {
                      _range = i;
                      _shown = 15;
                    });
                    _load();
                  },
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _tile(
                'Last reading',
                d?.lastAt == null ? 'None yet' : timeAgo(d!.lastAt),
                d?.lastAt == null ? null : clock(d!.lastAt!),
              ),
              const SizedBox(width: 8),
              _tile('Distance', km(d?.totalKm), _ranges[_range].$1),
              const SizedBox(width: 8),
              _tile('Monitored', '${rows.length} min'),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFFCA5A5)),
              ),
            ),
          if (d != null && rows.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text(
                'No readings in this period.',
                style: TextStyle(color: AppColors.muted),
              ),
            ),
          for (final r in rows.take(_shown))
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.only(top: 8),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.glassLight)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${r.at.month}/${r.at.day} ${clock(r.at)}',
                          style: const TextStyle(color: Colors.white),
                        ),
                        Text(
                          '${timeAgo(r.at)} · eyes ${fixed(r.ear, 3)} · '
                          'PERCLOS ${pct(r.perclos)}'
                          '${r.heartRate != null ? ' · ${r.heartRate!.round()} bpm' : ''}',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                        Text(
                          '${r.km > 0 ? '+${km(r.km)} · ' : ''}total ${km(r.totalKm)}'
                          '${r.speed != null ? ' · ${r.speed!.round()} km/h' : ''}',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (r.lat != null)
                    IconButton(
                      tooltip: 'Open in Maps',
                      icon: const Icon(
                        Icons.place_rounded,
                        color: AppColors.glow,
                      ),
                      onPressed: () => launchUrl(
                        Uri.parse(
                          'https://www.google.com/maps?q=${r.lat},${r.lng}',
                        ),
                        mode: LaunchMode.externalApplication,
                      ),
                    ),
                  StatusPill(status: DriverStatus.parse(r.classification)),
                ],
              ),
            ),
          if (rows.length > _shown)
            TextButton(
              onPressed: () => setState(() => _shown += 30),
              child: Text('Show more (${rows.length - _shown} more minutes)'),
            ),
          const SizedBox(height: 6),
          const Text(
            'Each row sums up one minute of readings (worst state, averages). '
            "Distance comes from the car's GPS.",
            style: TextStyle(color: AppColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
