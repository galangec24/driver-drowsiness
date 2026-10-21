import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/theme.dart';
import '../services/api_service.dart';

/// Deleting a driver needs a 6-digit code e-mailed to the account owner (or the driver's name
/// when the server has no e-mail set up). Returns true once the driver is deleted.
Future<bool> confirmDeleteDriver(
  BuildContext context,
  ApiService api,
  String driverId,
  String driverName,
) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (_) => DeleteDriverDialog(
      api: api,
      driverId: driverId,
      driverName: driverName,
    ),
  );
  return ok == true;
}

class DeleteDriverDialog extends StatefulWidget {
  const DeleteDriverDialog({
    super.key,
    required this.api,
    required this.driverId,
    required this.driverName,
  });

  final ApiService api;
  final String driverId;
  final String driverName;

  @override
  State<DeleteDriverDialog> createState() => _DeleteDriverDialogState();
}

class _DeleteDriverDialogState extends State<DeleteDriverDialog> {
  final _input = TextEditingController();
  String? _method; // null = not asked yet, 'email' or 'name'
  String? _email;
  String? _error;
  bool _busy = false;
  int _wait = 0;
  Timer? _timer;

  bool get _byEmail => _method == 'email';
  bool get _ready => _byEmail
      ? RegExp(r'^\d{6}$').hasMatch(_input.text.trim())
      : _input.text.trim().isNotEmpty;

  Future<void> _ask() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.requestDeleteCode(widget.driverId);
      if (!mounted) return;
      setState(() {
        _method = r.method;
        _email = r.email;
        _wait = r.method == 'email' ? r.retryAfterS : 0;
      });
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted || _wait <= 0) return t.cancel();
        setState(() => _wait -= 1);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.deleteDriver(
        widget.driverId,
        code: _byEmail ? _input.text.trim() : null,
        confirmName: _byEmail ? null : _input.text,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.driverName;
    return AlertDialog(
      key: const ValueKey('delete-driver-dialog'),
      backgroundColor: AppColors.ink900,
      title: Text('Delete $name?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "Their face profile, photos, alerts, messages and reading history are "
            "deleted for good. This can't be undone.",
            style: TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          if (_method == null)
            const Text(
              "To make sure it's really you, we'll e-mail a 6-digit code to your account.",
            )
          else ...[
            Text(
              _byEmail
                  ? 'We sent a code to ${_email ?? 'your e-mail'}. Enter it to delete $name.'
                  : 'Type $name to confirm.',
              key: const ValueKey('code-sent'),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('delete-input'),
              controller: _input,
              autofocus: true,
              keyboardType: _byEmail
                  ? TextInputType.number
                  : TextInputType.text,
              inputFormatters: _byEmail
                  ? [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ]
                  : null,
              textAlign: _byEmail ? TextAlign.center : TextAlign.start,
              style: _byEmail
                  ? const TextStyle(fontSize: 22, letterSpacing: 8)
                  : null,
              decoration: InputDecoration(
                hintText: _byEmail ? '6-digit code' : name,
              ),
              onChanged: (_) => setState(() {}),
            ),
            if (_byEmail)
              TextButton(
                onPressed: _wait > 0 || _busy ? null : _ask,
                child: Text(
                  _wait > 0 ? 'Resend code in ${_wait}s' : 'Resend code',
                ),
              ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFFCA5A5)),
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          key: const ValueKey('delete-confirm'),
          onPressed: _busy
              ? null
              : _method == null
              ? _ask
              : (_ready ? _delete : null),
          child: Text(
            _method == null ? 'Send code' : 'Delete for good',
            style: const TextStyle(color: AppColors.danger),
          ),
        ),
      ],
    );
  }
}
