import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/alert.dart';
import 'package:guardian_drive/widgets/alert_card.dart';

Widget _wrap(Widget child) => MaterialApp(
  theme: buildTheme(),
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

DriverAlert _alert({
  bool expired = false,
  bool acknowledged = false,
  bool read = false,
}) => DriverAlert.fromJson({
  'id': 'a1',
  'driverId': 'd1',
  'type': 'warning',
  'confidence': 0.6,
  'acknowledged': acknowledged,
  'expired': expired,
  'read': read,
  'createdAt': DateTime.now().toIso8601String(),
  'driverName': 'Alex',
  'sensorSnapshot': {
    'fatigueReason': 'Fatigue signs: repeated yawning (3+ in 10 min)',
  },
});

void main() {
  test(
    'read / expired / fatigue reason are parsed, and filters match them',
    () {
      final a = _alert(expired: true);
      expect(a.expired, isTrue);
      expect(a.open, isFalse);
      expect(a.read, isFalse);
      expect(a.fatigueReason, contains('repeated yawning'));
      expect(statusOf(a), AlertStatus.expired);
      expect(
        const AlertFilters(status: AlertStatus.expired).matches(a),
        isTrue,
      );
      expect(const AlertFilters(status: AlertStatus.open).matches(a), isFalse);
      expect(const AlertFilters(read: false).matches(a), isTrue);
      expect(
        const AlertFilters(read: false).matches(a.copyWith(read: true)),
        isFalse,
      );
      expect(
        const AlertFilters(status: AlertStatus.expired, read: false).toQuery(),
        containsPair('status', 'expired'),
      );
      // acknowledging also reads the notification
      expect(_alert().acknowledge('apk').read, isTrue);
    },
  );

  testWidgets('a previous-day alert can only be removed (after confirming)', (
    tester,
  ) async {
    var acked = 0;
    var removed = 0;
    await tester.pumpWidget(
      _wrap(
        AlertCard(
          alert: _alert(expired: true),
          animateIn: false,
          onAcknowledge: () => acked++,
          onFalseAlarm: () => acked++,
          onRemove: () => removed++,
        ),
      ),
    );
    expect(find.byKey(const ValueKey('expired-label')), findsOneWidget);
    expect(find.text('Unacknowledged · from a previous day'), findsOneWidget);
    expect(find.byKey(const ValueKey('ack-button')), findsNothing);
    expect(find.byKey(const ValueKey('false-alarm-button')), findsNothing);
    expect(find.byKey(const ValueKey('fatigue-reason')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('remove-alert')));
    await tester.pumpAndSettle();
    expect(find.text('Remove this alert?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('confirm-remove')));
    await tester.pumpAndSettle();
    expect(removed, 1);
    expect(acked, 0);
  });

  testWidgets("today's alert can still be acknowledged", (tester) async {
    var acked = 0;
    await tester.pumpWidget(
      _wrap(
        AlertCard(
          alert: _alert(),
          animateIn: false,
          onAcknowledge: () => acked++,
          onRemove: () {},
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('ack-button')));
    expect(acked, 1);
    expect(find.byKey(const ValueKey('expired-label')), findsNothing);
  });
}
