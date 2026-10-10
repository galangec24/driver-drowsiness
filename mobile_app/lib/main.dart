import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'config/router.dart';
import 'config/theme.dart';
import 'services/api_service.dart';
import 'services/fcm_service.dart';
import 'services/notification_service.dart';
import 'services/socket_service.dart';
import 'services/storage_service.dart';
import 'state/auth_controller.dart';
import 'state/data_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);

  final storage = await StorageService.create();
  final api = ApiService(storage);
  final notifications = NotificationService();
  await notifications.init();
  final auth = AuthController(api, storage);
  await auth.restore();
  final data = DataController(api, SocketService(), notifications, storage);
  final fcm = FcmService(api);

  // One Socket.io connection per logged-in parent.
  void syncSession() {
    final token = auth.token;
    if (token != null) {
      data.start(token);
      fcm.init();
      notifications.requestPermission();
    } else {
      data.stop();
    }
  }

  auth.addListener(syncSession);
  syncSession();

  runApp(
    GuardianApp(
      storage: storage,
      auth: auth,
      data: data,
      fcm: fcm,
      notifications: notifications,
      router: buildRouter(auth),
    ),
  );
}

class GuardianApp extends StatelessWidget {
  const GuardianApp({
    super.key,
    required this.storage,
    required this.auth,
    required this.data,
    required this.fcm,
    required this.notifications,
    required this.router,
  });

  final StorageService storage;
  final AuthController auth;
  final DataController data;
  final FcmService fcm;
  final NotificationService notifications;
  final GoRouter router;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<StorageService>.value(value: storage),
        Provider<ApiService>.value(value: data.api),
        Provider<FcmService>.value(value: fcm),
        Provider<NotificationService>.value(value: notifications),
        ChangeNotifierProvider<AuthController>.value(value: auth),
        ChangeNotifierProvider<DataController>.value(value: data),
      ],
      child: MaterialApp.router(
        title: 'Guardian Drive',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: router,
      ),
    );
  }
}
