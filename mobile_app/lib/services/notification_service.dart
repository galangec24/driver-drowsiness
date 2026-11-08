import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models/alert.dart';

/// Local notification + haptic on `alert:new` (mobile_app/CLAUDE.md § 8).
class NotificationService {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Tapping a notification opens its alert (set by main.dart once the router exists).
  void Function(String alertId)? onOpen;

  /// The app was started by tapping a notification: that alert, until [takeLaunchAlert].
  String? _launchAlert;

  String? takeLaunchAlert() {
    final id = _launchAlert;
    _launchAlert = null;
    return id;
  }

  static const _channel = AndroidNotificationDetails(
    'driver_alerts',
    'Driver alerts',
    channelDescription: 'Drowsiness and fatigue alerts for your drivers',
    importance: Importance.max,
    priority: Priority.high,
    category: AndroidNotificationCategory.alarm,
    color: Color(0xFFEF4444),
  );

  Future<void> init() async {
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: (r) {
          final id = r.payload;
          if (id != null && id.isNotEmpty) onOpen?.call(id);
        },
      );
      final launch = await _plugin.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp ?? false) {
        final id = launch!.notificationResponse?.payload;
        if (id != null && id.isNotEmpty) _launchAlert = id;
      }
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  Future<bool> requestPermission() async {
    final android = _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    return await android?.requestNotificationsPermission() ?? false;
  }

  Future<void> showAlert(DriverAlert alert) async {
    if (alert.type.severe) {
      await HapticFeedback.heavyImpact();
    } else {
      await HapticFeedback.mediumImpact();
    }
    if (!_ready) return;
    await _plugin.show(
      id: alert.id.hashCode & 0x7fffffff,
      title: '${alert.driverName ?? 'Driver'}: ${alert.type.label}',
      body: 'Confidence ${(alert.confidence * 100).round()}%',
      notificationDetails: const NotificationDetails(android: _channel),
      payload: alert.id,
    );
  }
}
