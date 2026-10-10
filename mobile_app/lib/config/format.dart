String pct(double? v) => v == null ? '—' : '${(v * 100).round()}%';

String fixed(double? v, [int digits = 2]) =>
    v == null ? '—' : v.toStringAsFixed(digits);

String capitalize(String s) =>
    s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

String timeAgo(DateTime? t, [DateTime? now]) {
  if (t == null) return 'never';
  final s = (now ?? DateTime.now()).difference(t).inSeconds;
  if (s < 5) return 'just now';
  if (s < 60) return '${s}s ago';
  final m = (s / 60).round();
  if (m < 60) return '${m}m ago';
  final h = (m / 60).round();
  if (h < 24) return '${h}h ago';
  return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

String clock(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}:${t.second.toString().padLeft(2, '0')}';
