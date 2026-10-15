import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config/format.dart';
import '../config/links.dart';
import '../config/theme.dart';
import '../models/geo_location.dart';
import 'depth_button.dart';

/// 3D map of the driver's position (the website's /embed/map page in a WebView: buildings,
/// tilt, heading) + heading/speed + "Directions" / "Open in Google Maps" (opens the Maps app).
/// Parity with web LocationMap.
class LocationMap extends StatefulWidget {
  const LocationMap({
    super.key,
    required this.location,
    this.live = true,
    this.height = 220,
    this.label,
  });

  final GeoLocation? location;

  /// Driver name shown on the map marker.
  final String? label;

  /// Live = re-centres as the car moves; otherwise a fixed point (where an alert happened).
  final bool live;
  final double height;

  // Re-centring reloads the embedded map, so only do it after the car moved this far.
  static const recenterMetres = 75.0;

  @override
  State<LocationMap> createState() => _LocationMapState();
}

class _LocationMapState extends State<LocationMap> {
  WebViewController? _web;
  GeoLocation? _shown;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(LocationMap old) {
    super.didUpdateWidget(old);
    _sync();
  }

  void _sync() {
    final loc = widget.location;
    if (loc == null) return;
    final prev = _shown;
    if (prev != null && prev.distanceTo(loc) < LocationMap.recenterMetres) {
      return;
    }
    _shown = loc;
    // No WebView implementation (widget tests): show the info + links only.
    if (WebViewPlatform.instance == null) return;
    _web ??= WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.ink900)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          // Taps inside the embed ("View larger map") open the real Maps app.
          onNavigationRequest: (req) {
            if (req.url.startsWith('$webAppUrl/embed/map') ||
                (req.url.startsWith('https://maps.google.com/maps?q=') &&
                    req.url.contains('output=embed'))) {
              return NavigationDecision.navigate;
            }
            if (req.isMainFrame) {
              launchUrl(
                Uri.parse(req.url),
                mode: LaunchMode.externalApplication,
              );
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      );
    _loading = true;
    _web!.loadRequest(
      loc.map3dUri(webAppUrl, name: widget.label, live: widget.live),
    );
  }

  Future<void> _open(Uri uri) async {
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open Google Maps')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final loc = widget.location;
    if (loc == null) {
      return Container(
        key: const ValueKey('location-empty'),
        padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.25),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Column(
          children: [
            Icon(Icons.location_off_rounded, color: AppColors.muted, size: 28),
            SizedBox(height: 8),
            Text('No location yet.', style: TextStyle(color: AppColors.muted)),
            SizedBox(height: 4),
            Text(
              'The in-car device sends GPS with each reading.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ],
        ),
      );
    }

    final stale =
        widget.live &&
        loc.at != null &&
        DateTime.now().difference(loc.at!) > const Duration(minutes: 1);
    final details = <String>[
      if (loc.compass != null) 'Heading ${loc.compass}',
      if (loc.speed != null) '${loc.speed!.round()} km/h',
      if (loc.accuracy != null) '±${loc.accuracy!.round()} m',
      if (loc.at != null)
        '${widget.live ? 'Updated' : 'Recorded'} ${timeAgo(loc.at)}',
    ];

    return Column(
      key: const ValueKey('location-map'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: widget.height,
            child: Stack(
              children: [
                Positioned.fill(
                  child: _web != null
                      ? WebViewWidget(
                          controller: _web!,
                          // Let the map pan/zoom inside scrolling pages.
                          gestureRecognizers: {
                            Factory<OneSequenceGestureRecognizer>(
                              EagerGestureRecognizer.new,
                            ),
                          },
                        )
                      : const ColoredBox(
                          color: AppColors.ink800,
                          child: Center(
                            child: Icon(
                              Icons.map_rounded,
                              color: AppColors.muted,
                              size: 40,
                            ),
                          ),
                        ),
                ),
                if (_web != null && _loading)
                  const Positioned.fill(
                    child: ColoredBox(
                      color: Color(0x66000000),
                      child: Center(
                        child: CircularProgressIndicator(color: AppColors.glow),
                      ),
                    ),
                  ),
                if (widget.live && !stale)
                  Positioned(
                    left: 10,
                    top: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.7),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.circle, size: 8, color: AppColors.ok),
                          SizedBox(width: 6),
                          Text(
                            'Live',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            const Icon(Icons.place_rounded, size: 15, color: AppColors.glow),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                loc.coords,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (loc.heading != null)
              Transform.rotate(
                angle: loc.heading! * 3.1415926535 / 180,
                child: const Icon(
                  Icons.navigation_rounded,
                  size: 16,
                  color: AppColors.glow,
                ),
              ),
          ],
        ),
        if (details.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              details.join(' · '),
              style: TextStyle(
                color: stale ? AppColors.warn : AppColors.muted,
                fontSize: 12,
              ),
            ),
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: DepthButton(
                key: const ValueKey('directions'),
                label: 'Directions',
                icon: Icons.directions_rounded,
                compact: true,
                onPressed: () => _open(loc.directionsUri),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DepthButton(
                key: const ValueKey('open-maps'),
                label: 'Google Maps',
                icon: Icons.map_rounded,
                compact: true,
                variant: DepthVariant.secondary,
                onPressed: () => _open(loc.mapsUri),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
