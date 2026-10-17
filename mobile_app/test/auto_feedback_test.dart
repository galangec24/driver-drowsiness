import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/brand.dart';
import 'package:guardian_drive/models/driver.dart';
import 'package:guardian_drive/models/feedback.dart';

void main() {
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
