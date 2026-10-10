import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/user.dart';

/// JWT in secure storage; non-secret prefs + offline snapshots in shared_preferences.
class StorageService {
  StorageService(this._prefs, [FlutterSecureStorage? secure])
    : _secure = secure ?? const FlutterSecureStorage();

  static Future<StorageService> create() async =>
      StorageService(await SharedPreferences.getInstance());

  final SharedPreferences _prefs;
  final FlutterSecureStorage _secure;

  static const _tokenKey = 'gd_token';
  static const _userKey = 'gd_user';
  static const _serverKey = 'gd_server_url';
  static const _notifyKey = 'gd_notifications';
  static const _snapshotPrefix = 'gd_cache_';

  /// Public build-time default (not a secret). Override at build:
  /// flutter build apk --dart-define=API_URL=http://192.168.1.10:3000
  static const defaultServerUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  Future<String?> readToken() => _secure.read(key: _tokenKey);
  Future<void> writeToken(String token) =>
      _secure.write(key: _tokenKey, value: token);
  Future<void> clearToken() => _secure.delete(key: _tokenKey);

  AppUser? get user {
    final raw = _prefs.getString(_userKey);
    if (raw == null) return null;
    try {
      return AppUser.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<void> setUser(AppUser? u) => u == null
      ? _prefs.remove(_userKey)
      : _prefs.setString(_userKey, jsonEncode(u.toJson()));

  String get serverUrl => _prefs.getString(_serverKey) ?? defaultServerUrl;
  Future<void> setServerUrl(String url) =>
      _prefs.setString(_serverKey, url.trim().replaceAll(RegExp(r'/+$'), ''));

  bool get notificationsEnabled => _prefs.getBool(_notifyKey) ?? true;
  Future<void> setNotificationsEnabled(bool v) => _prefs.setBool(_notifyKey, v);

  Future<void> saveSnapshot(String key, Object data) => _prefs.setString(
    '$_snapshotPrefix$key',
    jsonEncode({'data': data, 'savedAt': DateTime.now().toIso8601String()}),
  );

  /// Returns (data, savedAt) or null.
  ({Object? data, DateTime savedAt})? readSnapshot(String key) {
    final raw = _prefs.getString('$_snapshotPrefix$key');
    if (raw == null) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return (data: m['data'], savedAt: DateTime.parse(m['savedAt'] as String));
    } catch (_) {
      return null;
    }
  }

  Future<void> clearSnapshots() async {
    for (final k
        in _prefs
            .getKeys()
            .where((k) => k.startsWith(_snapshotPrefix))
            .toList()) {
      await _prefs.remove(k);
    }
  }
}
