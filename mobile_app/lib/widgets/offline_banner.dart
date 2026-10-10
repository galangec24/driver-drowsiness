import 'package:flutter/material.dart';

import '../config/format.dart';
import '../config/theme.dart';

/// Shown while the socket is down or data comes from the offline snapshot.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.connected, this.cachedAt});

  final bool connected;
  final DateTime? cachedAt;

  @override
  Widget build(BuildContext context) {
    final show = !connected || cachedAt != null;
    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      child: !show
          ? const SizedBox(width: double.infinity)
          : Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.glassLight,
                borderRadius: BorderRadius.circular(AppMotion.radius),
                border: Border.all(
                  color: AppColors.warn.withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.wifi_off_rounded,
                    color: AppColors.warn,
                    size: 20,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      cachedAt != null
                          ? 'Offline — showing cached data. Last updated ${timeAgo(cachedAt)}.'
                          : 'Live connection lost — reconnecting. Refreshing every 10 s.',
                      style: const TextStyle(
                        color: Color(0xFFFDE68A),
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
