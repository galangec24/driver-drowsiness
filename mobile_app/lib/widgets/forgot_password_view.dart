import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/theme.dart';
import '../services/api_service.dart';
import 'depth_button.dart';

/// Forgot password, parity with the web ForgotPasswordForm: e-mail a 6-digit code, then enter it
/// with a new password (which signs in).
class ForgotPasswordView extends StatefulWidget {
  const ForgotPasswordView({
    super.key,
    this.initialEmail = '',
    required this.onSendCode,
    required this.onReset,
    required this.onBack,
  });

  final String initialEmail;

  /// E-mails a reset code; returns seconds until another may be requested.
  final Future<int> Function(String email) onSendCode;

  /// Sets the new password and signs in; throws ApiException with a readable message on failure.
  final Future<void> Function(String email, String code, String password)
  onReset;
  final VoidCallback onBack;

  @override
  State<ForgotPasswordView> createState() => _ForgotPasswordViewState();
}

class _ForgotPasswordViewState extends State<ForgotPasswordView> {
  late final _email = TextEditingController(text: widget.initialEmail);
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  bool _obscure = true;
  int _wait = 0;
  Timer? _timer;
  Map<String, String> _errors = {};
  String? _error;

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _wait = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _wait = _wait > 0 ? _wait - 1 : 0);
      if (_wait == 0) t.cancel();
    });
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      setState(() => _errors = {'email': 'Enter a valid email'});
      return;
    }
    setState(() {
      _errors = {};
      _error = null;
      _busy = true;
    });
    try {
      final wait = await widget.onSendCode(email);
      if (!mounted) return;
      setState(() => _codeSent = true);
      _startTimer(wait);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final errors = <String, String>{};
    if (!RegExp(r'^\d{6}$').hasMatch(_code.text.trim())) {
      errors['code'] = 'Enter the 6-digit code';
    }
    if (_password.text.length < 8) {
      errors['password'] = 'Use at least 8 characters';
    }
    setState(() {
      _errors = errors;
      _error = null;
    });
    if (errors.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.onReset(
        _email.text.trim(),
        _code.text.trim(),
        _password.text,
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  InputDecoration _decoration(String key, String label, IconData icon) =>
      InputDecoration(
        labelText: label,
        errorText: _errors[key],
        prefixIcon: Icon(icon),
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('forgot-view'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.lock_reset_rounded, color: AppColors.glow, size: 44),
        const SizedBox(height: 10),
        const Text(
          'Reset your password',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          _codeSent
              ? 'If an account uses ${_email.text.trim()}, a 6-digit code is on its way. '
                    'Check your inbox (and spam), then choose a new password.'
              : "Enter your account's e-mail and we'll send you a 6-digit code.",
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted),
        ),
        const SizedBox(height: 18),
        if (!_codeSent)
          TextField(
            key: const ValueKey('forgot-email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            style: const TextStyle(color: Colors.white),
            decoration: _decoration('email', 'Email', Icons.mail_rounded),
            onSubmitted: (_) => _send(),
          )
        else ...[
          TextField(
            key: const ValueKey('forgot-code'),
            controller: _code,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            style: const TextStyle(color: Colors.white, letterSpacing: 4),
            decoration: _decoration(
              'code',
              '6-digit code',
              Icons.verified_user_rounded,
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            key: const ValueKey('forgot-password'),
            controller: _password,
            obscureText: _obscure,
            autofillHints: const [AutofillHints.newPassword],
            style: const TextStyle(color: Colors.white),
            decoration:
                _decoration(
                  'password',
                  'New password',
                  Icons.lock_rounded,
                ).copyWith(
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Show password' : 'Hide password',
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_rounded
                          : Icons.visibility_off_rounded,
                    ),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
            onSubmitted: (_) => _reset(),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(
            _error!,
            key: const ValueKey('forgot-error'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFFECACA)),
          ),
        ],
        const SizedBox(height: 18),
        DepthButton(
          key: const ValueKey('forgot-submit'),
          label: _codeSent ? 'Reset password and sign in' : 'Send code',
          loading: _busy,
          expand: true,
          onPressed: _codeSent ? _reset : _send,
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              onPressed: widget.onBack,
              child: const Text(
                '← Back to sign in',
                style: TextStyle(color: AppColors.muted),
              ),
            ),
            if (_codeSent)
              TextButton(
                onPressed: _wait > 0 || _busy ? null : _send,
                child: Text(_wait > 0 ? 'Resend in ${_wait}s' : 'Resend code'),
              ),
          ],
        ),
      ],
    );
  }
}
