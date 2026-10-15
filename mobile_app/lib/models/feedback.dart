/// Feedback the user sent (Settings → Feedback) and the team's reply.
class FeedbackItem {
  const FeedbackItem({
    required this.id,
    required this.category,
    required this.message,
    required this.status,
    required this.createdAt,
    this.attachments = 0,
    this.adminReply,
  });

  factory FeedbackItem.fromJson(Map<String, dynamic> j) => FeedbackItem(
    id: j['id'] as String,
    category: (j['category'] as String?) ?? 'other',
    message: (j['message'] as String?) ?? '',
    status: (j['status'] as String?) ?? 'new',
    createdAt:
        DateTime.tryParse((j['createdAt'] ?? '') as String)?.toLocal() ??
        DateTime.now(),
    attachments: (j['attachments'] as List?)?.length ?? 0,
    adminReply: j['adminReply'] as String?,
  );

  final String id;
  final String category;
  final String message;

  /// new | in_progress | resolved
  final String status;
  final DateTime createdAt;
  final int attachments;
  final String? adminReply;

  static const categoryLabel = {
    'bug': 'Something is wrong',
    'idea': 'Idea',
    'question': 'Question',
    'other': 'Other',
  };
  static const statusLabel = {
    'new': 'Received',
    'in_progress': 'In progress',
    'resolved': 'Resolved',
  };
}
