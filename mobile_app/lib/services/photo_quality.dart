import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

/// Client-side capture feedback (blur + lighting) only — never face recognition.
/// The backend computes the face embedding.
class PhotoQuality {
  const PhotoQuality({
    required this.brightness,
    required this.sharpness,
    required this.issues,
  });

  final double brightness;
  final double sharpness;
  final List<String> issues;

  bool get ok => issues.isEmpty;

  static const minSharpness = 40.0;
  static const minBrightness = 50.0;
  static const maxBrightness = 215.0;

  static const issueText = {
    'blurry': 'Blurry — hold still',
    'too_dark': 'Too dark — add light',
    'too_bright': 'Too bright',
    'face_too_small': 'Move closer',
    'multiple_faces': 'More than one face',
    'unreadable': 'Could not read image',
  };

  static Future<PhotoQuality> analyze(Uint8List bytes) =>
      compute(analyzeSync, bytes);

  /// Variance of the Laplacian (sharpness) + mean luma (lighting) on the centre crop.
  static PhotoQuality analyzeSync(Uint8List bytes) {
    final decoded = img.decodeImage(bytes);
    if (decoded == null) {
      return const PhotoQuality(
        brightness: 0,
        sharpness: 0,
        issues: ['unreadable'],
      );
    }
    final small = img.copyResize(decoded, width: 160);
    final w = small.width;
    final h = small.height;
    final x0 = (w * 0.2).round();
    final y0 = (h * 0.2).round();
    final cw = (w * 0.6).round();
    final ch = (h * 0.6).round();

    final gray = Float64List(cw * ch);
    var lum = 0.0;
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) {
        final p = small.getPixel(x0 + x, y0 + y);
        final g = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
        gray[y * cw + x] = g;
        lum += g;
      }
    }

    var sum = 0.0;
    var sumSq = 0.0;
    var n = 0;
    for (var y = 1; y < ch - 1; y++) {
      for (var x = 1; x < cw - 1; x++) {
        final i = y * cw + x;
        final lap =
            gray[i - 1] +
            gray[i + 1] +
            gray[i - cw] +
            gray[i + cw] -
            4 * gray[i];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    final brightness = gray.isEmpty ? 0.0 : lum / gray.length;
    final mean = n == 0 ? 0.0 : sum / n;
    final sharpness = n == 0 ? 0.0 : sumSq / n - mean * mean;
    return PhotoQuality(
      brightness: brightness,
      sharpness: sharpness,
      issues: [
        if (sharpness < minSharpness) 'blurry',
        if (brightness < minBrightness) 'too_dark',
        if (brightness > maxBrightness) 'too_bright',
      ],
    );
  }
}
