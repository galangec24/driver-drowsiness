import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../config/brand.dart';
import '../config/format.dart';
import '../config/theme.dart';
import '../services/api_service.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import '../services/update_service.dart';
import '../state/auth_controller.dart';
import '../state/data_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/glass_card.dart';
import '../widgets/page_header.dart';

/// Notification prefs, account, server, APK info.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';
  bool _checkingUpdate = false;
  // Read live, so About is always current: server version + newest published release.
  String _server = '…';
  String _latest = '…';

  Future<void> _loadAbout() async {
    final api = context.read<DataController>().api;
    try {
      final h = await api.health();
      if (mounted) {
        setState(
          () => _server =
              'Online · v${h.version}${h.commit == null ? '' : ' (${h.commit})'}',
        );
      }
    } on ApiException {
      if (mounted) setState(() => _server = 'Not reachable');
    }
    final r = await UpdateService().latestRelease();
    if (mounted) {
      setState(
        () => _latest = r == null
            ? '—'
            : '${r.version}${r.published == null ? '' : ' · ${timeAgo(r.published)}'}',
      );
    }
  }

  Future<void> _checkForUpdate() async {
    setState(() => _checkingUpdate = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final update = await UpdateService().check();
      if (!mounted) return;
      if (update == null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('You have the latest version.')),
        );
      } else {
        await showUpdateDialog(context, update);
      }
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Could not check for updates. Check your internet connection.',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _checkingUpdate = false);
    }
  }

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform()
        .then((p) {
          if (mounted) {
            setState(() => _version = '${p.version} (${p.buildNumber})');
          }
        })
        .catchError((Object _) {});
    _loadAbout();
  }

  Future<void> _editServer() async {
    final auth = context.read<AuthController>();
    final controller = TextEditingController(text: auth.serverUrl);
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.ink900,
        title: const Text('Server URL'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.url,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (url == null || url.trim().isEmpty) return;
    await auth.setServerUrl(url);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sign in again to use the new server')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final data = context.watch<DataController>();
    final storage = context.read<StorageService>();
    final fcm = context.read<FcmService>();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
      children: [
        const PageHeader(title: 'Settings'),
        _Section(
          title: 'Account',
          children: [
            _Row('Name', auth.user?.name ?? '—'),
            _Row('Email', auth.user?.email ?? '—'),
            const SizedBox(height: 12),
            DepthButton(
              label: 'Sign out',
              icon: Icons.logout_rounded,
              variant: DepthVariant.secondary,
              onPressed: () {
                data.stop();
                auth.logout(farewell: true);
              },
            ),
          ],
        ),
        const SizedBox(height: 16),
        _Section(
          title: 'Notifications',
          children: [
            _Row(
              'Live connection',
              data.connected ? 'Connected' : 'Reconnecting…',
              color: data.connected
                  ? const Color(0xFF6EE7B7)
                  : const Color(0xFFFCD34D),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'Alert notifications',
                style: TextStyle(color: Colors.white, fontSize: 14),
              ),
              subtitle: const Text(
                'Sound, banner and vibration for new alerts',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              value: storage.notificationsEnabled,
              onChanged: (v) async {
                if (v) {
                  await context.read<NotificationService>().requestPermission();
                }
                await storage.setNotificationsEnabled(v);
                setState(() {});
              },
            ),
            _Row(
              'Background push (FCM)',
              fcm.enabled ? 'Enabled by server' : 'Not configured on server',
            ),
          ],
        ),
        const SizedBox(height: 16),
        _Section(
          title: 'App',
          children: [
            _Row('Version', _version.isEmpty ? '—' : _version),
            _Row('Server status', _server),
            _Row('Latest release', _latest),
            const SizedBox(height: 8),
            DepthButton(
              key: const ValueKey('check-updates'),
              label: 'Check for updates',
              icon: Icons.system_update_rounded,
              variant: DepthVariant.secondary,
              loading: _checkingUpdate,
              onPressed: _checkForUpdate,
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: _editServer,
              child: _Row(
                'Server address',
                auth.serverUrl,
                trailing: const Icon(
                  Icons.edit_rounded,
                  size: 16,
                  color: AppColors.muted,
                ),
              ),
            ),
            const _Row('Distribution', 'Sideloaded APK'),
          ],
        ),
        const SizedBox(height: 16),
        _Section(
          title: 'Feedback',
          children: [
            const Text(
              'Found a problem or have an idea? Send it to the team, with screenshots. '
              'You will see the reply here.',
              style: TextStyle(color: AppColors.muted),
            ),
            const SizedBox(height: 10),
            DepthButton(
              key: const ValueKey('open-feedback'),
              label: 'Send feedback',
              icon: Icons.feedback_rounded,
              onPressed: () => context.push('/feedback'),
            ),
          ],
        ),
        const SizedBox(height: 20),
        Text(
          copyrightNotice(),
          key: const ValueKey('copyright'),
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted, fontSize: 11),
        ),
        const SizedBox(height: 4),
        const Text(
          'Maps © OpenStreetMap contributors, OpenFreeMap. Face detection: Google MediaPipe, face-api.js.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted, fontSize: 10),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.color, this.trailing});

  final String label;
  final String value;
  final Color? color;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(color: AppColors.muted, fontSize: 14),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color ?? Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 6), trailing!],
        ],
      ),
    );
  }
}
