const { z } = require('zod');
const Rating = require('../models/Rating');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');

const rateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().default(''),
  platform: z.enum(['web', 'android', 'windows', 'unknown']).optional().default('unknown'),
  appVersion: z.string().max(40).optional(),
});

/** Average, count, 1-5 star distribution and the latest reviews with a comment. */
async function computeSummary(limit = 6) {
  const [stats] = await Rating.aggregate([
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        average: { $avg: '$stars' },
        s1: { $sum: { $cond: [{ $eq: ['$stars', 1] }, 1, 0] } },
        s2: { $sum: { $cond: [{ $eq: ['$stars', 2] }, 1, 0] } },
        s3: { $sum: { $cond: [{ $eq: ['$stars', 3] }, 1, 0] } },
        s4: { $sum: { $cond: [{ $eq: ['$stars', 4] }, 1, 0] } },
        s5: { $sum: { $cond: [{ $eq: ['$stars', 5] }, 1, 0] } },
      },
    },
  ]);
  const recent = await Rating.find({ comment: { $ne: '' } })
    .sort({ updatedAt: -1 })
    .limit(limit);
  const names = new Map(
    (
      await User.find({ _id: { $in: recent.map((r) => r.userId) } })
        .select('name')
        .lean()
    ).map((u) => [u._id.toString(), u.name]),
  );
  return {
    count: stats ? stats.count : 0,
    average: stats ? Math.round(stats.average * 10) / 10 : null,
    distribution: stats
      ? { 1: stats.s1, 2: stats.s2, 3: stats.s3, 4: stats.s4, 5: stats.s5 }
      : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    recent: recent.map((r) => r.toPublic(names.get(r.userId.toString()))),
  };
}

async function summary(_req, res) {
  res.json(await computeSummary());
}

async function mine(req, res) {
  const r = await Rating.findOne({ userId: req.user.parentId });
  res.json({ rating: r ? { stars: r.stars, comment: r.comment, updatedAt: r.updatedAt } : null });
}

async function rate(req, res) {
  const r = await Rating.findOneAndUpdate(
    { userId: req.user.parentId },
    { ...req.body, userId: req.user.parentId },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  const s = await computeSummary();
  alertDispatcher.emitToAll('ratings:updated', s);
  res.json({ rating: { stars: r.stars, comment: r.comment, updatedAt: r.updatedAt }, summary: s });
}

async function remove(req, res) {
  const r = await Rating.findOneAndDelete({ userId: req.user.parentId });
  if (!r) throw new HttpError(404, 'You have not rated the app');
  const s = await computeSummary();
  alertDispatcher.emitToAll('ratings:updated', s);
  res.json({ summary: s });
}

/** Admin: every rating with the full name and e-mail. */
async function adminList(_req, res) {
  const all = await Rating.find().sort({ updatedAt: -1 }).limit(1000);
  const users = new Map(
    (
      await User.find({ _id: { $in: all.map((r) => r.userId) } })
        .select('name email')
        .lean()
    ).map((u) => [u._id.toString(), u]),
  );
  res.json({
    summary: await computeSummary(),
    ratings: all.map((r) => {
      const u = users.get(r.userId.toString()) || {};
      return {
        id: r._id.toString(),
        stars: r.stars,
        comment: r.comment,
        platform: r.platform,
        appVersion: r.appVersion || null,
        userName: u.name || null,
        userEmail: u.email || null,
        updatedAt: r.updatedAt,
      };
    }),
  });
}

module.exports = { summary, mine, rate, remove, adminList, rateSchema, computeSummary };
