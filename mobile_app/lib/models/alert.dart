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

  /// Yawns in the 5 minutes before the alert.
  final int? yawnCount;

  DriverAlert copyWith({
    bool? acknowledged,
    String? acknowledgedBy,
    DateTime? acknowledgedAt,
    bool? falseAlarm,
    String? snapshotUrl,
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
  );

  DriverAlert acknowledge(String by, {bool? falseAlarm}) => copyWith(
    acknowledged: true,
    acknowledgedBy: by,
    acknowledgedAt: DateTime.now(),
    falseAlarm: falseAlarm,
  );

  DriverAlert withFeedback(bool value) => copyWith(falseAlarm: value);
}

class AlertFilters {
  const AlertFilters({
    this.driverId,
    this.type,
    this.acknowledged,
    this.limit = 50,
  });

  final String? driverId;
  final AlertType? type;
  final bool? acknowledged;
  final int limit;

  Map<String, dynamic> toQuery() => {
    'limit': limit,
    if (driverId != null) 'driverId': driverId,
    if (type != null) 'type': type!.wire,
    if (acknowledged != null) 'acknowledged': '$acknowledged',
  };

  bool matches(DriverAlert a) =>
      (driverId == null || a.driverId == driverId) &&
      (type == null || a.type == type) &&
      (acknowledged == null || a.acknowledged == acknowledged);
}
