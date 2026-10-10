import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/alert.dart';
import 'package:guardian_drive/models/geo_location.dart';
import 'package:guardian_drive/screens/login_screen.dart';
import 'package:guardian_drive/screens/register_driver_screen.dart';
import 'package:guardian_drive/services/api_service.dart';
import 'package:guardian_drive/services/storage_service.dart';
import 'package:guardian_drive/state/auth_controller.dart';
import 'package:guardian_drive/widgets/alert_card.dart';
import 'package:guardian_drive/widgets/location_map.dart';
import 'package:guardian_drive/widgets/orbit_loader.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap(Widget child) => MaterialApp(
  theme: buildTheme(),
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

const _makati = GeoLocation(
  lat: 14.5547,
  lng: 121.0244,
  heading: 92,
  speed: 58,
);

void main() {
  group('GeoLocation', () {
    test('parses the API shape and builds Google Maps links', () {
      final loc = GeoLocation.fromJson({
        'lat': 14.5547,
        'lng': 121.0244,
        'heading': 181,
        'speed': 61.2,
        'at': '2026-10-08T08:00:00.000Z',
      })!;
      expect(loc.compass, 'S');
      expect(loc.at, isNotNull);
      expect(
        loc.directionsUri.toString(),
        'https://www.google.com/maps/dir/?api=1&destination=14.554700,121.024400&travelmode=driving',
      );
      expect(loc.embedUri().toString(), contains('output=embed'));
      expect(loc.coords, '14.55470° N, 121.02440° E');
      expect(GeoLocation.fromJson(null), isNull);
      expect(GeoLocation.fromJson({'lat': 1}), isNull);
    });

    test('distance and compass wrap-around', () {
      const a = GeoLocation(lat: 14.5547, lng: 121.0244);
      const b = GeoLocation(lat: 14.5557, lng: 121.0244);
      expect(a.distanceTo(b), closeTo(111, 1));
      expect(const GeoLocation(lat: 0, lng: 0, heading: 350).compass, 'N');
      expect(const GeoLocation(lat: 0, lng: 0, heading: -90).compass, 'W');
    });

    test('alerts carry location and snapshot; copyWith keeps them', () {
      final a = DriverAlert.fromJson({
        'id': 'a1',
        'driverId': 'd1',
        'type': 'drowsy',
        'confidence': 0.8,
        'acknowledged': false,
        'createdAt': '2026-10-08T08:00:00.000Z',
        'location': {'lat': 14.5, 'lng': 121.0},
        'snapshotUrl': '/uploads/alerts/d1/a1.jpg',
      });
      expect(a.location!.lat, 14.5);
      final acked = a.acknowledge('apk');
      expect(acked.snapshotUrl, '/uploads/alerts/d1/a1.jpg');
      expect(acked.location, isNotNull);
    });
  });

  group('Driver names (twins)', () {
    test('identical names are rejected regardless of case/spacing', () {
      const existing = ['Juan Dela Cruz'];
      expect(validateDriverName('', existing), 'Enter the driver’s name');
      expect(validateDriverName('J', existing), contains('at least 2'));
      expect(validateDriverName('123', existing), contains('letters'));
      expect(
        validateDriverName('  juan   DELA cruz ', existing),
        allOf(contains('already registered'), contains('Twins')),
      );
      expect(validateDriverName('Jose Dela Cruz', existing), isNull);
      expect(validateDriverName('Juan Dela Cruz Jr.', existing), isNull);
    });
  });

  group('LocationMap', () {
    testWidgets('shows coordinates, heading, speed and Google Maps actions', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const LocationMap(location: _makati)));
      expect(find.byKey(const ValueKey('location-map')), findsOneWidget);
      expect(find.text('14.55470° N, 121.02440° E'), findsOneWidget);
      expect(find.textContaining('Heading E'), findsOneWidget);
      expect(find.textContaining('58 km/h'), findsOneWidget);
      expect(find.byKey(const ValueKey('directions')), findsOneWidget);
      expect(find.byKey(const ValueKey('open-maps')), findsOneWidget);
    });

    testWidgets('explains when there is no location yet', (tester) async {
      await tester.pumpWidget(_wrap(const LocationMap(location: null)));
      expect(find.text('No location yet.'), findsOneWidget);
    });
  });

  group('AlertCard details', () {
    final alert = DriverAlert(
      id: 'a1',
      driverId: 'd1',
      type: AlertType.drowsy,
      confidence: 0.8,
      acknowledged: false,
      createdAt: DateTime.now(),
      driverName: 'Alex',
      location: _makati,
    );

    testWidgets('a located alert offers the map; tapping opens details', (
      tester,
    ) async {
      var opened = 0;
      await tester.pumpWidget(
        _wrap(
          AlertCard(alert: alert, animateIn: false, onDetails: () => opened++),
        ),
      );
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('Map'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('alert-details')));
      expect(opened, 1);
    });

    testWidgets('no location and no snapshot → no details button', (
      tester,
    ) async {
      final plain = DriverAlert(
        id: 'a2',
        driverId: 'd1',
        type: AlertType.warning,
        confidence: 0.5,
        acknowledged: false,
        createdAt: DateTime.now(),
      );
      await tester.pumpWidget(
        _wrap(AlertCard(alert: plain, animateIn: false, onDetails: () {})),
      );
      expect(find.byKey(const ValueKey('alert-details')), findsNothing);
    });
  });

  group('Login polish', () {
    testWidgets('fields have icons and the password can be revealed', (
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
      expect(find.byKey(const ValueKey('icon-email')), findsOneWidget);
      expect(find.byKey(const ValueKey('icon-password')), findsOneWidget);
      expect(find.byKey(const ValueKey('tilt-3d')), findsOneWidget);

      EditableText password() => tester.widget<EditableText>(
        find.descendant(
          of: find.byKey(const ValueKey('field-password')),
          matching: find.byType(EditableText),
        ),
      );
      expect(password().obscureText, isTrue);
      await tester.tap(find.byKey(const ValueKey('toggle-password')));
      await tester.pump();
      expect(password().obscureText, isFalse);
    });

    testWidgets('OrbitLoader renders its label', (tester) async {
      await tester.pumpWidget(
        _wrap(const OrbitLoader(label: 'Signing you in…')),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Signing you in…'), findsOneWidget);
    });
  });
}
