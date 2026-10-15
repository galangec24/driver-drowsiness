import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/brand.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/driver.dart';
import 'package:guardian_drive/models/feedback.dart';
import 'package:guardian_drive/widgets/auto_sensitivity_card.dart';

void main() {
  testWidgets(
    'automatic sensitivity is explained in plain words (no sliders)',
    (tester) async {
      final tuning = DriverTuning.fromJson({
        'mode': 'reduced',
        'eyeSamples': 4200,
        'falseAlarms': 3,
        'realAlarms': 1,
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          home: Scaffold(
            body: AutoSensitivityCard(name: 'Ana', tuning: tuning),
          ),
        ),
      );
      expect(find.text('Automatic · Fewer false alarms'), findsOneWidget);
      expect(
        find.textContaining("4200 readings of Ana's eyes"),
        findsOneWidget,
      );
      expect(find.textContaining('1 real, 3 false alarms'), findsOneWidget);
      expect(find.byType(Slider), findsNothing);
    await tester.pump(const Duration(seconds: 3)); // let the card's animation finish
    },
  );

  test('a driver without tuning data is "learning"', () {
    expect(DriverTuning.fromJson(null).mode, 'learning');
  });

  test('feedback items keep the team reply', () {
    final f = FeedbackItem.fromJson({
      'id': 'f1',
      'category': 'bug',
      'message': 'Map frozen',
      'status': 'resolved',
      'createdAt': '2026-10-15T10:00:00Z',
      'attachments': [{}, {}],
      'adminReply': 'Fixed, thanks!',
    });
    expect(f.attachments, 2);
    expect(FeedbackItem.statusLabel[f.status], 'Resolved');
    expect(f.adminReply, 'Fixed, thanks!');
  });

  test('copyright year updates by itself', () {
    expect(
      copyrightNotice(DateTime(2026, 5)),
      startsWith('© 2026 Guardian Drive'),
    );
    expect(copyrightNotice(DateTime(2028, 1)), startsWith('© 2026–2028'));
  });
}
