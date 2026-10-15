const mongoose = require('mongoose');

const CATEGORIES = ['bug', 'idea', 'question', 'other'];
const STATUSES = ['new', 'in_progress', 'resolved'];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false },
);

/** Feedback a user sends from the app (with screenshots / files); admins read and answer it. */
const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: String,
    userEmail: String,
    category: { type: String, enum: CATEGORIES, default: 'other' },
    message: { type: String, required: true, maxlength: 4000 },
    attachments: { type: [attachmentSchema], default: [] },
    // Where it was sent from (helps reproduce a bug).
    context: {
      page: String,
      platform: {
        type: String,
        enum: ['web', 'android', 'windows', 'unknown'],
        default: 'unknown',
      },
      appVersion: String,
      userAgent: String,
    },
    status: { type: String, enum: STATUSES, default: 'new' },
    adminReply: String,
    repliedAt: Date,
    repliedBy: String,
  },
  { timestamps: true },
);

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ userId: 1, createdAt: -1 });

feedbackSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    userId: this.userId.toString(),
    userName: this.userName || null,
    userEmail: this.userEmail || null,
    category: this.category,
    message: this.message,
    attachments: this.attachments.map((a) => ({
      url: a.url,
      name: a.name,
      mime: a.mime,
      size: a.size,
    })),
    context: this.context || {},
    status: this.status,
    adminReply: this.adminReply || null,
    repliedAt: this.repliedAt || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Feedback', feedbackSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
