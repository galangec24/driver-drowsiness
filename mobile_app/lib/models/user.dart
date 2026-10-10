class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
    id: j['id'] as String,
    name: (j['name'] ?? '') as String,
    email: (j['email'] ?? '') as String,
    role: (j['role'] ?? 'parent') as String,
  );

  final String id;
  final String name;
  final String email;
  final String role;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'email': email,
    'role': role,
  };
}
