import 'geo_location.dart';

double _d(Object? v, [double fallback = 0]) =>
    v is num ? v.toDouble() : fallback;
DateTime? _date(Object? v) =>
    v is String ? DateTime.tryParse(v)?.toLocal() : null;

/// Per-driver adaptive thresholds (never hardcoded in app logic).
class Thresholds {
  const Thresholds({
    required this.earThreshold,
    required this.perclosThreshold,
    required this.drowsyDurationMs,
    required this.fusionWeightVision,
    required this.fusionWeightPhysio,
    this.yawnThreshold = 3,
    this.fusionWeightYawn = 0.2,
    this.hrDropThreshold = 0.15,
    this.breathDropThreshold = 0.2,
    this.nodThreshold = 2,
    this.fusionWeightNod = 0.3,
  });

  factory Thresholds.fromJson(Map<String, dynamic> j) => Thresholds(
    earThreshold: _d(j['earThreshold']),
    perclosThreshold: _d(j['perclosThreshold']),
    drowsyDurationMs: _d(j['drowsyDurationMs']),
    fusionWeightVision: _d(j['fusionWeightVision']),
    fusionWeightPhysio: _d(j['fusionWeightPhysio']),
    yawnThreshold: _d(j['yawnThreshold'], 3),
    fusionWeightYawn: _d(j['fusionWeightYawn'], 0.2),
    hrDropThreshold: _d(j['hrDropThreshold'], 0.15),
    breathDropThreshold: _d(j['breathDropThreshold'], 0.2),
    nodThreshold: _d(j['nodThreshold'], 2),
    fusionWeightNod: _d(j['fusionWeightNod'], 0.3),
  );

  final double earThreshold;
  final double perclosThreshold;
  final double drowsyDurationMs;
  final double fusionWeightVision;
  final double fusionWeightPhysio;
  final double yawnThreshold;
  final double fusionWeightYawn;
  final double hrDropThreshold;
  final double breathDropThreshold;
  final double nodThreshold;
  final double fusionWeightNod;

  Map<String, dynamic> toJson() => {
    'earThreshold': earThreshold,
    'perclosThreshold': perclosThreshold,
    'drowsyDurationMs': drowsyDurationMs.round(),
    'fusionWeightVision': fusionWeightVision,
    'fusionWeightPhysio': fusionWeightPhysio,
    'yawnThreshold': yawnThreshold.round(),
    'fusionWeightYawn': fusionWeightYawn,
    'hrDropThreshold': hrDropThreshold,
    'breathDropThreshold': breathDropThreshold,
    'nodThreshold': nodThreshold.round(),
    'fusionWeightNod': fusionWeightNod,
  };

  /// Only the fields that differ from [other] (for PATCH).
  Map<String, dynamic> diff(Thresholds other) {
    final a = toJson();
    final b = other.toJson();
    return {
      for (final k in a.keys)
        if (a[k] != b[k]) k: a[k],
    };
  }

  Thresholds copyWith({
    double? earThreshold,
    double? perclosThreshold,
    double? drowsyDurationMs,
    double? fusionWeightVision,
    double? fusionWeightPhysio,
    double? yawnThreshold,
    double? fusionWeightYawn,
    double? hrDropThreshold,
    double? breathDropThreshold,
    double? nodThreshold,
    double? fusionWeightNod,
  }) => Thresholds(
    earThreshold: earThreshold ?? this.earThreshold,
    perclosThreshold: perclosThreshold ?? this.perclosThreshold,
    drowsyDurationMs: drowsyDurationMs ?? this.drowsyDurationMs,
    fusionWeightVision: fusionWeightVision ?? this.fusionWeightVision,
    fusionWeightPhysio: fusionWeightPhysio ?? this.fusionWeightPhysio,
    yawnThreshold: yawnThreshold ?? this.yawnThreshold,
    fusionWeightYawn: fusionWeightYawn ?? this.fusionWeightYawn,
    hrDropThreshold: hrDropThreshold ?? this.hrDropThreshold,
    breathDropThreshold: breathDropThreshold ?? this.breathDropThreshold,
    nodThreshold: nodThreshold ?? this.nodThreshold,
    fusionWeightNod: fusionWeightNod ?? this.fusionWeightNod,
  );
}

/// 'alert' | 'warning' | 'drowsy' | 'offline'
enum DriverStatus {
  alert('Alert'),
  warning('Warning'),
  drowsy('Drowsy'),
  offline('Offline');

  const DriverStatus(this.label);
  final String label;

  static DriverStatus parse(Object? v) => DriverStatus.values.firstWhere(
    (s) => s.name == v,
    orElse: () => DriverStatus.offline,
  );
}

class Driver {
  const Driver({
    required this.id,
    required this.name,
    required this.relationship,
    required this.referencePhotoUrl,
    required this.thresholds,
    required this.faceEnrolled,
    required this.photoCount,
    required this.status,
    this.lastUpdate,
    this.lastTunedAt,
    this.lastLocation,
  });

  factory Driver.fromJson(Map<String, dynamic> j) {
    final enrollment = j['enrollment'] is Map
        ? j['enrollment'] as Map
        : const {};
    return Driver(
      id: j['id'] as String,
      name: (j['name'] ?? '') as String,
      relationship: (j['relationship'] ?? '') as String,
      referencePhotoUrl: (j['referencePhotoUrl'] ?? '') as String,
      thresholds: Thresholds.fromJson(
        (j['personalThresholds'] ?? const {}) as Map<String, dynamic>,
      ),
      faceEnrolled: j['faceEnrolled'] == true,
      photoCount: (enrollment['photoCount'] as num?)?.toInt() ?? 0,
      status: DriverStatus.parse(j['status']),
      lastUpdate: _date(j['lastUpdate']),
      lastTunedAt: _date(j['lastTunedAt']),
      lastLocation: GeoLocation.fromJson(j['lastLocation']),
    );
  }

  final String id;
  final String name;
  final String relationship;
  final String referencePhotoUrl;
  final Thresholds thresholds;
  final bool faceEnrolled;
  final int photoCount;
  final DriverStatus status;
  final DateTime? lastUpdate;
  final DateTime? lastTunedAt;
  final GeoLocation? lastLocation;

  Driver copyWith({
    DriverStatus? status,
    DateTime? lastUpdate,
    Thresholds? thresholds,
    GeoLocation? lastLocation,
  }) => Driver(
    id: id,
    name: name,
    relationship: relationship,
    referencePhotoUrl: referencePhotoUrl,
    thresholds: thresholds ?? this.thresholds,
    faceEnrolled: faceEnrolled,
    photoCount: photoCount,
    status: status ?? this.status,
    lastUpdate: lastUpdate ?? this.lastUpdate,
    lastTunedAt: lastTunedAt,
    lastLocation: lastLocation ?? this.lastLocation,
  );
}

/// Socket.io `driver:status` payload.
class DriverLive {
  const DriverLive({
    required this.driverId,
    required this.status,
    required this.lastUpdate,
    this.fusionScore,
    this.ear,
    this.perclos,
    this.heartRate,
    this.location,
    this.yawnCount,
    this.nodCount,
    this.watchConnected,
    this.watchBattery,
    this.breathingRate,
    this.radarConnected,
    this.radarPresent,
  });

  factory DriverLive.fromJson(Map<String, dynamic> j) {
    final s = j['signals'] is Map ? j['signals'] as Map : const {};
    return DriverLive(
      driverId: j['driverId'] as String,
      status: DriverStatus.parse(j['status']),
      lastUpdate: _date(j['lastUpdate']) ?? DateTime.now(),
      fusionScore: (j['fusionScore'] as num?)?.toDouble(),
      ear: (s['ear'] as num?)?.toDouble(),
      perclos: (s['perclos'] as num?)?.toDouble(),
      heartRate: (s['heartRate'] as num?)?.toDouble(),
      location: GeoLocation.fromJson(j['location']),
      yawnCount: (s['yawnCount'] as num?)?.toInt(),
      nodCount: (s['nodCount'] as num?)?.toInt(),
      watchConnected: j['wearable'] is Map
          ? (j['wearable'] as Map)['connected'] == true
          : null,
      breathingRate: (s['breathingRate'] as num?)?.toDouble(),
      radarConnected: j['radar'] is Map
          ? (j['radar'] as Map)['connected'] == true
          : null,
      radarPresent: j['radar'] is Map
          ? (j['radar'] as Map)['present'] as bool?
          : null,
      watchBattery: j['wearable'] is Map
          ? ((j['wearable'] as Map)['battery'] as num?)?.toInt()
          : null,
    );
  }

  final String driverId;
  final DriverStatus status;
  final DateTime lastUpdate;
  final double? fusionScore;
  final double? ear;
  final double? perclos;
  final double? heartRate;
  final GeoLocation? location;

  /// Yawns in the last 5 minutes (camera).
  final int? yawnCount;

  /// Head nods in the last 5 minutes (camera).
  final int? nodCount;

  /// BLE watch link (null = this car has no wearable configured).
  final bool? watchConnected;
  final int? watchBattery;

  /// Dashboard radar: breaths per minute and link state (null = no radar configured).
  final double? breathingRate;
  final bool? radarConnected;
  final bool? radarPresent;
}

/// One SensorLog row for charts.
class SensorPoint {
  const SensorPoint({
    required this.at,
    required this.fusionScore,
    this.ear,
    this.perclos,
    this.heartRate,
  });

  factory SensorPoint.fromJson(Map<String, dynamic> j) {
    final s = j['signals'] is Map ? j['signals'] as Map : const {};
    return SensorPoint(
      at: _date(j['createdAt']) ?? DateTime.now(),
      fusionScore: _d(j['fusionScore']),
      ear: (s['ear'] as num?)?.toDouble(),
      perclos: (s['perclos'] as num?)?.toDouble(),
      heartRate: (s['heartRate'] as num?)?.toDouble(),
    );
  }

  factory SensorPoint.fromLive(DriverLive l) => SensorPoint(
    at: l.lastUpdate,
    fusionScore: l.fusionScore ?? 0,
    ear: l.ear,
    perclos: l.perclos,
    heartRate: l.heartRate,
  );

  final DateTime at;
  final double fusionScore;
  final double? ear;
  final double? perclos;
  final double? heartRate;
}
