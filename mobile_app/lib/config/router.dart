import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../screens/alerts_screen.dart';
import '../screens/dashboard_screen.dart';
import '../screens/driver_detail_screen.dart';
import '../screens/drivers_screen.dart';
import '../screens/feedback_screen.dart';
import '../screens/home_shell.dart';
import '../screens/login_screen.dart';
import '../screens/register_driver_screen.dart';
import '../screens/settings_screen.dart';
import '../state/auth_controller.dart';
import 'theme.dart';

/// Page transition parity with web: fade + slide-y 8px, 200 ms.
CustomTransitionPage<void> _page(GoRouterState state, Widget child) =>
    CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionDuration: AppMotion.page,
      reverseTransitionDuration: AppMotion.page,
      transitionsBuilder: (context, animation, _, child) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOut,
        );
        return FadeTransition(
          opacity: curved,
          child: AnimatedBuilder(
            animation: curved,
            builder: (_, c) => Transform.translate(
              offset: Offset(0, 8 * (1 - curved.value)),
              child: c,
            ),
            child: child,
          ),
        );
      },
    );

GoRouter buildRouter(AuthController auth) => GoRouter(
  initialLocation: '/',
  refreshListenable: auth,
  redirect: (context, state) {
    final atLogin = state.matchedLocation == '/login';
    if (!auth.isLoggedIn) return atLogin ? null : '/login';
    if (atLogin) return '/';
    return null;
  },
  routes: [
    GoRoute(
      path: '/login',
      pageBuilder: (_, s) => _page(s, const LoginScreen()),
    ),
    ShellRoute(
      builder: (context, state, child) =>
          HomeShell(location: state.uri.path, child: child),
      routes: [
        GoRoute(
          path: '/',
          pageBuilder: (_, s) => _page(s, const DashboardScreen()),
        ),
        GoRoute(
          path: '/drivers',
          pageBuilder: (_, s) => _page(s, const DriversScreen()),
        ),
        GoRoute(
          path: '/alerts',
          pageBuilder: (_, s) => _page(s, const AlertsScreen()),
        ),
        GoRoute(
          path: '/settings',
          pageBuilder: (_, s) => _page(s, const SettingsScreen()),
        ),
      ],
    ),
    GoRoute(
      path: '/feedback',
      pageBuilder: (_, s) => _page(s, const FeedbackScreen()),
    ),
    GoRoute(
      path: '/drivers/new',
      pageBuilder: (_, s) => _page(s, const RegisterDriverScreen()),
    ),
    GoRoute(
      path: '/drivers/:id',
      pageBuilder: (_, s) =>
          _page(s, DriverDetailScreen(driverId: s.pathParameters['id']!)),
    ),
  ],
);
