import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../services/api_service.dart';
import '../services/photo_quality.dart';
import '../state/data_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/glass_card.dart';
import '../widgets/mesh_background.dart';

/// Same normalisation as the backend: case-, spacing- and width-insensitive.
String driverNameKey(String name) =>
    name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();

/// Mirrors the backend rules; null = valid. Twins must have distinct names.
String? validateDriverName(String name, Iterable<String> existing) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return 'Enter the driver’s name';
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  if (!RegExp(r'\p{L}', unicode: true).hasMatch(trimmed)) {
    return 'Name must contain letters';
  }
  final key = driverNameKey(trimmed);
  for (final other in existing) {
    if (driverNameKey(other) == key) {
      return '“$other” is already registered. Twins need distinct names '
          '(add a middle name or nickname).';
    }
  }
  return null;
}

class _Shot {
  const _Shot(this.bytes, this.quality);
  final Uint8List bytes;
  final PhotoQuality quality;
}

/// Name, relationship, 3-photo face enrollment (front/left/right).
/// Photos go to POST /api/drivers as base64 — the backend computes embeddings.
class RegisterDriverScreen extends StatefulWidget {
  const RegisterDriverScreen({super.key});

  static const angles = ['front', 'left', 'right'];
  static const relationships = [
    'son',
    'daughter',
    'spouse',
    'parent',
    'sibling',
    'employee',
    'other',
  ];

  @override
  State<RegisterDriverScreen> createState() => _RegisterDriverScreenState();
}

class _RegisterDriverScreenState extends State<RegisterDriverScreen> {
  final _name = TextEditingController();
  final _picker = ImagePicker();
  final Map<String, _Shot> _shots = {};
  String _relationship = 'son';
  String? _nameError;
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pick(String angle, ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      preferredCameraDevice: CameraDevice.front,
      maxWidth: 720,
      maxHeight: 720,
      imageQuality: 88,
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final quality = await PhotoQuality.analyze(bytes);
    if (!mounted) return;
    setState(() => _shots[angle] = _Shot(bytes, quality));
  }

  void _chooseSource(String angle) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.ink900,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheet) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: Text('Take $angle photo'),
              onTap: () {
                Navigator.pop(sheet);
                _pick(angle, ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Choose from gallery'),
              onTap: () {
                Navigator.pop(sheet);
                _pick(angle, ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final nameError = validateDriverName(
      _name.text,
      context.read<DataController>().drivers.map((d) => d.name),
    );
    if (nameError != null) {
      setState(() => _nameError = nameError);
      return;
    }
    final photos = [
      for (final a in RegisterDriverScreen.angles)
        if (_shots[a] != null)
          'data:image/jpeg;base64,${base64Encode(_shots[a]!.bytes)}',
    ];
    setState(() {
      _nameError = null;
      _error = null;
      _saving = true;
    });
    final data = context.read<DataController>();
    try {
      final r = await data.api.createDriver(
        name: _name.text.trim(),
        relationship: _relationship,
        photos: photos,
      );
      await data.refresh();
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            '${_name.text.trim()} registered · face quality ${(r.quality * 100).round()}%',
          ),
        ),
      );
      for (final twin in r.similarTo) {
        messenger.showSnackBar(
          SnackBar(
            duration: const Duration(seconds: 8),
            backgroundColor: AppColors.warn.withValues(alpha: 0.9),
            content: Text(
              'Looks very similar to $twin. If they are twins, face '
              'verification may not tell them apart.',
            ),
          ),
        );
      }
      context.pushReplacement('/drivers/${r.driverId}');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register driver')),
      extendBodyBehindAppBar: true,
      body: MeshBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 64, 16, 32),
            children: [
              const Text(
                'Three photos (front, left, right) let the server build an accurate face profile. '
                'Photos are processed on our server only.',
                style: TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 16),
              GlassCard(
                interactive: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      key: const ValueKey('driver-name'),
                      controller: _name,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Driver name',
                        prefixIcon: const Icon(Icons.person_rounded),
                        errorText: _nameError,
                        errorMaxLines: 3,
                        helperText: 'Unique per driver — for twins add a middle name or nickname.',
                        helperMaxLines: 2,
                      ),
                      onChanged: (_) {
                        if (_nameError != null) {
                          setState(() => _nameError = null);
                        }
                      },
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: _relationship,
                      dropdownColor: AppColors.ink800,
                      decoration: const InputDecoration(
                        labelText: 'Relationship',
                      ),
                      items: [
                        for (final r in RegisterDriverScreen.relationships)
                          DropdownMenuItem(
                            value: r,
                            child: Text(
                              '${r[0].toUpperCase()}${r.substring(1)}',
                            ),
                          ),
                      ],
                      onChanged: (v) =>
                          setState(() => _relationship = v ?? _relationship),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  for (final (i, angle)
                      in RegisterDriverScreen.angles.indexed) ...[
                    if (i > 0) const SizedBox(width: 10),
                    Expanded(
                      child: _PhotoSlot(
                        angle: angle,
                        step: i + 1,
                        shot: _shots[angle],
                        onTap: () => _chooseSource(angle),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 16),
              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: AppColors.danger.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFFECACA)),
                  ),
                ),
              DepthButton(
                label: _saving
                    ? 'Enrolling face…'
                    : 'Register with ${_shots.length}/3 photos',
                expand: true,
                loading: _saving,
                onPressed: _shots.isEmpty ? null : _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoSlot extends StatelessWidget {
  const _PhotoSlot({
    required this.angle,
    required this.step,
    required this.shot,
    required this.onTap,
  });

  final String angle;
  final int step;
  final _Shot? shot;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final q = shot?.quality;
    return GlassCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AspectRatio(
            aspectRatio: 3 / 4,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (shot != null)
                  Image.memory(shot!.bytes, fit: BoxFit.cover)
                else
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.add_a_photo_rounded,
                        color: AppColors.muted,
                        size: 28,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Step $step',
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                Positioned(
                  left: 6,
                  top: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      angle.toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              q == null
                  ? 'Tap to add'
                  : (q.ok
                        ? 'Good light & focus'
                        : q.issues
                              .map((i) => PhotoQuality.issueText[i])
                              .join(' · ')),
              maxLines: 2,
              style: TextStyle(
                fontSize: 11,
                color: q == null
                    ? AppColors.muted
                    : (q.ok
                          ? const Color(0xFF6EE7B7)
                          : const Color(0xFFFCD34D)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
