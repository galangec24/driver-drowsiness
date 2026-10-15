import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/theme.dart';

/// A newer APK published as a GitHub release.
class AppUpdate {
  const AppUpdate({
    required this.version,
    required this.apkUrl,
    required this.notes,
  });
  final String version;
  final Uri apkUrl;
  final String notes;
}

/// "1.0.10" > "1.0.9": numeric, part by part ("v" prefix and "+build" suffix ignored).
bool isNewerVersion(String candidate, String current) {
  List<int> parts(String v) => v
      .trim()
      .replaceFirst(RegExp(r'^[vV]'), '')
      .split('+')
      .first
      .split('.')
      .map((p) => int.tryParse(p.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0)
      .toList();
  final a = parts(candidate);
  final b = parts(current);
  for (var i = 0; i < 3; i++) {
    final x = i < a.length ? a[i] : 0;
    final y = i < b.length ? b[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}

/// Checks the GitHub release the website's download button uses (the APK is sideloaded, so there
/// is no Play Store to update it). Android then installs the downloaded APK over this one.
class UpdateService {
  UpdateService({Dio? dio, this.repo = 'galangec24/guardian-drive-download'})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 8),
              receiveTimeout: const Duration(seconds: 10),
              headers: {'Accept': 'application/vnd.github+json'},
            ),
          );

  final Dio _dio;
  final String repo;

  Future<String> currentVersion() async =>
      (await PackageInfo.fromPlatform()).version;

  /// Newest published release (version, date) for Settings → About, or null if unreachable.
  Future<({String version, DateTime? published})?> latestRelease() async {
    try {
      final r = await _dio.get<Map<String, dynamic>>(
        'https://api.github.com/repos/$repo/releases/latest',
      );
      final tag = (r.data?['tag_name'] as String?) ?? '';
      if (tag.isEmpty) return null;
      return (
        version: tag.replaceFirst(RegExp(r'^[vV]'), ''),
        published: DateTime.tryParse((r.data?['published_at'] ?? '') as String)
            ?.toLocal(),
      );
    } catch (_) {
      return null;
    }
  }

  /// The newer release, or null when this app is up to date (or the release has no APK).
  Future<AppUpdate?> check({String? current}) async {
    final installed = current ?? await currentVersion();
    final r = await _dio.get<Map<String, dynamic>>(
      'https://api.github.com/repos/$repo/releases/latest',
    );
    final data = r.data ?? const {};
    final tag = (data['tag_name'] as String?) ?? '';
    if (tag.isEmpty || !isNewerVersion(tag, installed)) return null;
    final assets = (data['assets'] as List?) ?? const [];
    final apk = assets.cast<Map<String, dynamic>>().where(
      (a) => (a['name'] as String? ?? '').toLowerCase().endsWith('.apk'),
    );
    if (apk.isEmpty) return null;
    return AppUpdate(
      version: tag.replaceFirst(RegExp(r'^[vV]'), ''),
      apkUrl: Uri.parse(apk.first['browser_download_url'] as String),
      notes: (data['body'] as String? ?? '').trim(),
    );
  }
}

/// "Version X is available": Update downloads the APK in the browser; Android then offers to
/// install it over this version (same signing key, so the account and settings are kept).
Future<void> showUpdateDialog(BuildContext context, AppUpdate update) {
  final notes = update.notes.length > 600
      ? '${update.notes.substring(0, 600)}…'
      : update.notes;
  return showDialog<void>(
    context: context,
    builder: (dialog) => AlertDialog(
      backgroundColor: AppColors.ink900,
      title: Text('Update available: ${update.version}'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'A new version of Guardian Drive is ready. Tap Update: the file downloads, then tap it '
              '(or the download notification) and choose Update. You stay signed in.',
            ),
            if (notes.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                notes.replaceAll(RegExp(r'[#*|`]'), ''),
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialog),
          child: const Text('Later'),
        ),
        FilledButton.icon(
          key: const ValueKey('update-now'),
          icon: const Icon(Icons.system_update_rounded),
          label: const Text('Update'),
          onPressed: () {
            Navigator.pop(dialog);
            launchUrl(update.apkUrl, mode: LaunchMode.externalApplication);
          },
        ),
      ],
    ),
  );
}
