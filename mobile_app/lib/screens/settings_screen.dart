import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
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
            InkWell(
              onTap: _editServer,
              child: _Row(
                'Server',
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
