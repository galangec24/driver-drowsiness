import 'dart:math' as math;

/// GPS fix from the in-car device. heading = degrees clockwise from north, speed = km/h.
class GeoLocation {
  const GeoLocation({
    required this.lat,
    required this.lng,
    this.heading,
    this.speed,
    this.accuracy,
    this.at,
  });

  static GeoLocation? fromJson(Object? j) {
    if (j is! Map) return null;
    final lat = j['lat'];
    final lng = j['lng'];
    if (lat is! num || lng is! num) return null;
    final at = j['at'];
    return GeoLocation(
      lat: lat.toDouble(),
      lng: lng.toDouble(),
      heading: (j['heading'] as num?)?.toDouble(),
      speed: (j['speed'] as num?)?.toDouble(),
      accuracy: (j['accuracy'] as num?)?.toDouble(),
      at: at is String ? DateTime.tryParse(at)?.toLocal() : null,
    );
  }

  final double lat;
  final double lng;
  final double? heading;
  final double? speed;
  final double? accuracy;
  final DateTime? at;

  String get _point => '${lat.toStringAsFixed(6)},${lng.toStringAsFixed(6)}';

  /// Google's keyless embeddable map (same as the web app).
  Uri embedUri({int zoom = 16}) =>
      Uri.parse('https://maps.google.com/maps?q=$_point&z=$zoom&output=embed');

  /// Opens the Google Maps app (or browser) at this point.
  Uri get mapsUri =>
      Uri.parse('https://www.google.com/maps/search/?api=1&query=$_point');

  /// Turn-by-turn from the parent's current position to the driver.
  Uri get directionsUri => Uri.parse(
    'https://www.google.com/maps/dir/?api=1&destination=$_point&travelmode=driving',
  );

  String get coords {
    final ns = lat >= 0 ? 'N' : 'S';
    final ew = lng >= 0 ? 'E' : 'W';
    return '${lat.abs().toStringAsFixed(5)}° $ns, ${lng.abs().toStringAsFixed(5)}° $ew';
  }

  static const _compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  /// 0–360° course → "NE" etc.
  String? get compass {
    final h = heading;
    if (h == null || !h.isFinite) return null;
    return _compass[(((h % 360) + 360) % 360 / 45).round() % 8];
  }

  /// Great-circle distance in metres.
  double distanceTo(GeoLocation o) {
    const rad = math.pi / 180;
    final dLat = (o.lat - lat) * rad;
    final dLng = (o.lng - lng) * rad;
    final h =
        math.pow(math.sin(dLat / 2), 2) +
        math.cos(lat * rad) *
            math.cos(o.lat * rad) *
            math.pow(math.sin(dLng / 2), 2);
    return 2 * 6371000 * math.asin(math.min(1, math.sqrt(h)));
  }
}
