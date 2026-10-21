import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/engagement.dart';
import 'package:guardian_drive/models/history.dart';
import 'package:guardian_drive/services/api_service.dart';
import 'package:guardian_drive/services/storage_service.dart';
import 'package:guardian_drive/widgets/delete_driver_dialog.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeApi extends ApiService {
  _FakeApi(super.storage);
  final deletes = <Map<String, String?>>[];

  @override
  Future<({String method, String? email, int retryAfterS})> requestDeleteCode(
    String id,
  ) async => (method: 'email', email: 'maria@example.com', retryAfterS: 60);

  @override
  Future<void> deleteDriver(
    String id, {
    String? code,
    String? confirmName,
  }) async => deletes.add({'id': id, 'code': code});
}

void main() {
  testWidgets('deleting a driver needs the e-mailed code', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = _FakeApi(await StorageService.create());
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await confirmDeleteDriver(
              context,
              api,
              'd1',
              'Miguel',
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delete-confirm'))); // Send code
    await tester.pumpAndSettle();
    expect(find.textContaining('maria@example.com'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('delete-input')), '12a34');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('delete-confirm')));
    await tester.pump();
    expect(api.deletes, isEmpty); // 5 digits: not yet

    await tester.enterText(
      find.byKey(const ValueKey('delete-input')),
      '123456',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('delete-confirm')));
    await tester.pumpAndSettle();
    expect(api.deletes, [
      {'id': 'd1', 'code': '123456'},
    ]);
    expect(result, isTrue);
  });

  test('history rows are parsed with km', () {
    final h = DriverHistory.fromJson({
      'totalKm': 12.34,
      'lastReading': {
        'at': '2026-10-21T08:00:00Z',
        'classification': 'warning',
      },
      'rows': [
        {
          'at': '2026-10-21T08:00:00Z',
          'readings': 58,
          'classification': 'warning',
          'ear': 0.22,
          'perclos': 0.31,
          'heartRate': 72,
          'location': {'lat': 14.5, 'lng': 121, 'speed': 42},
          'km': 0.8,
          'totalKm': 12.34,
        },
      ],
    });
    expect(h.totalKm, 12.34);
    expect(h.lastClassification, 'warning');
    expect(h.rows.single.readings, 58);
    expect(h.rows.single.speed, 42);
    expect(km(h.totalKm), '12.3 km');
    expect(km(0.8), '0.80 km');
  });

  test('reminders come in Tagalog, Bisaya and Chinese too', () {
    final labels = [for (final l in reminderLanguages) l.$1];
    expect(labels, ['English', 'Tagalog', 'Bisaya', '中文']);
    expect(reminderLanguages[1].$2, contains('Tawagan mo ako pagdating mo.'));
  });
}
