import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/alert.dart';
import '../models/driver.dart';
import '../models/geo_location.dart';
import '../services/api_service.dart';
import '../services/notification_service.dart';
import '../services/socket_service.dart';
import '../services/storage_service.dart';

/// Server state + realtime sync (parity with the web's React Query + socket layer).
class DataController extends ChangeNotifier {
  DataController(this.api, this._socket, this._notifications, this._storage) {
    _socket
      ..onConnection = _onConnection
      ..onAlert = _onAlert
      ..onAcknowledged = _onAcknowledged
      ..onFeedback = _onFeedback
      ..onAlertUpdated = _onAlertUpdated
      ..onStatus = _onStatus;
  }

  final ApiService api;
  final SocketService _socket;
  final NotificationService _notifications;
  final StorageService _storage;

  List<Driver> drivers = [];
  List<DriverAlert> alerts = [];
  int unacknowledged = 0;
  final Map<String, DriverLive> live = {};
  final Set<String> pulsing = {};
  bool connected = false;
  bool loading = false;
  String? error;
  DateTime? cachedAt;

  /// Fires for each new alert so the UI can animate/toast it.
  final _alertStream = StreamController<DriverAlert>.broadcast();
  Stream<DriverAlert> get newAlerts => _alertStream.stream;

  Timer? _poll;
  Timer? _tick;
  bool _started = false;

  void start(String token) {
    if (_started) return;
    _started = true;
    _socket.connect(api.serverUrl, token);
    unawaited(refresh());
    _syncPolling();
    // Re-evaluate "offline after 30 s" and relative times.
    _tick = Timer.periodic(
      const Duration(seconds: 5),
      (_) => notifyListeners(),
    );
  }

  void stop() {
    _started = false;
    _socket.disconnect();
    _poll?.cancel();
    _poll = null;
    _tick?.cancel();
    _tick = null;
    drivers = [];
    alerts = [];
    live.clear();
    unacknowledged = 0;
    connected = false;
    notifyListeners();
  }

  Future<void> refresh() async {
    loading = drivers.isEmpty && alerts.isEmpty;
    error = null;
    notifyListeners();
    try {
      final d = await api.drivers();
      final a = await api.alerts(const AlertFilters(limit: 50));
      drivers = d.data;
      alerts = a.data.alerts;
      unacknowledged = a.data.unacknowledged;
      cachedAt = d.cachedAt ?? a.cachedAt;
    } on ApiException catch (e) {
      error = e.message;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Polling fallback every 10 s only while the socket is down.
  void _syncPolling() {
    if (connected) {
      _poll?.cancel();
      _poll = null;
    } else {
      _poll ??= Timer.periodic(const Duration(seconds: 10), (_) => refresh());
    }
  }

  void _onConnection(bool value) {
    final reconnected = value && !connected;
    connected = value;
    _syncPolling();
    if (reconnected) unawaited(refresh());
    notifyListeners();
  }

  void _onAlert(DriverAlert alert) {
    if (alerts.any((a) => a.id == alert.id)) return;
    alerts = [alert, ...alerts].take(50).toList();
    if (!alert.acknowledged) unacknowledged += 1;
    pulsing.add(alert.driverId);
    Timer(const Duration(seconds: 6), () {
      pulsing.remove(alert.driverId);
      notifyListeners();
    });
    _alertStream.add(alert);
    if (_storage.notificationsEnabled) {
      unawaited(_notifications.showAlert(alert));
    }
    notifyListeners();
  }

  void _onAcknowledged(String alertId, String by, [bool? falseAlarm]) {
    final i = alerts.indexWhere((a) => a.id == alertId);
    if (i >= 0) {
      if (alerts[i].acknowledged) return;
      alerts = List.of(alerts)
        ..[i] = alerts[i].acknowledge(by, falseAlarm: falseAlarm);
    }
    // The server only broadcasts the first acknowledge, so the alert was open until now.
    if (unacknowledged > 0) unacknowledged -= 1;
    notifyListeners();
  }

  void _onStatus(DriverLive s) {
    live[s.driverId] = s;
    drivers = [
      for (final d in drivers)
        d.id == s.driverId
            ? d.copyWith(
                status: s.status,
                lastUpdate: s.lastUpdate,
                lastLocation: s.location,
              )
            : d,
    ];
    notifyListeners();
  }

  void subscribeDriver(String id) => _socket.subscribeDriver(id);

  /// The in-car device attached the driver's camera frame to an alert.
  void _onAlertUpdated(String alertId, String? snapshotUrl) {
    final i = alerts.indexWhere((a) => a.id == alertId);
    if (i < 0 || snapshotUrl == null) return;
    alerts = List.of(alerts)
      ..[i] = alerts[i].copyWith(snapshotUrl: snapshotUrl);
    notifyListeners();
  }

  /// Latest known position: live socket fix, else the one stored on the driver.
  GeoLocation? locationOf(Driver d) => live[d.id]?.location ?? d.lastLocation;

  void _onFeedback(String alertId, bool falseAlarm) {
    final i = alerts.indexWhere((a) => a.id == alertId);
    if (i < 0) return;
    alerts = List.of(alerts)..[i] = alerts[i].withFeedback(falseAlarm);
    notifyListeners();
  }

  /// Label an already-acknowledged alert (training data for the false-positive model).
  Future<DriverAlert> reportFeedback(String id, bool falseAlarm) async {
    final updated = await api.feedback(id, falseAlarm);
    _onFeedback(id, falseAlarm);
    return updated;
  }

  /// First acknowledge wins server-side; returns true if this device won.
  /// [falseAlarm] acknowledges and labels the alert in one step.
  Future<bool> acknowledge(String id, {bool? falseAlarm}) async {
    final r = await api.acknowledge(id, falseAlarm: falseAlarm);
    _onAcknowledged(id, r.alert.acknowledgedBy ?? 'apk', r.alert.falseAlarm);
    return !r.alreadyAcknowledged;
  }

  void replaceDriver(Driver d) {
    drivers = [for (final x in drivers) x.id == d.id ? d : x];
    notifyListeners();
  }

  void removeDriver(String id) {
    drivers = drivers.where((d) => d.id != id).toList();
    notifyListeners();
  }

  /// A driver with no data in 30 s is offline.
  DriverStatus statusOf(Driver d) {
    final l = live[d.id];
    final last = l?.lastUpdate ?? d.lastUpdate;
    if (last == null ||
        DateTime.now().difference(last) > const Duration(seconds: 30)) {
      return DriverStatus.offline;
    }
    return l?.status ?? d.status;
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tick?.cancel();
    _socket.disconnect();
    _alertStream.close();
    super.dispose();
  }
}
