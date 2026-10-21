/// Reading history (GET /drivers/:id/history): one row per minute of readings, newest first.
class HistoryRow {
  const HistoryRow({
    required this.at,
    required this.readings,
    required this.classification,
    this.ear,
    this.perclos,
    this.heartRate,
    this.lat,
    this.lng,
    this.speed,
    required this.km,
    required this.totalKm,
  });

  final DateTime at;
  final int readings;
  final String classification;
  final double? ear;
  final double? perclos;
  final double? heartRate;
  final double? lat;
  final double? lng;
  final double? speed;

  /// Driven since the previous minute with a location, and in total for the period.
  final double km;
  final double totalKm;

  static double? _d(Object? v) => v is num ? v.toDouble() : null;

  factory HistoryRow.fromJson(Map<String, dynamic> j) {
    final loc = j['location'] as Map<String, dynamic>?;
    return HistoryRow(
      at: DateTime.parse(j['at'] as String).toLocal(),
      readings: (j['readings'] as num?)?.toInt() ?? 0,
      classification: j['classification'] as String? ?? 'alert',
      ear: _d(j['ear']),
      perclos: _d(j['perclos']),
      heartRate: _d(j['heartRate']),
      lat: _d(loc?['lat']),
      lng: _d(loc?['lng']),
      speed: _d(loc?['speed']),
      km: _d(j['km']) ?? 0,
      totalKm: _d(j['totalKm']) ?? 0,
    );
  }
}

class DriverHistory {
  const DriverHistory({
    required this.totalKm,
    required this.rows,
    this.lastAt,
    this.lastClassification,
  });

  final double totalKm;
  final List<HistoryRow> rows;
  final DateTime? lastAt;
  final String? lastClassification;

  factory DriverHistory.fromJson(Map<String, dynamic> j) {
    final last = j['lastReading'] as Map<String, dynamic>?;
    return DriverHistory(
      totalKm: (j['totalKm'] as num?)?.toDouble() ?? 0,
      rows: [
        for (final r in (j['rows'] as List? ?? const []))
          HistoryRow.fromJson(r as Map<String, dynamic>),
      ],
      lastAt: last == null
          ? null
          : DateTime.parse(last['at'] as String).toLocal(),
      lastClassification: last?['classification'] as String?,
    );
  }
}

String km(double? v) => v == null
    ? '—'
    : v < 10
    ? '${v.toStringAsFixed(2)} km'
    : '${v.toStringAsFixed(1)} km';
