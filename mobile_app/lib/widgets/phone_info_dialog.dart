import 'package:flutter/material.dart';

import '../config/theme.dart';

/// Mobile number for drowsiness texts. Same rule as the server (backend/src/services/sms.js):
/// numbers without a country code are Philippine (0917 123 4567 → +639171234567).
String? normalizePhone(String raw) {
  final s = raw.trim();
  if (s.isEmpty) return null;
  final digits = s.replaceAll(RegExp(r'\D'), '');
  if (s.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? '+$digits' : null;
  }
  if (RegExp(r'^09\d{9}$').hasMatch(digits)) return '+63${digits.substring(1)}';
  if (RegExp(r'^639\d{9}$').hasMatch(digits)) return '+$digits';
  if (RegExp(r'^9\d{9}$').hasMatch(digits)) return '+63$digits';
  return null;
}

const phoneHint =
    'Enter a mobile number like 0917 123 4567 or +63 917 123 4567';

/// "Why your mobile number?": from the sign-up form and the profile.
Future<void> showPhoneInfo(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      key: const ValueKey('phone-info-dialog'),
      backgroundColor: AppColors.ink800,
      icon: const Icon(Icons.sms_rounded, color: AppColors.glow, size: 32),
      title: const Text(
        'Why your mobile number?',
        style: TextStyle(color: Colors.white),
      ),
      content: const SingleChildScrollView(
        child: Text.rich(
          TextSpan(
            style: TextStyle(color: AppColors.muted, height: 1.4),
            children: [
              TextSpan(
                text: 'So you’re told even when you’re offline. ',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              TextSpan(
                text:
                    'If a driver becomes drowsy or briefly falls asleep at the '
                    'wheel, we send a text message to this number, with the '
                    'time and a map link to where it happened.\n\n'
                    'A text arrives without mobile data or Wi-Fi, and with the '
                    'app closed, so you can call the driver right away. Alerts '
                    'in the app still work as usual.\n\n'
                    'We only text for drowsiness, once per alert and at most a '
                    'few times a day. We never share your number. You can '
                    'change or remove it any time in your profile.',
              ),
            ],
          ),
        ),
      ),
      actions: [
        FilledButton(
          key: const ValueKey('phone-info-ok'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Got it'),
        ),
      ],
    ),
  );
}
