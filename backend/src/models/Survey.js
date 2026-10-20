const mongoose = require('mongoose');

const QUESTION_TYPES = ['single', 'multiple', 'rating', 'yesno', 'text'];
const STATUSES = ['draft', 'open', 'closed'];

const questionSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true },
    text: { type: String, required: true, maxlength: 500 },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    // single / multiple: the choices. yesno: ["Yes", "No"]. rating: 1-5 stars. text: none.
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

/** A survey made by an admin (in the app, or imported from a Word / PDF / Excel file). */
const surveySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 2000, default: '' },
    questions: { type: [questionSchema], default: [] },
    status: { type: String, enum: STATUSES, default: 'draft' },
    // Who sees it: every signed-in user, or parents only (admins excluded).
    audience: { type: String, enum: ['everyone', 'parents'], default: 'everyone' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { fileName: String, format: String },
    publishedAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);
surveySchema.index({ status: 1, publishedAt: -1 });

surveySchema.methods.toPublic = function toPublic(extra = {}) {
  return {
    id: this._id.toString(),
    title: this.title,
    description: this.description,
    questions: this.questions.map((q) => ({
      qid: q.qid,
      text: q.text,
      type: q.type,
      options: q.options,
      required: q.required,
    })),
    status: this.status,
    audience: this.audience,
    source: this.source && this.source.fileName ? this.source : null,
    publishedAt: this.publishedAt || null,
    closedAt: this.closedAt || null,
    createdAt: this.createdAt,
    ...extra,
  };
};

const answerSchema = new mongoose.Schema(
  { qid: { type: String, required: true }, value: mongoose.Schema.Types.Mixed },
  { _id: false },
);

/** One response per user per survey. */
const responseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: { type: [answerSchema], default: [] },
    platform: { type: String, enum: ['web', 'android', 'windows', 'unknown'], default: 'unknown' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
responseSchema.index({ surveyId: 1, userId: 1 }, { unique: true });

const Survey = mongoose.model('Survey', surveySchema);
const SurveyResponse = mongoose.model('SurveyResponse', responseSchema);

module.exports = { Survey, SurveyResponse, QUESTION_TYPES };
