import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/models/engagement.dart';
import 'package:guardian_drive/widgets/rate_app_card.dart';

void main() {
  test('rating summary and surveys are parsed', () {
    final s = RatingSummary.fromJson({
      'count': 3,
      'average': 4.3,
      'distribution': {'1': 0, '2': 0, '3': 1, '4': 0, '5': 2},
      'recent': [
        {
          'stars': 5,
          'comment': 'Great',
          'author': 'Ana C.',
          'updatedAt': '2026-10-20T08:00:00Z',
        },
      ],
    });
    expect(s.average, 4.3);
    expect(s.distribution[5], 2);
    expect(s.recent.single.author, 'Ana C.');

    final survey = Survey.fromJson({
      'id': 's1',
      'title': 'App feedback',
      'answered': false,
      'questions': [
        {
          'qid': 'q1',
          'text': 'Device?',
          'type': 'single',
          'options': ['Android', 'Web'],
          'required': true,
        },
        {'qid': 'q2', 'text': 'Rate it', 'type': 'rating'},
      ],
    });
    expect(survey.questions.map((q) => q.type), [
      QuestionType.single,
      QuestionType.rating,
    ]);
    expect(survey.questions.first.required, isTrue);
  });

  testWidgets('star input reports the tapped star', (tester) async {
    var picked = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(body: StarRow(value: 0, onChanged: (n) => picked = n)),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('star-4')));
    expect(picked, 4);
  });
}
