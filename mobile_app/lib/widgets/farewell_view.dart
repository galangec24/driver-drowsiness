import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../config/theme.dart';
import 'depth_button.dart';

/// "Thanks for using Guardian Drive": shown on the sign-in card right after signing out.
class FarewellView extends StatelessWidget {
  const FarewellView({
    super.key,
    required this.name,
    required this.onSignInAgain,
  });

  final String name;
  final VoidCallback onSignInAgain;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('farewell'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child:
              Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(26),
                      gradient: const LinearGradient(
                        colors: [AppColors.primary, AppColors.ok],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.ok.withValues(alpha: 0.45),
                          blurRadius: 28,
                        ),
                      ],
                    ),
                    child: const Icon(
                      Icons.shield_rounded,
                      color: Colors.white,
                      size: 44,
                    ),
                  )
                  .animate()
                  .scale(
                    begin: const Offset(0.6, 0.6),
                    duration: 500.ms,
                    curve: Curves.easeOutBack,
                  )
                  .rotate(begin: -0.06, duration: 500.ms),
        ),
        const SizedBox(height: 18),
        Text(
          name.isEmpty
              ? 'Thanks for using Guardian Drive!'
              : 'Thanks for using Guardian Drive, $name!',
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'You have been signed out safely.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'While you are away',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              SizedBox(height: 8),
              _Line(
                Icons.visibility_rounded,
                'The in-car monitor keeps watching for drowsiness.',
              ),
              SizedBox(height: 6),
              _Line(
                Icons.notifications_rounded,
                'Sign in again to receive alerts on this phone.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        const Text(
          'Drive safe and stay awake at the wheel.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF6EE7B7),
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 16),
        DepthButton(
          key: const ValueKey('sign-in-again'),
          label: 'Sign in again',
          icon: Icons.person_rounded,
          expand: true,
          onPressed: onSignInAgain,
        ),
      ],
    ).animate().fadeIn(duration: 300.ms);
  }
}

class _Line extends StatelessWidget {
  const _Line(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 16, color: AppColors.muted),
      const SizedBox(width: 8),
      Expanded(
        child: Text(text, style: const TextStyle(color: AppColors.muted)),
      ),
    ],
  );
}
