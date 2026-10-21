import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/format.dart';
import '../config/theme.dart';
import '../models/engagement.dart';
import '../models/user.dart';
import '../state/auth_controller.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import 'depth_button.dart';
import 'glass_card.dart';

/// Send a message or quick reminder; the in-car voice assistant reads it to the driver.
class MessagePanel extends StatefulWidget {
  const MessagePanel({
    super.key,
    required this.driverId,
    required this.driverName,
  });

  final String driverId;
  final String driverName;

  @override
  State<MessagePanel> createState() => _MessagePanelState();
}

class _MessagePanelState extends State<MessagePanel> {
  final _text = TextEditingController();
  List<DriverMessage> _history = [];
  bool _sending = false;
  int _seenVersion = -1;
  int _lang = 0; // ready-made reminders shown
  String? _msgLang; // language of written messages (null = preferred one)

  ApiService get _api => context.read<DataController>().api;
  String get _first => widget.driverName.split(' ').first;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final h = await _api.messages(widget.driverId);
      if (mounted) setState(() => _history = h);
    } on ApiException catch (_) {
      // offline: no history
    }
  }

  Future<void> _send(String text, {bool reminder = false}) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final pref = context.read<AuthController>().user?.language ?? 'auto';
      final online = await _api.sendMessage(
        widget.driverId,
        text,
        reminder: reminder,
        lang: reminder ? _reminderCodes[_lang] : (_msgLang ?? pref),
      );
      _text.clear();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            online
                ? "Sent: the voice assistant reads it in $_first's car now."
                : 'Saved: it will be read when the car is back online.',
          ),
        ),
      );
      await _load();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  // language codes of reminderLanguages (English, Tagalog, Bisaya, Chinese)
  static const _reminderCodes = ['en', 'fil', 'ceb', 'zh'];

  static const _status = {
    'delivered': ('Read aloud in the car', Color(0xFF6EE7B7)),
    'pending': ('Waiting for the car to be online', Color(0xFFFDE68A)),
    'expired': ('Not delivered (the car was offline)', AppColors.muted),
  };

  @override
  Widget build(BuildContext context) {
    // a message was delivered (socket) -> refresh the history
    final version = context.select<DataController, int>((d) => d.alertsVersion);
    if (version != _seenVersion) {
      final first = _seenVersion == -1;
      _seenVersion = version;
      if (!first) WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }
    return GlassCard(
      key: const ValueKey('message-panel'),
      interactive: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Message $_first',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'The in-car voice assistant reads it aloud, so $_first never '
            'has to look at a phone while driving.',
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            children: [
              for (var i = 0; i < reminderLanguages.length; i++)
                ChoiceChip(
                  key: ValueKey('lang-$i'),
                  label: Text(
                    reminderLanguages[i].$1,
                    style: const TextStyle(fontSize: 12),
                  ),
                  selected: _lang == i,
                  onSelected: (_) => setState(() => _lang = i),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final r in reminderLanguages[_lang].$2)
                ActionChip(
                  label: Text(r, style: const TextStyle(fontSize: 12)),
                  onPressed: _sending ? null : () => _send(r, reminder: true),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('message-text'),
                  controller: _text,
                  maxLength: 200,
                  decoration: InputDecoration(
                    hintText: 'Write a short message to $_first',
                    counterText: '',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              DepthButton(
                key: const ValueKey('send-message'),
                label: 'Send',
                compact: true,
                loading: _sending,
                onPressed: () {
                  final t = _text.text.trim();
                  if (t.isNotEmpty) _send(t);
                },
              ),
            ],
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: const ValueKey('message-language'),
            initialValue:
                _msgLang ??
                context.select<AuthController, String>(
                  (a) => a.user?.language ?? 'auto',
                ),
            dropdownColor: AppColors.ink800,
            decoration: const InputDecoration(
              labelText: 'Language of your message',
              isDense: true,
            ),
            items: [
              for (final l in appLanguages)
                DropdownMenuItem(value: l.$1, child: Text(l.$2)),
            ],
            onChanged: (v) => setState(() => _msgLang = v),
          ),
          const SizedBox(height: 4),
          const Text(
            'Write in any language: English, Tagalog, Bisaya, Taglish, Chinese '
            'and more. The car reads it in that language when it has the voice, '
            'and always shows it on its screen.',
            style: TextStyle(color: AppColors.muted, fontSize: 11),
          ),
          for (final m in _history.take(5))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m.text, style: const TextStyle(color: Colors.white)),
                  Text(
                    '${timeAgo(m.createdAt)} · ${_status[m.status]?.$1 ?? m.status}',
                    style: TextStyle(
                      color: _status[m.status]?.$2 ?? AppColors.muted,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
