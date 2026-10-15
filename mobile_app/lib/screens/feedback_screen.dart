import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/feedback.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/glass_card.dart';
import '../widgets/mesh_background.dart';

/// Send feedback with screenshots (from the gallery or the camera) and read the team's replies.
class FeedbackScreen extends StatefulWidget {
  const FeedbackScreen({super.key});

  static const maxFiles = 4;
  static const maxBytes = 5 * 1024 * 1024;

  @override
  State<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _Picked {
  const _Picked(this.name, this.bytes);
  final String name;
  final Uint8List bytes;
}

class _FeedbackScreenState extends State<FeedbackScreen> {
  final _message = TextEditingController();
  final _picker = ImagePicker();
  final List<_Picked> _files = [];
  String _category = 'bug';
  bool _sending = false;
  String? _error;
  List<FeedbackItem> _mine = const [];

  @override
  void initState() {
    super.initState();
    _loadMine();
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _loadMine() async {
    try {
      final list = await context.read<DataController>().api.myFeedback();
      if (mounted) setState(() => _mine = list);
    } on ApiException {
      // offline: the list stays empty
    }
  }

  Future<void> _pick(ImageSource source) async {
    final List<XFile> picked;
    if (source == ImageSource.gallery) {
      picked = await _picker.pickMultiImage(imageQuality: 85, maxWidth: 1920);
    } else {
      final one = await _picker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1920,
      );
      picked = one == null ? const [] : [one];
    }
    for (final f in picked) {
      if (_files.length >= FeedbackScreen.maxFiles) {
        setState(() => _error = 'You can attach up to 4 images.');
        break;
      }
      final bytes = await f.readAsBytes();
      if (bytes.length > FeedbackScreen.maxBytes) {
        setState(() => _error = '"${f.name}" is larger than 5 MB.');
        continue;
      }
      setState(() => _files.add(_Picked(f.name, bytes)));
    }
  }

  Future<void> _send() async {
    final text = _message.text.trim();
    if (text.length < 3) {
      setState(() => _error = 'Please describe your feedback in a few words.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    final api = context.read<DataController>().api;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final version = (await PackageInfo.fromPlatform()).version;
      await api.sendFeedback(
        category: _category,
        message: text,
        attachments: [
          for (final f in _files)
            (
              name: f.name,
              data: 'data:image/jpeg;base64,${base64Encode(f.bytes)}',
            ),
        ],
        appVersion: version,
      );
      _message.clear();
      setState(_files.clear);
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Thank you! Your feedback was sent. Our reply will appear here.',
          ),
        ),
      );
      await _loadMine();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Feedback')),
      extendBodyBehindAppBar: true,
      body: MeshBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 64, 16, 32),
            children: [
              const Text(
                'Tell us what went wrong, what you would like, or ask a question. '
                'Screenshots help us understand.',
                style: TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 12),
              GlassCard(
                interactive: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final c in FeedbackItem.categoryLabel.entries)
                          ChoiceChip(
                            label: Text(c.value),
                            selected: _category == c.key,
                            onSelected: (_) =>
                                setState(() => _category = c.key),
                          ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      key: const ValueKey('feedback-message'),
                      controller: _message,
                      maxLines: 6,
                      maxLength: 4000,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Your message',
                        alignLabelWithHint: true,
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _pick(ImageSource.gallery),
                            icon: const Icon(Icons.photo_library_rounded),
                            label: const Text('Screenshot'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _pick(ImageSource.camera),
                            icon: const Icon(Icons.photo_camera_rounded),
                            label: const Text('Photo'),
                          ),
                        ),
                      ],
                    ),
                    if (_files.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final (i, f) in _files.indexed)
                            Stack(
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.memory(
                                    f.bytes,
                                    width: 72,
                                    height: 72,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                                Positioned(
                                  right: 0,
                                  top: 0,
                                  child: GestureDetector(
                                    onTap: () =>
                                        setState(() => _files.removeAt(i)),
                                    child: const CircleAvatar(
                                      radius: 11,
                                      backgroundColor: Colors.black87,
                                      child: Icon(
                                        Icons.close,
                                        size: 14,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        _error!,
                        style: const TextStyle(color: Color(0xFFFECACA)),
                      ),
                    ],
                    const SizedBox(height: 14),
                    DepthButton(
                      key: const ValueKey('send-feedback'),
                      label: 'Send feedback',
                      expand: true,
                      loading: _sending,
                      onPressed: _send,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Your feedback',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              if (_mine.isEmpty)
                const Text(
                  'Nothing sent yet. Replies from the team will appear here.',
                  style: TextStyle(color: AppColors.muted),
                ),
              for (final f in _mine)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: GlassCard(
                    interactive: false,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              FeedbackItem.categoryLabel[f.category] ??
                                  f.category,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              FeedbackItem.statusLabel[f.status] ?? f.status,
                              style: TextStyle(
                                color: f.status == 'resolved'
                                    ? AppColors.ok
                                    : AppColors.glow,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const Spacer(),
                            Text(
                              timeAgo(f.createdAt),
                              style: const TextStyle(
                                color: AppColors.muted,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          f.message,
                          style: const TextStyle(color: Colors.white70),
                        ),
                        if (f.adminReply != null) ...[
                          const SizedBox(height: 10),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              'Reply from the team: ${f.adminReply}',
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
