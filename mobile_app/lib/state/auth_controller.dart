import 'package:flutter/foundation.dart';

import '../models/user.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

class AuthController extends ChangeNotifier {
  AuthController(this._api, this._storage) {
    _api.onUnauthorized = logout;
  }

  final ApiService _api;
  final StorageService _storage;

  String? _token;
  AppUser? _user;
  bool _restored = false;
  // First name to thank after signing out on purpose ('' if unknown); null otherwise.
  String? _farewell;

  String? get token => _token;
  AppUser? get user => _user;
  bool get isLoggedIn => _token != null;
  bool get restored => _restored;
  String? get farewellName => _farewell;

  void clearFarewell() {
    _farewell = null;
    notifyListeners();
  }

  Future<bool> googleSignInEnabled() => _api.googleSignInEnabled();

  /// Google sign-in finished in the browser? Then sign in here (true).
  Future<bool> collectHandoff(String id) async {
    final r = await _api.pollHandoff(id);
    if (r == null) return false;
    _farewell = null;
    await _setSession(r.token, r.user);
    return true;
  }

  String get serverUrl => _storage.serverUrl;

  Future<void> restore() async {
    _token = await _storage.readToken();
    _user = _storage.user;
    _api.token = _token;
    _restored = true;
    notifyListeners();
  }

  Future<void> setServerUrl(String url) async {
    await _storage.setServerUrl(url);
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final r = await _api.login(email.trim(), password);
    await _setSession(r.token, r.user);
  }

  Future<void> register(String name, String email, String password) async {
    final r = await _api.register(name.trim(), email.trim(), password);
    await _setSession(r.token, r.user);
  }

  /// After VerificationRequired: the e-mailed 6-digit code signs the user in.
  Future<void> verifyEmail(String email, String code) async {
    final r = await _api.verifyEmail(email.trim(), code);
    await _setSession(r.token, r.user);
  }

  Future<int> resendCode(String email) => _api.resendCode(email.trim());

  Future<int> forgotPassword(String email) => _api.forgotPassword(email.trim());

  /// The e-mailed reset code + a new password signs the user in.
  Future<void> resetPassword(String email, String code, String password) async {
    final r = await _api.resetPassword(email.trim(), code, password);
    await _setSession(r.token, r.user);
  }

  Future<void> _setSession(String token, AppUser user) async {
    await _storage.writeToken(token);
    await _storage.setUser(user);
    _token = token;
    _user = user;
    _api.token = token;
    notifyListeners();
  }

  /// [farewell]: signed out on purpose, so the login screen says thanks (not after an expired session).
  Future<void> logout({bool farewell = false}) async {
    if (farewell) {
      _farewell = (_user?.name ?? '').trim().split(RegExp(r'\s+')).first;
    }
    await _storage.clearToken();
    await _storage.setUser(null);
    await _storage.clearSnapshots();
    _token = null;
    _user = null;
    _api.token = null;
    notifyListeners();
  }
}

/// Login form validation (shared by the screen and tests).
Map<String, String> validateAuthForm({
  required bool register,
  required String name,
  required String email,
  required String password,
}) {
  final errors = <String, String>{};
  if (register && name.trim().isEmpty) errors['name'] = 'Enter your name';
  if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email.trim())) {
    errors['email'] = 'Enter a valid email';
  }
  if (register ? password.length < 8 : password.isEmpty) {
    errors['password'] = register
        ? 'Use at least 8 characters'
        : 'Enter your password';
  }
  return errors;
}
