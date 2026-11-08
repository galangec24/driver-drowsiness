import 'geo_location.dart';

enum AlertType {
  drowsy('Drowsy'),
  microsleep('Microsleep'),
  distraction('Distraction'),
  faceMatch('Unrecognized driver'),
  warning('Fatigue warning'),
  yawning('Frequent yawning'),
  nodding('Head nodding');

  const AlertType(this.label);
  final String label;

  String get wire => this == AlertType.faceMatch ? 'face_match' : name;
  bool get severe =>
      this == AlertType.drowsy ||
      this == AlertType.microsleep ||
      this == AlertType.nodding;

  static AlertType parse(Object? v) => AlertType.values.firstWhere(
    (t) => t.wire == v,
    orElse: () => AlertType.warning,
  );
}

class DriverAlert {
  const DriverAlert({
    required this.id,
    required this.driverId,
    required this.type,
    required this.confidence,
    required this.acknowledged,
    required this.createdAt,
    this.ear,
    this.perclos,
    this.heartRate,
    this.acknowledgedBy,
    this.acknowledgedAt,
    this.driverName,
    this.falseAlarm,
    this.location,
    this.snapshotUrl,
    this.yawnCount,
    this.delayedS,
    this.expired = false,
    this.read = false,
    this.fatigueReason,
    this.repeatCount = 1,
    this.lastDetectedAt,
    this.trip,
  });

  factory DriverAlert.fromJson(Map<String, dynamic> j) {
    final s = j['sensorSnapshot'] is Map
        ? j['sensorSnapshot'] as Map
        : const {};
    return DriverAlert(
      id: j['id'] as String,
      driverId: j['driverId'] as String,
      type: AlertType.parse(j['type']),
      confidence: (j['confidence'] as num?)?.toDouble() ?? 0,
      acknowledged: j['acknowledged'] == true,
      createdAt:
          DateTime.tryParse((j['createdAt'] ?? '') as String)?.toLocal() ??
          DateTime.now(),
      ear: (s['ear'] as num?)?.toDouble(),
      perclos: (s['perclos'] as num?)?.toDouble(),
      heartRate: (s['heartRate'] as num?)?.toDouble(),
      acknowledgedBy: j['acknowledgedBy'] as String?,
      acknowledgedAt: DateTime.tryParse((j['acknowledgedAt'] ?? '') as String)
          ?.toLocal(),
      driverName: j['driverName'] as String?,
      falseAlarm: j['falseAlarm'] as bool?,
      location: GeoLocation.fromJson(j['location']),
      snapshotUrl: j['snapshotUrl'] as String?,
      yawnCount: (s['yawnCount'] as num?)?.toInt(),
      delayedS: (j['delayedS'] as num?)?.toInt(),
      expired: j['expired'] == true,
      read: j['read'] == true,
      fatigueReason: s['fatigueReason'] as String?,
      repeatCount: (j['repeatCount'] as num?)?.toInt() ?? 1,
      lastDetectedAt: DateTime.tryParse((j['lastDetectedAt'] ?? '') as String)
          ?.toLocal(),
      trip: AlertTrip.fromJson(j['trip']),
    );
  }

  final String id;
  final String driverId;
  final AlertType type;
  final double confidence;
  final bool acknowledged;
  final DateTime createdAt;
  final double? ear;
  final double? perclos;
  final double? heartRate;
  final String? acknowledgedBy;
  final DateTime? acknowledgedAt;
  final String? driverName;

  /// Parent feedback: true = false alarm, false = real, null = not labelled.
  final bool? falseAlarm;

  /// Where the car was when the alert fired.
  final GeoLocation? location;

  /// Camera frame of the driver at the trigger moment (relative or absolute URL).
  final String? snapshotUrl;

  /// Recorded while the car had no internet and delivered this many seconds later.
  final int? delayedS;

  /// Yawns in the 10 minutes before the alert.
  final int? yawnCount;

  /// Not acknowledged on the day it happened: can no longer be acknowledged, only removed.
  final bool expired;

  /// Notification read by the parent (separate from acknowledging).
  final bool read;

  /// Why the camera judged fatigue, e.g. "Fatigue signs: repeated yawning (3+ in 10 min)".
  final String? fatigueReason;

  /// Detections grouped into this alert ("detected again"), and the latest one.
  final int repeatCount;
  final DateTime? lastDetectedAt;

  /// First alert of a drive: how far / how long since the driver was first detected.
  final AlertTrip? trip;

  /// Still waiting for an acknowledgement today.
  bool get open => !acknowledged && !expired;

  DriverAlert copyWith({
    bool? acknowledged,
    String? acknowledgedBy,
    DateTime? acknowledgedAt,
    bool? falseAlarm,
    String? snapshotUrl,
    bool? read,
  }) => DriverAlert(
    id: id,
    driverId: driverId,
    type: type,
    confidence: confidence,
    acknowledged: acknowledged ?? this.acknowledged,
    createdAt: createdAt,
    ear: ear,
    perclos: perclos,
    heartRate: heartRate,
    acknowledgedBy: acknowledgedBy ?? this.acknowledgedBy,
    acknowledgedAt: acknowledgedAt ?? this.acknowledgedAt,
    driverName: driverName,
    falseAlarm: falseAlarm ?? this.falseAlarm,
    location: location,
    snapshotUrl: snapshotUrl ?? this.snapshotUrl,
    yawnCount: yawnCount,
    delayedS: delayedS,
    expired: expired,
    read: read ?? this.read,
    fatigueReason: fatigueReason,
    repeatCount: repeatCount,
    lastDetectedAt: lastDetectedAt,
    trip: trip,
  );

  DriverAlert acknowledge(String by, {bool? falseAlarm}) => copyWith(
    read: true,
    acknowledged: true,
    acknowledgedBy: by,
    acknowledgedAt: DateTime.now(),
    falseAlarm: falseAlarm,
  );

  DriverAlert withFeedback(bool value) => copyWith(falseAlarm: value);
}

/// open = to acknowledge today · acknowledged · expired = never acknowledged on its day.
enum AlertStatus { open, acknowledged, expired }

AlertStatus statusOf(DriverAlert a) => a.acknowledged
    ? AlertStatus.acknowledged
    : a.expired
    ? AlertStatus.expired
    : AlertStatus.open;

class AlertFilters {
  const AlertFilters({
    this.driverId,
    this.type,
    this.acknowledged,
    this.status,
    this.read,
    this.limit = 50,
  });

  final String? driverId;
  final AlertType? type;
  final bool? acknowledged;
  final AlertStatus? status;

  /// Notifications: false = unread, true = read.
  final bool? read;
  final int limit;

  String get cacheKey =>
      'alerts_${driverId ?? '*'}_${type?.wire ?? '*'}_${acknowledged ?? '*'}'
      '_${status?.name ?? '*'}_${read ?? '*'}';

  Map<String, dynamic> toQuery() => {
    'limit': limit,
    if (driverId != null) 'driverId': driverId,
    if (type != null) 'type': type!.wire,
    if (acknowledged != null) 'acknowledged': '$acknowledged',
    if (status != null) 'status': status!.name,
    if (read != null) 'read': '$read',
  };

  bool matches(DriverAlert a) =>
      (driverId == null || a.driverId == driverId) &&
      (type == null || a.type == type) &&
      (acknowledged == null || a.acknowledged == acknowledged) &&
      (status == null || statusOf(a) == status) &&
      (read == null || a.read == read);
}

/// First alert of a drive: distance and time since the driver was first detected that drive.
class AlertTrip {
  const AlertTrip({
    required this.distanceKm,
    required this.minutes,
    this.startedAt,
    this.startLat,
    this.startLng,
  });

  static AlertTrip? fromJson(Object? j) {
    if (j is! Map) return null;
    final km = (j['distanceKm'] as num?)?.toDouble();
    final min = (j['minutes'] as num?)?.toInt();
    if (km == null || min == null) return null;
    final start = j['startLocation'] is Map ? j['startLocation'] as Map : null;
    return AlertTrip(
      distanceKm: km,
      minutes: min,
      startedAt: DateTime.tryParse((j['startedAt'] ?? '') as String)?.toLocal(),
      startLat: (start?['lat'] as num?)?.toDouble(),
      startLng: (start?['lng'] as num?)?.toDouble(),
    );
  }

  final double distanceKm;
  final int minutes;
  final DateTime? startedAt;

  /// Where the drive started (the driver was first detected), if the car had GPS then.
  final double? startLat;
  final double? startLng;

  /// "12.4 km and 25 min after the drive started".
  String get text {
    final km = distanceKm < 0.1
        ? 'Less than 0.1 km'
        : '${distanceKm.toStringAsFixed(1)} km';
    final time = minutes < 1
        ? 'under a minute'
        : minutes < 60
        ? '$minutes min'
        : '${minutes ~/ 60} h ${minutes % 60} min';
    return '$km and $time after the drive started';
  }
}
