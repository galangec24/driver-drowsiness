import 'package:dio/dio.dart';

import '../models/alert.dart';
import '../models/driver.dart';
import '../models/feedback.dart';
import '../models/user.dart';
import 'storage_service.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.status, this.offline = false});
  final String message;
  final int? status;
  final bool offline;
  @override
  String toString() => message;
}

/// The account exists but its e-mail isn't verified yet: ask for the 6-digit code we e-mailed.
class VerificationRequired implements Exception {
  const VerificationRequired(this.email, this.retryAfterS);
  final String email;
  final int retryAfterS;
}

/// Registration refused: the face matches drivers already registered. The parent may confirm a
/// different person with the same face (twins) and resubmit with `confirmLookalike`.
class FaceMatchesDriver implements Exception {
  const FaceMatchesDriver(this.message, this.matches);
  final String message;
  final List<({String name, double confidence})> matches;
  @override
  String toString() => message;
}

/// Server check of one photo while it is being taken.
typedef PhotoCheck = ({bool ok, String? message, List<String> matches});

/// All data goes through our backend — no Firebase/Mongo SDKs, no secrets in the APK.
class ApiService {
  ApiService(this._storage) : _dio = Dio() {
    _dio.options
      ..connectTimeout = const Duration(seconds: 8)
      ..receiveTimeout = const Duration(seconds: 60)
      ..sendTimeout = const Duration(seconds: 60);
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          options.baseUrl = '${_storage.serverUrl}/api';
          final token = _token ?? await _storage.readToken();
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (e, handler) {
          if (e.response?.statusCode == 401 &&
              !e.requestOptions.path.startsWith('/auth/')) {
            onUnauthorized?.call();
          }
          handler.next(e);
        },
      ),
    );
  }

  final StorageService _storage;
  final Dio _dio;
  String? _token;
  void Function()? onUnauthorized;

  String get serverUrl => _storage.serverUrl;
  set token(String? t) => _token = t;

  /// Reference photos may be relative (local dev) or absolute (Cloudinary).
  String? assetUrl(String? url) {
    if (url == null || url.isEmpty) return null;
    return url.startsWith('/') ? '${_storage.serverUrl}$url' : url;
  }

  Exception _wrap(Object e) {
    if (e is VerificationRequired) return e;
    if (e is FaceMatchesDriver) return e;
    if (e is DioException) {
      final data = e.response?.data;
      final details = data is Map ? data['details'] : null;
      if (e.response?.statusCode == 403 &&
          details is Map &&
          details['code'] == 'EMAIL_NOT_VERIFIED') {
        return VerificationRequired(
          (details['email'] ?? '') as String,
          (details['retryAfterS'] as num?)?.toInt() ?? 60,
        );
      }
      if (e.response?.statusCode == 409 &&
          details is Map &&
          details['code'] == 'FACE_MATCHES_DRIVER') {
        return FaceMatchesDriver(
          (data as Map)['error'] as String? ??
              'This face is already registered',
          [
            for (final m in (details['matches'] as List? ?? const []))
              (
                name: (m as Map)['name'] as String,
                confidence: (m['confidence'] as num?)?.toDouble() ?? 0,
              ),
          ],
        );
      }
      if (e.response == null) {
        return const ApiException(
          'Cannot reach the Guardian Drive server',
          offline: true,
        );
      }
      final msg = data is Map && data['error'] is String
          ? data['error'] as String
          : 'Request failed';
      return ApiException(msg, status: e.response?.statusCode);
    }
    return ApiException(e.toString());
  }

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } catch (e) {
      throw _wrap(e);
    }
  }

  /// Fetch + snapshot; fall back to the snapshot when offline.
  Future<({T data, DateTime? cachedAt})> _cached<T>(
    String key,
    Future<Object?> Function() fetch,
    T Function(Object? raw) parse,
  ) async {
    try {
      final raw = await _call(fetch);
      await _storage.saveSnapshot(key, raw ?? const {});
      return (data: parse(raw), cachedAt: null);
    } on ApiException catch (e) {
      final snap = e.offline ? _storage.readSnapshot(key) : null;
      if (snap == null) rethrow;
      return (data: parse(snap.data), cachedAt: snap.savedAt);
    }
  }

  // ---- auth ----
  Future<({String token, AppUser user})> login(String email, String password) =>
      _call(() async {
        final r = await _dio.post<Map<String, dynamic>>(
          '/auth/login',
          data: {'email': email, 'password': password},
        );
        return (
          token: r.data!['token'] as String,
          user: AppUser.fromJson(r.data!['user'] as Map<String, dynamic>),
        );
      });

  Future<({String token, AppUser user})> register(
    String name,
    String email,
    String password,
  ) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {'name': name, 'email': email, 'password': password},
    );
    if (r.data!['verificationRequired'] == true) {
      throw VerificationRequired(
        r.data!['email'] as String,
        (r.data!['retryAfterS'] as num?)?.toInt() ?? 60,
      );
    }
    return (
      token: r.data!['token'] as String,
      user: AppUser.fromJson(r.data!['user'] as Map<String, dynamic>),
    );
  });

  Future<({String token, AppUser user})> verifyEmail(
    String email,
    String code,
  ) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/auth/verify-email',
      data: {'email': email, 'code': code},
    );
    return (
      token: r.data!['token'] as String,
      user: AppUser.fromJson(r.data!['user'] as Map<String, dynamic>),
    );
  });

  /// Returns seconds until the next resend is allowed.
  Future<int> resendCode(String email) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/auth/resend-code',
      data: {'email': email},
    );
    return (r.data!['retryAfterS'] as num?)?.toInt() ?? 60;
  });

  /// Google sign-in is available when the server has a client id (GET /auth/config).
  Future<bool> googleSignInEnabled() => _call(() async {
    final r = await _dio.get<Map<String, dynamic>>('/auth/config');
    return r.data?['googleClientId'] is String;
  });

  /// The browser hand-off: null until the user finished "Continue with Google" in the browser.
  Future<({String token, AppUser user})?> pollHandoff(String id) =>
      _call(() async {
        final r = await _dio.get<Map<String, dynamic>>('/auth/handoff/$id');
        final d = r.data!;
        if (d['token'] is! String) return null;
        return (
          token: d['token'] as String,
          user: AppUser.fromJson(d['user'] as Map<String, dynamic>),
        );
      });

  /// E-mails a password reset code; returns seconds until another may be requested.
  Future<int> forgotPassword(String email) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/auth/forgot-password',
      data: {'email': email},
    );
    return (r.data!['retryAfterS'] as num?)?.toInt() ?? 60;
  });

  Future<({String token, AppUser user})> resetPassword(
    String email,
    String code,
    String password,
  ) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/auth/reset-password',
      data: {'email': email, 'code': code, 'password': password},
    );
    return (
      token: r.data!['token'] as String,
      user: AppUser.fromJson(r.data!['user'] as Map<String, dynamic>),
    );
  });

  /// Server version and code commit (Settings → About updates itself on every deploy).
  Future<({String version, String? commit})> health() => _call(() async {
    final r = await _dio.get<Map<String, dynamic>>('/health');
    return (
      version: (r.data?['version'] as String?) ?? '',
      commit: r.data?['commit'] as String?,
    );
  });

  Future<void> sendFeedback({
    required String category,
    required String message,
    required List<({String name, String data})> attachments,
    required String appVersion,
  }) => _call(() async {
    await _dio.post<Map<String, dynamic>>(
      '/feedback',
      data: {
        'category': category,
        'message': message,
        'attachments': [
          for (final a in attachments) {'name': a.name, 'data': a.data},
        ],
        'platform': 'android',
        'appVersion': appVersion,
      },
      options: Options(sendTimeout: const Duration(seconds: 120)),
    );
  });

  Future<List<FeedbackItem>> myFeedback() => _call(() async {
    final r = await _dio.get<Map<String, dynamic>>('/feedback/mine');
    return [
      for (final f in (r.data?['feedback'] as List? ?? const []))
        FeedbackItem.fromJson(f as Map<String, dynamic>),
    ];
  });

  Future<bool> pushEnabled() => _call(() async {
    final r = await _dio.get<Map<String, dynamic>>('/push/config');
    return r.data?['enabled'] == true;
  });

  Future<void> saveFcmToken(String token) =>
      _call(() => _dio.put<void>('/auth/fcm-token', data: {'fcmToken': token}));

  // ---- drivers ----
  Future<({List<Driver> data, DateTime? cachedAt})> drivers() => _cached(
    'drivers',
    () async =>
        (await _dio.get<Map<String, dynamic>>('/drivers')).data!['drivers'],
    (raw) => (raw as List)
        .map((e) => Driver.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  Future<Driver> driver(String id) => _call(() async {
    final r = await _dio.get<Map<String, dynamic>>('/drivers/$id');
    return Driver.fromJson(r.data!['driver'] as Map<String, dynamic>);
  });

  /// photos: base64 JPEGs (front, left, right). The backend computes the face embedding.
  Future<({String driverId, double quality, List<String> similarTo})>
  createDriver({
    required String name,
    required String relationship,
    required List<String> photos,
    bool confirmLookalike = false,
  }) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/drivers',
      data: {
        'name': name,
        'relationship': relationship,
        'photos': photos,
        if (confirmLookalike) 'confirmLookalike': true,
      },
    );
    return (
      driverId: r.data!['driverId'] as String,
      quality: (r.data!['quality'] as num).toDouble(),
      // Lookalike drivers already registered (e.g. twins).
      similarTo: [
        for (final s in (r.data!['similarFaces'] as List? ?? const []))
          (s as Map)['name'] as String,
      ],
    );
  });

  /// One face, and (side photos) the same person as [front]; front photos also report
  /// registered drivers with the same face.
  Future<PhotoCheck> checkPhoto(String photo, {String? front}) =>
      _call(() async {
        final r = await _dio.post<Map<String, dynamic>>(
          '/drivers/check-photo',
          data: {'photo': photo, 'front': ?front},
        );
        final d = r.data!;
        return (
          ok: d['ok'] == true,
          message: d['message'] as String?,
          matches: [
            for (final m in (d['matches'] as List? ?? const []))
              (m as Map)['name'] as String,
          ],
        );
      });

  Future<Driver> updateThresholds(String id, Map<String, dynamic> patch) =>
      _call(() async {
        final r = await _dio.patch<Map<String, dynamic>>(
          '/drivers/$id/thresholds',
          data: patch,
        );
        return Driver.fromJson(r.data!['driver'] as Map<String, dynamic>);
      });

  Future<void> deleteDriver(String id) =>
      _call(() => _dio.delete<void>('/drivers/$id'));

  Future<List<SensorPoint>> logs(String id, {int limit = 120}) =>
      _call(() async {
        final r = await _dio.get<Map<String, dynamic>>(
          '/drivers/$id/logs',
          queryParameters: {'limit': limit},
        );
        return (r.data!['logs'] as List)
            .map((e) => SensorPoint.fromJson(e as Map<String, dynamic>))
            .toList();
      });

  Future<({bool match, double confidence})> verify(String id, String photo) =>
      _call(() async {
        final r = await _dio.post<Map<String, dynamic>>(
          '/drivers/$id/verify',
          data: {'photo': photo},
        );
        return (
          match: r.data!['match'] == true,
          confidence: (r.data!['confidence'] as num).toDouble(),
        );
      });

  // ---- alerts ----
  Future<
    ({
      ({List<DriverAlert> alerts, int unacknowledged}) data,
      DateTime? cachedAt,
    })
  >
  alerts(AlertFilters f) => _cached(
    'alerts_${f.driverId ?? '*'}_${f.type?.wire ?? '*'}_${f.acknowledged ?? '*'}',
    () async => (await _dio.get<Map<String, dynamic>>(
      '/alerts',
      queryParameters: f.toQuery(),
    )).data,
    (raw) {
      final m = raw as Map<String, dynamic>;
      return (
        alerts: (m['alerts'] as List)
            .map((e) => DriverAlert.fromJson(e as Map<String, dynamic>))
            .toList(),
        unacknowledged: (m['unacknowledged'] as num?)?.toInt() ?? 0,
      );
    },
  );

  Future<({DriverAlert alert, bool alreadyAcknowledged})> acknowledge(
    String id, {
    bool? falseAlarm,
  }) => _call(() async {
    final r = await _dio.patch<Map<String, dynamic>>(
      '/alerts/$id/ack',
      data: {'acknowledgedBy': 'apk', 'falseAlarm': ?falseAlarm},
    );
    return (
      alert: DriverAlert.fromJson(r.data!['alert'] as Map<String, dynamic>),
      alreadyAcknowledged: r.data!['alreadyAcknowledged'] == true,
    );
  });

  /// Label an alert as a false alarm (true) or real (false) — training data for the verifier.
  Future<DriverAlert> feedback(String id, bool falseAlarm) => _call(() async {
    final r = await _dio.patch<Map<String, dynamic>>(
      '/alerts/$id/feedback',
      data: {'falseAlarm': falseAlarm, 'by': 'apk'},
    );
    return DriverAlert.fromJson(r.data!['alert'] as Map<String, dynamic>);
  });
}
