import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/theme.dart';
import '../services/api_service.dart';
import 'depth_button.dart';

/// "We e-mailed you a 6-digit code" — parity with the web OtpForm. Android offers the code from
/// the e-mail notification via autofill (one-time-code); paste works too.
class OtpView extends StatefulWidget {
  const OtpView({
    super.key,
    required this.email,
    required this.retryAfterS,
    required this.onVerify,
    required this.onResend,
    required this.onBack,
  });

  final String email;
  final int retryAfterS;

  /// Verifies the code and signs in; throws ApiException with a readable message on failure.
  final Future<void> Function(String code) onVerify;

  /// Asks for a new code; returns seconds until the next resend is allowed.
  final Future<int> Function() onResend;
  final VoidCallback onBack;

  @override
  State<OtpView> createState() => _OtpViewState();
}

class _OtpViewState extends State<OtpView> {
  final _code = TextEditingController();
  Timer? _timer;
  late int _wait = widget.retryAfterS;
  bool _busy = false;
  String? _error;
  String? _info;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _wait = _wait > 0 ? _wait - 1 : 0);
      if (_wait == 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onVerify(code);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.message);
        _code.clear();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _error = null);
    try {
      final wait = await widget.onResend();
      setState(() {
        _wait = wait;
        _info = 'A new code is on its way. Check your inbox (and spam).';
      });
      _startTimer();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('otp-view'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(
          Icons.mark_email_read_rounded,
          color: AppColors.glow,
          size: 44,
        ),
        const SizedBox(height: 10),
        const Text(
          'Check your e-mail',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'We sent a 6-digit code to ${widget.email}. It expires in 10 minutes.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted),
        ),
        const SizedBox(height: 18),
        TextField(
          key: const ValueKey('otp-code'),
          controller: _code,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 30,
            fontWeight: FontWeight.w800,
            letterSpacing: 12,
          ),
          decoration: InputDecoration(
            hintText: '••••••',
            errorText: _error,
            errorMaxLines: 3,
          ),
          onChanged: (v) {
            if (v.length == 6) _verify();
          },
          onSubmitted: (_) => _verify(),
        ),
        if (_info != null && _error == null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _info!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF6EE7B7), fontSize: 13),
            ),
          ),
        const SizedBox(height: 16),
        DepthButton(
          key: const ValueKey('otp-verify'),
          label: 'Verify and sign in',
          loading: _busy,
          expand: true,
          onPressed: _verify,
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              onPressed: widget.onBack,
              child: const Text(
                '← Different e-mail',
                style: TextStyle(color: AppColors.muted),
              ),
            ),
            TextButton(
              key: const ValueKey('otp-resend'),
              onPressed: _wait > 0 ? null : _resend,
              child: Text(_wait > 0 ? 'Resend in ${_wait}s' : 'Resend code'),
            ),
          ],
        ),
      ],
    );
  }
}
