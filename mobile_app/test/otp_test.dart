import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/services/api_service.dart';
import 'package:guardian_drive/widgets/otp_view.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(
    theme: buildTheme(),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );

  testWidgets('typing 6 digits verifies; resend waits for the cooldown', (
    tester,
  ) async {
    final codes = <String>[];
    var resends = 0;
    await tester.pumpWidget(
      wrap(
        OtpView(
          email: 'pat@example.com',
          retryAfterS: 2,
          onVerify: (c) async => codes.add(c),
          onResend: () async {
            resends++;
            return 60;
          },
          onBack: () {},
        ),
      ),
    );
    expect(find.textContaining('pat@example.com'), findsOneWidget);
    expect(find.text('Resend in 2s'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('otp-code')), '48a2913');
    await tester.pump();
    expect(codes, ['482913']); // letters filtered, auto-submit at 6 digits

    await tester.pump(const Duration(seconds: 3));
    await tester.tap(find.text('Resend code'));
    await tester.pump();
    expect(resends, 1);
    expect(find.text('Resend in 60s'), findsOneWidget);
  });

  testWidgets('a wrong code shows the server message', (tester) async {
    await tester.pumpWidget(
      wrap(
        OtpView(
          email: 'pat@example.com',
          retryAfterS: 0,
          onVerify: (_) async =>
              throw const ApiException('That code is not correct.'),
          onResend: () async => 60,
          onBack: () {},
        ),
      ),
    );
    await tester.enterText(find.byKey(const ValueKey('otp-code')), '000000');
    await tester.pump();
    expect(find.text('That code is not correct.'), findsOneWidget);
  });
}
