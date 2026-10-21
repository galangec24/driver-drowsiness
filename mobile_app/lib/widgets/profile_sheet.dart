import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../models/user.dart';
import '../services/api_service.dart';
import '../state/auth_controller.dart';
import '../state/data_controller.dart';

/// The user's round photo, or their initials.
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, required this.user, this.size = 56});

  final AppUser? user;
  final double size;

  @override
  Widget build(BuildContext context) {
    final api = context.read<DataController>().api;
    final url = api.assetUrl(user?.avatarUrl);
    final name = (user?.name ?? '').trim();
    final initials = name.isEmpty
        ? '?'
        : name
              .split(RegExp(r'\s+'))
              .take(2)
              .map((w) => w.isEmpty ? '' : w[0].toUpperCase())
              .join();
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(colors: [AppColors.primary, AppColors.glow]),
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: url == null
          ? Text(
              initials,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: size * 0.34,
              ),
            )
          : Image.network(
              url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Text(
                initials,
                style: TextStyle(color: Colors.white, fontSize: size * 0.34),
              ),
            ),
    );
  }
}

Future<void> showProfileSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.ink900,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const ProfileSheet(),
    );

/// Edit own profile: photo, name, phone, preferred language. The e-mail is the sign-in.
class ProfileSheet extends StatefulWidget {
  const ProfileSheet({super.key});

  @override
  State<ProfileSheet> createState() => _ProfileSheetState();
}

class _ProfileSheetState extends State<ProfileSheet> {
  late final AppUser? _user = context.read<AuthController>().user;
  late final _name = TextEditingController(text: _user?.name ?? '');
  late final _phone = TextEditingController(text: _user?.phone ?? '');
  late String _language = _user?.language ?? 'auto';
  bool _busy = false;
  String? _error;

  Future<void> _save({String? avatar, bool removeAvatar = false}) async {
    final auth = context.read<AuthController>();
    final api = context.read<DataController>().api;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final u = await api.updateProfile(
        name: avatar == null && !removeAvatar ? _name.text.trim() : null,
        phone: avatar == null && !removeAvatar ? _phone.text.trim() : null,
        language: avatar == null && !removeAvatar ? _language : null,
        avatar: avatar,
        removeAvatar: removeAvatar,
      );
      await auth.updateUser(u);
      if (mounted && avatar == null && !removeAvatar) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickPhoto(ImageSource source) async {
    final file = await ImagePicker().pickImage(
      source: source,
      preferredCameraDevice: CameraDevice.front,
      maxWidth: 512,
      maxHeight: 512,
      imageQuality: 82,
    );
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    await _save(avatar: 'data:image/jpeg;base64,${base64Encode(bytes)}');
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthController>().user;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        20 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          key: const ValueKey('profile-sheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Edit profile',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                UserAvatar(user: user, size: 76),
                const SizedBox(width: 14),
                Expanded(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _pickPhoto(ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_rounded),
                        label: const Text('Choose photo'),
                      ),
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _pickPhoto(ImageSource.camera),
                        icon: const Icon(Icons.photo_camera_rounded),
                        label: const Text('Camera'),
                      ),
                      if (user?.avatarUrl != null)
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => _save(removeAvatar: true),
                          child: const Text('Remove'),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('profile-name'),
              controller: _name,
              maxLength: 80,
              decoration: const InputDecoration(
                labelText: 'Name',
                counterText: '',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('profile-phone'),
              controller: _phone,
              maxLength: 30,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Phone (optional)',
                counterText: '',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: TextEditingController(text: user?.email ?? ''),
              readOnly: true,
              decoration: const InputDecoration(
                labelText: 'E-mail (used to sign in)',
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: const ValueKey('profile-language'),
              initialValue: _language,
              dropdownColor: AppColors.ink800,
              decoration: const InputDecoration(
                labelText: 'Preferred language for messages',
              ),
              items: [
                for (final l in appLanguages)
                  DropdownMenuItem(value: l.$1, child: Text(l.$2)),
              ],
              onChanged: (v) => setState(() => _language = v ?? 'auto'),
            ),
            const SizedBox(height: 6),
            const Text(
              'Messages you send start in this language, and the car reads them '
              'aloud in it.',
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFFCA5A5)),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('profile-save'),
              onPressed: _busy || _name.text.trim().isEmpty ? null : _save,
              child: Text(_busy ? 'Saving…' : 'Save changes'),
            ),
          ],
        ),
      ),
    );
  }
}
