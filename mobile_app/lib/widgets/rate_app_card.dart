import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/engagement.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import 'depth_button.dart';
import 'glass_card.dart';

/// Row of 1-5 stars; tappable when [onChanged] is set.
class StarRow extends StatelessWidget {
  const StarRow({
    super.key,
    required this.value,
    this.onChanged,
    this.size = 22,
  });

  final double value;
  final ValueChanged<int>? onChanged;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var n = 1; n <= 5; n++)
          GestureDetector(
            key: ValueKey('star-$n'),
            onTap: onChanged == null ? null : () => onChanged!(n),
            child: Padding(
              padding: const EdgeInsets.all(2),
              child: Icon(
                value >= n
                    ? Icons.star_rounded
                    : value > n - 1
                    ? Icons.star_half_rounded
                    : Icons.star_outline_rounded,
                size: size,
                color: const Color(0xFFFBBF24),
                semanticLabel: '$n star${n > 1 ? 's' : ''}',
              ),
            ),
          ),
      ],
    );
  }
}

/// Settings: everyone sees the average and recent reviews; rating is optional.
class RateAppCard extends StatefulWidget {
  const RateAppCard({super.key});

  @override
  State<RateAppCard> createState() => _RateAppCardState();
}

class _RateAppCardState extends State<RateAppCard> {
  RatingSummary? _summary;
  MyRating? _mine;
  int _stars = 0;
  final _comment = TextEditingController();
  bool _saving = false;

  ApiService get _api => context.read<DataController>().api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await _api.ratingSummary();
      final m = await _api.myRating();
      if (!mounted) return;
      setState(() {
        _summary = s;
        _mine = m;
        _stars = m?.stars ?? 0;
        _comment.text = m?.comment ?? '';
      });
    } on ApiException catch (_) {
      // offline: the card shows without the summary
    }
  }

  Future<void> _save() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      final version = (await PackageInfo.fromPlatform()).version;
      final s = await _api.rate(_stars, _comment.text.trim(), version);
      if (!mounted) return;
      setState(() {
        _summary = s;
        _mine = MyRating(_stars, _comment.text.trim());
      });
      messenger.showSnackBar(
        const SnackBar(content: Text('Thank you for rating Guardian Drive')),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _remove() async {
    try {
      final s = await _api.removeRating();
      if (!mounted) return;
      setState(() {
        _summary = s;
        _mine = null;
        _stars = 0;
        _comment.clear();
      });
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    return GlassCard(
      key: const ValueKey('rate-app-card'),
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Rate Guardian Drive',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Optional. Shown to other users with your first name only.',
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          if (s != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  s.average?.toStringAsFixed(1) ?? '-',
                  key: const ValueKey('rating-average'),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StarRow(value: s.average ?? 0, size: 18),
                    Text(
                      '${s.count} ${s.count == 1 ? 'rating' : 'ratings'}',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (var n = 5; n >= 1; n--)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    SizedBox(
                      width: 48,
                      child: Text(
                        '$n star${n > 1 ? 's' : ''}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: s.count == 0
                              ? 0
                              : (s.distribution[n] ?? 0) / s.count,
                          minHeight: 10,
                          backgroundColor: Colors.white10,
                          color: const Color(0xFF7B84F5),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 28,
                      child: Text(
                        '${s.distribution[n] ?? 0}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            for (final r in s.recent.take(3))
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        StarRow(value: r.stars.toDouble(), size: 14),
                        const SizedBox(width: 6),
                        Text(
                          r.author,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          timeAgo(r.updatedAt),
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      r.comment,
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
          ],
          const Divider(height: 28, color: AppColors.glassBorder),
          Text(
            _mine == null ? 'Add your rating' : 'Your rating',
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          StarRow(
            value: _stars.toDouble(),
            size: 34,
            onChanged: (n) => setState(() => _stars = n),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('rating-comment'),
            controller: _comment,
            maxLength: 500,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'Tell others what you think (optional)',
            ),
          ),
          Wrap(
            spacing: 8,
            children: [
              DepthButton(
                key: const ValueKey('submit-rating'),
                label: _mine == null ? 'Submit rating' : 'Update rating',
                loading: _saving,
                onPressed: _stars == 0 ? null : _save,
              ),
              if (_mine != null)
                DepthButton(
                  label: 'Remove my rating',
                  variant: DepthVariant.ghost,
                  onPressed: _remove,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
