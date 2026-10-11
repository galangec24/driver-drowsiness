import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/services/api_service.dart';
import 'package:guardian_drive/widgets/forgot_password_view.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(
    theme: buildTheme(),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );

  testWidgets('sends a code, then resets with the code and a new password', (
    tester,
  ) async {
    final sentTo = <String>[];
    final resets = <List<String>>[];
    await tester.pumpWidget(
      wrap(
        ForgotPasswordView(
          initialEmail: 'pat@example.com',
          onSendCode: (e) async {
            sentTo.add(e);
            return 60;
          },
          onReset: (e, c, p) async => resets.add([e, c, p]),
          onBack: () {},
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('forgot-submit')));
    await tester.pump();
    expect(sentTo, ['pat@example.com']);
    expect(find.text('Resend in 60s'), findsOneWidget);

    // validation first
    await tester.tap(find.byKey(const ValueKey('forgot-submit')));
    await tester.pump();
    expect(find.text('Enter the 6-digit code'), findsOneWidget);
    expect(resets, isEmpty);

    await tester.enterText(
      find.byKey(const ValueKey('forgot-code')),
      '12a3456',
    );
    await tester.enterText(
      find.byKey(const ValueKey('forgot-password')),
      'brand-new-pass',
    );
    await tester.tap(find.byKey(const ValueKey('forgot-submit')));
    await tester.pump();
    expect(resets, [
      ['pat@example.com', '123456', 'brand-new-pass'],
    ]);
    await tester.pump(const Duration(seconds: 61));
  });

  testWidgets('shows server errors (e.g. too many requests)', (tester) async {
    await tester.pumpWidget(
      wrap(
        ForgotPasswordView(
          onSendCode: (_) async => throw const ApiException(
            'Too many code requests from this network. Try again later.',
          ),
          onReset: (a, b, c) async {},
          onBack: () {},
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const ValueKey('forgot-email')),
      'pat@example.com',
    );
    await tester.tap(find.byKey(const ValueKey('forgot-submit')));
    await tester.pump();
    expect(find.textContaining('Too many code requests'), findsOneWidget);
  });
}
