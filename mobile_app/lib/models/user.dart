class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone = '',
    this.language = 'auto',
    this.avatarUrl,
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
    id: j['id'] as String,
    name: (j['name'] ?? '') as String,
    email: (j['email'] ?? '') as String,
    role: (j['role'] ?? 'parent') as String,
    phone: (j['phone'] ?? '') as String,
    language: (j['language'] ?? 'auto') as String,
    avatarUrl: j['avatarUrl'] as String?,
  );

  final String id;
  final String name;
  final String email;
  final String role;
  final String phone;

  /// Preferred language for messages to the car ('auto' = the car detects it).
  final String language;

  /// Relative to the server (/api/auth/avatar/...), or null without a photo.
  final String? avatarUrl;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'email': email,
    'role': role,
    'phone': phone,
    'language': language,
    'avatarUrl': avatarUrl,
  };
}

/// Same codes as the website and the in-car voice.
const appLanguages = <(String, String)>[
  ('auto', 'Auto-detect'),
  ('en', 'English'),
  ('fil', 'Filipino (Tagalog)'),
  ('ceb', 'Bisaya (Cebuano)'),
  ('es', 'Español (Spanish)'),
  ('zh', '中文 (Chinese)'),
  ('ja', '日本語 (Japanese)'),
  ('ko', '한국어 (Korean)'),
];
