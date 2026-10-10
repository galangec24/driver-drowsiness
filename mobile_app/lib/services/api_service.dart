import 'package:dio/dio.dart';

import '../models/alert.dart';
import '../models/driver.dart';
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

  ApiException _wrap(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
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
    return (
      token: r.data!['token'] as String,
      user: AppUser.fromJson(r.data!['user'] as Map<String, dynamic>),
    );
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
  }) => _call(() async {
    final r = await _dio.post<Map<String, dynamic>>(
      '/drivers',
      data: {'name': name, 'relationship': relationship, 'photos': photos},
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
