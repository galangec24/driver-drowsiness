import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/config/theme.dart';
import 'package:guardian_drive/widgets/farewell_view.dart';
import 'package:guardian_drive/widgets/google_handoff_button.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(
    theme: buildTheme(),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );

  testWidgets('farewell thanks the user and offers to sign in again', (
    tester,
  ) async {
    var again = 0;
    await tester.pumpWidget(
      wrap(FarewellView(name: 'Pat', onSignInAgain: () => again++)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Thanks for using Guardian Drive, Pat!'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('sign-in-again')));
    expect(again, 1);
  });

  test('hand-off ids are URL-safe and long enough to be unguessable', () {
    final id = newHandoffId(Random(1));
    expect(id, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
    expect(newHandoffId(), isNot(newHandoffId()));
  });

  testWidgets(
    'Google sign-in opens the browser, then collects the session from the server',
    (tester) async {
      Uri? opened;
      var polls = 0;
      await tester.pumpWidget(
        wrap(
          GoogleHandoffButton(
            isEnabled: () async => true,
            collect: (id) async => ++polls >= 2,
            openBrowser: (u) async {
              opened = u;
              return true;
            },
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('continue-with-google')));
      await tester.pump();
      expect(
        opened.toString(),
        matches(RegExp(r'/app-login\?handoff=[A-Za-z0-9_-]{43}&app=android$')),
      );
      expect(
        find.textContaining('Finish signing in with Google'),
        findsOneWidget,
      );
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 2));
      expect(polls, 2);
      await tester.pump();
      expect(
        find.byKey(const ValueKey('continue-with-google')),
        findsOneWidget,
      );
    },
  );

  testWidgets('hidden when the server has no Google sign-in', (tester) async {
    await tester.pumpWidget(
      wrap(
        GoogleHandoffButton(
          isEnabled: () async => false,
          collect: (_) async => false,
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const ValueKey('continue-with-google')), findsNothing);
  });
}
