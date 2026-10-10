import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/alert.dart';
import 'package:guardian_drive/models/driver.dart';
import 'package:guardian_drive/screens/login_screen.dart';
import 'package:guardian_drive/services/api_service.dart';
import 'package:guardian_drive/services/storage_service.dart';
import 'package:guardian_drive/state/auth_controller.dart';
import 'package:guardian_drive/widgets/alert_card.dart';
import 'package:guardian_drive/widgets/driver_card.dart';
import 'package:guardian_drive/widgets/glass_card.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap(Widget child) => MaterialApp(
  theme: buildTheme(),
  home: Scaffold(body: Center(child: child)),
);

const _thresholds = Thresholds(
  earThreshold: 0.21,
  perclosThreshold: 0.4,
  drowsyDurationMs: 2000,
  fusionWeightVision: 0.6,
  fusionWeightPhysio: 0.4,
);

void main() {
  group('GlassCard', () {
    testWidgets('renders its child on a blurred glass surface', (tester) async {
      await tester.pumpWidget(
        _wrap(const GlassCard(child: Text('Hello driver'))),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Hello driver'), findsOneWidget);
      expect(find.byType(BackdropFilter), findsOneWidget);
      expect(find.byKey(const ValueKey('glass-card')), findsOneWidget);
    });

    testWidgets('tap fires onTap', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _wrap(GlassCard(onTap: () => taps++, child: const Text('Tap me'))),
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Tap me'));
      await tester.pump(const Duration(milliseconds: 200));
      expect(taps, 1);
    });
  });

  group('DriverCard', () {
    final driver = Driver(
      id: 'd1',
      name: 'Alex Rivera',
      relationship: 'daughter',
      referencePhotoUrl: '',
      thresholds: _thresholds,
      faceEnrolled: true,
      photoCount: 3,
      status: DriverStatus.drowsy,
      lastUpdate: DateTime.now(),
    );

    testWidgets('renders name, relationship, status and live signals', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          SingleChildScrollView(
            child: DriverCard(
              driver: driver,
              status: DriverStatus.drowsy,
              live: DriverLive(
                driverId: 'd1',
                status: DriverStatus.drowsy,
                lastUpdate: DateTime.now(),
                fusionScore: 0.82,
                ear: 0.081,
                perclos: 0.6,
                heartRate: 48,
              ),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Alex Rivera'), findsOneWidget);
      expect(find.text('Daughter'), findsOneWidget);
      expect(find.text('Drowsy'), findsOneWidget);
      expect(find.text('82%'), findsOneWidget);
      expect(find.text('0.081'), findsOneWidget);
      expect(find.text('60%'), findsOneWidget);
      expect(find.text('48'), findsOneWidget);
      expect(find.text('AR'), findsOneWidget); // avatar initials fallback
    });

    testWidgets('offline driver hides stale signals', (tester) async {
      await tester.pumpWidget(
        _wrap(
          SingleChildScrollView(
            child: DriverCard(driver: driver, status: DriverStatus.offline),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Offline'), findsOneWidget);
      expect(find.text('—'), findsNWidgets(5)); // score + EAR, PERCLOS, HR, Yawns
    });
  });

  group('AlertCard', () {
    testWidgets(
      'unacknowledged alert offers Acknowledge; acknowledged shows who',
      (tester) async {
        var acked = false;
        final alert = DriverAlert(
          id: 'a1',
          driverId: 'd1',
          type: AlertType.microsleep,
          confidence: 0.86,
          acknowledged: false,
          createdAt: DateTime.now(),
          driverName: 'Alex',
        );
        await tester.pumpWidget(
          _wrap(AlertCard(alert: alert, onAcknowledge: () => acked = true)),
        );
        await tester.pump(const Duration(milliseconds: 450));
        expect(find.text('Microsleep'), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('ack-button')));
        expect(acked, isTrue);

        await tester.pumpWidget(
          _wrap(AlertCard(alert: alert.acknowledge('web'), animateIn: false)),
        );
        await tester.pump();
        expect(find.byKey(const ValueKey('ack-button')), findsNothing);
        expect(find.textContaining('Acknowledged via Web'), findsOneWidget);
      },
    );
  });

  group('False-alarm feedback', () {
    final alert = DriverAlert(
      id: 'fa1',
      driverId: 'd1',
      type: AlertType.drowsy,
      confidence: 0.8,
      acknowledged: false,
      createdAt: DateTime.now(),
      driverName: 'Alex',
    );

    testWidgets('False alarm button acknowledges with a label', (tester) async {
      var reported = false;
      await tester.pumpWidget(
        _wrap(
          AlertCard(
            alert: alert,
            onAcknowledge: () {},
            onFalseAlarm: () => reported = true,
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 450));
      await tester.tap(find.byKey(const ValueKey('false-alarm-button')));
      expect(reported, isTrue);
    });

    testWidgets('acknowledged alerts can be reported once', (tester) async {
      var reported = false;
      final acked = alert.acknowledge('web');
      await tester.pumpWidget(
        _wrap(
          AlertCard(
            alert: acked,
            animateIn: false,
            onReportFalseAlarm: () => reported = true,
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('report-false-alarm')));
      expect(reported, isTrue);

      await tester.pumpWidget(
        _wrap(AlertCard(alert: acked.withFeedback(true), animateIn: false)),
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('fa-label')), findsOneWidget);
      expect(find.byKey(const ValueKey('report-false-alarm')), findsNothing);
    });
  });

  group('Login form validation', () {
    test('validateAuthForm rules', () {
      expect(
        validateAuthForm(register: false, name: '', email: 'bad', password: ''),
        {'email': 'Enter a valid email', 'password': 'Enter your password'},
      );
      expect(
        validateAuthForm(
          register: false,
          name: '',
          email: 'a@b.co',
          password: 'x',
        ),
        isEmpty,
      );
      expect(
        validateAuthForm(
          register: true,
          name: ' ',
          email: 'a@b.co',
          password: 'short',
        ),
        {'name': 'Enter your name', 'password': 'Use at least 8 characters'},
      );
    });

    testWidgets('LoginScreen shows field errors instead of submitting', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      final storage = await StorageService.create();
      final auth = AuthController(ApiService(storage), storage);

      await tester.pumpWidget(
        ChangeNotifierProvider<AuthController>.value(
          value: auth,
          child: MaterialApp(theme: buildTheme(), home: const LoginScreen()),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const ValueKey('submit')));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Enter a valid email'), findsOneWidget);
      expect(find.text('Enter your password'), findsOneWidget);
      expect(auth.isLoggedIn, isFalse);
    });
  });
}
