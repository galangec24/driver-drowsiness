const mongoose = require('mongoose');
const { z } = require('zod');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');
const { storeFeedbackFiles } = require('../services/feedbackFiles');

const createSchema = z.object({
  category: z.enum(Feedback.CATEGORIES).default('other'),
  message: z.string().trim().min(3, 'Please write a few words').max(4000),
  attachments: z
    .array(z.object({ name: z.string().max(200).default('file'), data: z.string().min(8) }))
    .max(4)
    .default([]),
  page: z.string().max(300).optional(),
  platform: z.enum(['web', 'android', 'windows', 'unknown']).default('unknown'),
  appVersion: z.string().max(40).optional(),
});

const updateSchema = z
  .object({
    status: z.enum(Feedback.STATUSES).optional(),
    reply: z.string().trim().max(4000).optional(),
  })
  .refine((v) => v.status || v.reply !== undefined, { message: 'Nothing to update' });

/** POST /api/feedback: a user sends feedback (attachments optional). */
async function create(req, res) {
  const user = await User.findById(req.user.parentId).select('name email');
  if (!user) throw new HttpError(401, 'Unauthorized');
  const id = new mongoose.Types.ObjectId();
  const attachments = await storeFeedbackFiles(id.toString(), req.body.attachments);
  const fb = await Feedback.create({
    _id: id,
    userId: user._id,
    userName: user.name,
    userEmail: user.email,
    category: req.body.category,
    message: req.body.message,
    attachments,
    context: {
      page: req.body.page,
      platform: req.body.platform,
      appVersion: req.body.appVersion,
      userAgent: String(req.get('user-agent') || '').slice(0, 300),
    },
  });
  alertDispatcher.emitToAdmins('feedback:new', fb.toPublic());
  res.status(201).json({ feedback: fb.toPublic() });
}

/** GET /api/feedback/mine: the user's own feedback with the admin's replies. */
async function mine(req, res) {
  const items = await Feedback.find({ userId: req.user.parentId })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ feedback: items.map((f) => f.toPublic()) });
}

/** GET /api/admin/feedback?status=: everything users sent, newest first. */
async function adminList(req, res) {
  const status = Feedback.STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const [items, counts] = await Promise.all([
    Feedback.find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(200),
    Feedback.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({
    feedback: items.map((f) => f.toPublic()),
    counts: Object.fromEntries(
      Feedback.STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n ?? 0]),
    ),
  });
}

/** PATCH /api/admin/feedback/:id {status?, reply?}: the user sees the reply in their app. */
async function adminUpdate(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
  const fb = await Feedback.findById(req.params.id);
  if (!fb) throw new HttpError(404, 'Feedback not found');
  if (req.body.status) fb.status = req.body.status;
  if (req.body.reply !== undefined) {
    fb.adminReply = req.body.reply || undefined;
    fb.repliedAt = req.body.reply ? new Date() : undefined;
    fb.repliedBy = req.body.reply ? req.user.parentId : undefined;
    if (req.body.reply && fb.status === 'new') fb.status = 'in_progress';
  }
  await fb.save();
  const pub = fb.toPublic();
  alertDispatcher.emitToParent(fb.userId.toString(), 'feedback:updated', pub);
  alertDispatcher.emitToAdmins('feedback:updated', pub);
  res.json({ feedback: pub });
}

module.exports = { create, mine, adminList, adminUpdate, createSchema, updateSchema };
