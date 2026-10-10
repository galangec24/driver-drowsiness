import 'api_service.dart';

/// FCM integration point. The backend reports whether push is configured
/// (GET /api/push/config); no Firebase config ships in this APK until it is.
/// While disabled, Socket.io + local notifications deliver alerts whenever the app is running.
class FcmService {
  FcmService(this._api);

  final ApiService _api;
  bool enabled = false;

  Future<void> init() async {
    try {
      enabled = await _api.pushEnabled();
    } catch (_) {
      enabled = false;
    }
    // When enabled: obtain the device token from firebase_messaging and
    // register it with `_api.saveFcmToken(token)`.
  }
}
