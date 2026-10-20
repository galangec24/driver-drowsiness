/// App rating and surveys (parity with web/src/api/ratings.ts and surveys.ts).
class Review {
  const Review({
    required this.stars,
    required this.comment,
    required this.author,
    required this.updatedAt,
  });

  factory Review.fromJson(Map<String, dynamic> j) => Review(
    stars: (j['stars'] as num).toInt(),
    comment: (j['comment'] ?? '') as String,
    author: (j['author'] ?? 'A user') as String,
    updatedAt:
        DateTime.tryParse((j['updatedAt'] ?? '') as String)?.toLocal() ??
        DateTime.now(),
  );

  final int stars;
  final String comment;
  final String author;
  final DateTime updatedAt;
}

class RatingSummary {
  const RatingSummary({
    required this.count,
    required this.average,
    required this.distribution,
    required this.recent,
  });

  factory RatingSummary.fromJson(Map<String, dynamic> j) {
    final dist = (j['distribution'] as Map?) ?? const {};
    return RatingSummary(
      count: (j['count'] as num?)?.toInt() ?? 0,
      average: (j['average'] as num?)?.toDouble(),
      distribution: {
        for (var n = 1; n <= 5; n++) n: (dist['$n'] as num?)?.toInt() ?? 0,
      },
      recent: ((j['recent'] as List?) ?? const [])
          .map((e) => Review.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  final int count;
  final double? average;
  final Map<int, int> distribution;
  final List<Review> recent;
}

class MyRating {
  const MyRating(this.stars, this.comment);
  final int stars;
  final String comment;
}

enum QuestionType { single, multiple, rating, yesno, text }

class SurveyQuestion {
  const SurveyQuestion({
    required this.qid,
    required this.text,
    required this.type,
    required this.options,
    required this.required,
  });

  factory SurveyQuestion.fromJson(Map<String, dynamic> j) => SurveyQuestion(
    qid: j['qid'] as String,
    text: j['text'] as String,
    type: QuestionType.values.firstWhere(
      (t) => t.name == j['type'],
      orElse: () => QuestionType.text,
    ),
    options: ((j['options'] as List?) ?? const []).cast<String>(),
    required: j['required'] == true,
  );

  final String qid;
  final String text;
  final QuestionType type;
  final List<String> options;
  final bool required;
}

class Survey {
  const Survey({
    required this.id,
    required this.title,
    required this.description,
    required this.questions,
    required this.answered,
  });

  factory Survey.fromJson(Map<String, dynamic> j) => Survey(
    id: j['id'] as String,
    title: j['title'] as String,
    description: (j['description'] ?? '') as String,
    questions: ((j['questions'] as List?) ?? const [])
        .map((e) => SurveyQuestion.fromJson(e as Map<String, dynamic>))
        .toList(),
    answered: j['answered'] == true,
  );

  final String id;
  final String title;
  final String description;
  final List<SurveyQuestion> questions;
  final bool answered;
}

/// A parent's message / reminder to the car.
class DriverMessage {
  const DriverMessage({
    required this.id,
    required this.text,
    required this.status,
    required this.createdAt,
  });

  factory DriverMessage.fromJson(Map<String, dynamic> j) => DriverMessage(
    id: j['id'] as String,
    text: j['text'] as String,
    status: (j['status'] ?? 'pending') as String,
    createdAt:
        DateTime.tryParse((j['createdAt'] ?? '') as String)?.toLocal() ??
        DateTime.now(),
  );

  final String id;
  final String text;
  final String status; // pending | delivered | expired
  final DateTime createdAt;
}

const quickReminders = [
  'Please take a break at the next safe stop.',
  'Drink some water and stay alert.',
  'Please slow down and drive safely.',
  'Call me when you arrive.',
  'Drive safely. We love you.',
];
