import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/links.dart';
import '../config/theme.dart';
import 'depth_button.dart';

/// A random, URL-safe id for one browser hand-off (32 random bytes).
String newHandoffId([Random? random]) {
  final r = random ?? Random.secure();
  final bytes = List<int>.generate(32, (_) => r.nextInt(256));
  return base64UrlEncode(bytes).replaceAll('=', '');
}

/// "Continue with Google" for the Android app. Google does not allow signing in inside an app's
/// web view, so this opens the website's /app-login page in the phone's browser and waits: the
/// server hands the session back to the app once (it expires after 5 minutes).
class GoogleHandoffButton extends StatefulWidget {
  const GoogleHandoffButton({
    super.key,
    required this.isEnabled,
    required this.collect,
    this.openBrowser,
  });

  /// Whether the server has Google sign-in set up (GET /auth/config).
  final Future<bool> Function() isEnabled;

  /// Polls the hand-off; true once the app is signed in.
  final Future<bool> Function(String id) collect;

  /// Opens the browser (overridable in tests).
  final Future<bool> Function(Uri url)? openBrowser;

  @override
  State<GoogleHandoffButton> createState() => _GoogleHandoffButtonState();
}

class _GoogleHandoffButtonState extends State<GoogleHandoffButton>
    with WidgetsBindingObserver {
  static const _poll = Duration(seconds: 2);
  static const _giveUp = Duration(minutes: 5);

  bool _enabled = false;
  String? _id;
  DateTime? _until;
  Timer? _timer;
  bool _checking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget
        .isEnabled()
        .then((v) {
          if (mounted) setState(() => _enabled = v);
        })
        .catchError((Object _) {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  // Back from the browser: check right away instead of waiting for the next tick.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _id != null) _check();
  }

  Future<void> _start() async {
    final id = newHandoffId();
    final url = Uri.parse('$webAppUrl/app-login?handoff=$id&app=android');
    setState(() {
      _error = null;
      _id = id;
      _until = DateTime.now().add(_giveUp);
    });
    final open =
        widget.openBrowser ??
        (Uri u) => launchUrl(u, mode: LaunchMode.externalApplication);
    final ok = await open(url);
    if (!ok) {
      _stop(error: 'Could not open the browser.');
      return;
    }
    _timer?.cancel();
    _timer = Timer.periodic(_poll, (_) => _check());
  }

  Future<void> _check() async {
    final id = _id;
    if (id == null || _checking) return;
    if (_until != null && DateTime.now().isAfter(_until!)) {
      _stop(error: 'Sign-in timed out. Try again.');
      return;
    }
    _checking = true;
    try {
      if (await widget.collect(id)) _stop();
    } catch (_) {
      // Network hiccup: keep waiting until the time limit.
    } finally {
      _checking = false;
    }
  }

  void _stop({String? error}) {
    _timer?.cancel();
    _timer = null;
    if (mounted) {
      setState(() {
        _id = null;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_enabled) return const SizedBox.shrink();
    final divider = Expanded(
      child: Divider(color: Colors.white.withValues(alpha: 0.12)),
    );
    return Column(
      key: const ValueKey('google-handoff'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              divider,
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 10),
                child: Text(
                  'OR',
                  style: TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              ),
              divider,
            ],
          ),
        ),
        if (_id == null)
          DepthButton(
            key: const ValueKey('continue-with-google'),
            label: 'Continue with Google',
            icon: Icons.g_mobiledata_rounded,
            variant: DepthVariant.secondary,
            expand: true,
            onPressed: _start,
          )
        else
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Column(
              children: [
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Finish signing in with Google in your browser.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Then come back here: you are signed in automatically.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted, fontSize: 12),
                ),
                TextButton(
                  onPressed: () => _stop(),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFFECACA)),
            ),
          ),
      ],
    );
  }
}
