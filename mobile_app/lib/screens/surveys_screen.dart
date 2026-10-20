import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../models/engagement.dart';
import '../services/api_service.dart';
import '../state/data_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/empty_state.dart';
import '../widgets/glass_card.dart';
import '../widgets/mesh_background.dart';
import '../widgets/rate_app_card.dart';

/// Open surveys from the team; each can be answered once.
class SurveysScreen extends StatefulWidget {
  const SurveysScreen({super.key});

  @override
  State<SurveysScreen> createState() => _SurveysScreenState();
}

class _SurveysScreenState extends State<SurveysScreen> {
  List<Survey>? _surveys;
  String? _openId;
  final Map<String, Object> _answers = {};
  bool _sending = false;

  ApiService get _api => context.read<DataController>().api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await _api.openSurveys();
      if (mounted) setState(() => _surveys = s);
    } on ApiException catch (_) {
      if (mounted) setState(() => _surveys = const []);
    }
  }

  bool _missing(SurveyQuestion q) {
    final v = _answers[q.qid];
    return q.required &&
        (v == null ||
            (v is String && v.trim().isEmpty) ||
            (v is List && v.isEmpty));
  }

  Future<void> _send(Survey s) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final clean = {
        for (final e in _answers.entries)
          if (!(e.value is String && (e.value as String).trim().isEmpty) &&
              !(e.value is List && (e.value as List).isEmpty))
            e.key: e.value,
      };
      await _api.answerSurvey(s.id, clean);
      messenger.showSnackBar(
        const SnackBar(content: Text('Thank you for answering')),
      );
      setState(() {
        _openId = null;
        _answers.clear();
      });
      await _load();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _question(int i, SurveyQuestion q) {
    final label = Text(
      '${i + 1}. ${q.text}${q.required ? ' *' : ''}',
      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
    );
    final Widget input;
    switch (q.type) {
      case QuestionType.single:
      case QuestionType.yesno:
        input = RadioGroup<String>(
          groupValue: _answers[q.qid] as String?,
          onChanged: (v) => setState(() => _answers[q.qid] = v ?? ''),
          child: Column(
            children: [
              for (final o in q.options)
                RadioListTile<String>(
                  value: o,
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(o, style: const TextStyle(color: Colors.white)),
                ),
            ],
          ),
        );
      case QuestionType.multiple:
        final cur = (_answers[q.qid] as List<String>?) ?? <String>[];
        input = Column(
          children: [
            for (final o in q.options)
              CheckboxListTile(
                value: cur.contains(o),
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text(o, style: const TextStyle(color: Colors.white)),
                onChanged: (on) => setState(
                  () => _answers[q.qid] = on == true
                      ? [...cur, o]
                      : cur.where((x) => x != o).toList(),
                ),
              ),
          ],
        );
      case QuestionType.rating:
        input = StarRow(
          value: ((_answers[q.qid] as int?) ?? 0).toDouble(),
          size: 34,
          onChanged: (n) => setState(() => _answers[q.qid] = n),
        );
      case QuestionType.text:
        input = TextField(
          maxLength: 2000,
          maxLines: 3,
          onChanged: (v) => _answers[q.qid] = v,
        );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [label, const SizedBox(height: 6), input],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final list = _surveys;
    return Scaffold(
      appBar: AppBar(title: const Text('Surveys')),
      extendBodyBehindAppBar: true,
      body: MeshBackground(
        child: SafeArea(
          child: list == null
              ? const Center(child: CircularProgressIndicator())
              : list.isEmpty
              ? const EmptyState(
                  icon: Icons.poll_outlined,
                  title: 'There are no surveys right now.',
                  subtitle: 'Thank you for checking!',
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final s in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: GlassCard(
                          interactive: false,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                s.title,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                '${s.questions.length} questions',
                                style: const TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 10),
                              if (s.answered)
                                const Text(
                                  'Answered, thank you',
                                  style: TextStyle(color: Color(0xFF6EE7B7)),
                                )
                              else if (_openId != s.id)
                                DepthButton(
                                  label: 'Answer',
                                  onPressed: () => setState(() {
                                    _openId = s.id;
                                    _answers.clear();
                                  }),
                                )
                              else ...[
                                if (s.description.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 10),
                                    child: Text(
                                      s.description,
                                      style: const TextStyle(
                                        color: AppColors.muted,
                                      ),
                                    ),
                                  ),
                                for (var i = 0; i < s.questions.length; i++)
                                  _question(i, s.questions[i]),
                                DepthButton(
                                  key: const ValueKey('send-survey'),
                                  label: 'Send answers',
                                  loading: _sending,
                                  onPressed: s.questions.any(_missing)
                                      ? null
                                      : () => _send(s),
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
