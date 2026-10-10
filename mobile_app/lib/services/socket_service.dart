import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/alert.dart';
import '../models/driver.dart';

/// One Socket.io connection per logged-in parent. JWT in the handshake;
/// exponential backoff reconnect capped at 30 s (parity with web).
class SocketService {
  io.Socket? _socket;

  void Function(bool connected)? onConnection;
  void Function(DriverAlert alert)? onAlert;
  void Function(String alertId, String acknowledgedBy, bool? falseAlarm)?
  onAcknowledged;
  void Function(String alertId, bool falseAlarm)? onFeedback;
  void Function(String alertId, String? snapshotUrl)? onAlertUpdated;
  void Function(DriverLive status)? onStatus;

  bool get connected => _socket?.connected ?? false;

  void connect(String serverUrl, String token) {
    disconnect();
    final socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(30000)
          .setRandomizationFactor(0.5)
          .disableAutoConnect()
          .build(),
    );

    socket
      ..onConnect((_) => onConnection?.call(true))
      ..onDisconnect((_) => onConnection?.call(false))
      ..onConnectError((_) => onConnection?.call(false))
      ..on('alert:new', (data) {
        if (data is Map) {
          onAlert?.call(DriverAlert.fromJson(Map<String, dynamic>.from(data)));
        }
      })
      ..on('alert:acknowledged', (data) {
        if (data is Map) {
          onAcknowledged?.call(
            data['alertId'] as String,
            (data['acknowledgedBy'] ?? 'unknown') as String,
            data['falseAlarm'] as bool?,
          );
        }
      })
      ..on('alert:feedback', (data) {
        if (data is Map) {
          onFeedback?.call(
            data['alertId'] as String,
            data['falseAlarm'] == true,
          );
        }
      })
      ..on('alert:updated', (data) {
        if (data is Map) {
          onAlertUpdated?.call(
            data['alertId'] as String,
            data['snapshotUrl'] as String?,
          );
        }
      })
      ..on('driver:status', (data) {
        if (data is Map) {
          onStatus?.call(DriverLive.fromJson(Map<String, dynamic>.from(data)));
        }
      })
      ..connect();
    _socket = socket;
  }

  void subscribeDriver(String driverId) =>
      _socket?.emit('subscribe:driver', {'driverId': driverId});

  void disconnect() {
    _socket
      ?..clearListeners()
      ..dispose();
    _socket = null;
  }
}
