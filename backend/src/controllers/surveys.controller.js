const { z } = require('zod');
const { Survey, SurveyResponse, QUESTION_TYPES } = require('../models/Survey');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');
const { importSurvey } = require('../services/surveyImport');

const questionSchema = z
  .object({
    qid: z.string().max(20).optional(),
    text: z.string().trim().min(1).max(500),
    type: z.enum(QUESTION_TYPES),
    options: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    required: z.boolean().optional().default(false),
  })
  .refine((q) => !['single', 'multiple'].includes(q.type) || q.options.length >= 2, {
    message: 'Choice questions need at least two options',
  });

const surveySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  audience: z.enum(['everyone', 'parents']).optional().default('everyone'),
  questions: z.array(questionSchema).min(1).max(60),
  source: z.object({ fileName: z.string().max(200), format: z.string().max(10) }).optional(),
});
const updateSchema = surveySchema.partial();
const importSchema = z.object({ name: z.string().max(200), data: z.string().min(8) });
const answerSchema = z.object({
  answers: z.array(z.object({ qid: z.string().max(20), value: z.unknown() })).max(60),
  platform: z.enum(['web', 'android', 'windows', 'unknown']).optional().default('unknown'),
});

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Stable ids q1, q2... and fixed options for yes/no and rating. */
function normalizeQuestions(questions) {
  return questions.map((q, i) => ({
    qid: `q${i + 1}`,
    text: q.text,
    type: q.type,
    options:
      q.type === 'yesno' ? ['Yes', 'No'] : ['single', 'multiple'].includes(q.type) ? q.options : [],
    required: Boolean(q.required),
  }));
}

async function findSurvey(id) {
  const s = await Survey.findById(id).catch(() => null);
  if (!s) throw new HttpError(404, 'Survey not found');
  return s;
}

// ------------------------------------------------------------------------------------- admin
async function adminList(_req, res) {
  const surveys = await Survey.find().sort({ createdAt: -1 }).limit(200);
  const counts = await SurveyResponse.aggregate([{ $group: { _id: '$surveyId', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  res.json({
    surveys: surveys.map((s) => s.toPublic({ responses: byId.get(s._id.toString()) || 0 })),
  });
}

async function adminGet(req, res) {
  const s = await findSurvey(req.params.id);
  res.json({
    survey: s.toPublic({ responses: await SurveyResponse.countDocuments({ surveyId: s._id }) }),
  });
}

async function create(req, res) {
  const s = await Survey.create({
    ...req.body,
    questions: normalizeQuestions(req.body.questions),
    createdBy: req.user.parentId,
  });
  res.status(201).json({ survey: s.toPublic({ responses: 0 }) });
}

/** Read a Word / PDF / Excel file into a draft (not saved: the admin reviews it first). */
async function importFile(req, res) {
  const b64 = req.body.data.replace(/^data:[^,]*,/, '');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new HttpError(400, 'The file is empty');
  if (buffer.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'The file is larger than 5 MB');
  try {
    const draft = await importSurvey(req.body.name, buffer);
    res.json({ draft: { ...draft, source: { fileName: req.body.name, format: draft.format } } });
  } catch (err) {
    throw new HttpError(422, err.message || 'Could not read this file');
  }
}

async function update(req, res) {
  const s = await findSurvey(req.params.id);
  const responses = await SurveyResponse.countDocuments({ surveyId: s._id });
  if (req.body.questions && responses > 0) {
    throw new HttpError(
      409,
      'This survey already has responses, so its questions can no longer change',
    );
  }
  for (const k of ['title', 'description', 'audience'])
    if (req.body[k] !== undefined) s[k] = req.body[k];
  if (req.body.questions) s.questions = normalizeQuestions(req.body.questions);
  await s.save();
  res.json({ survey: s.toPublic({ responses }) });
}

async function publish(req, res) {
  const s = await findSurvey(req.params.id);
  if (!s.questions.length) throw new HttpError(400, 'Add at least one question first');
  s.status = 'open';
  s.publishedAt = s.publishedAt || new Date();
  s.closedAt = undefined;
  await s.save();
  alertDispatcher.emitToAll('survey:new', {
    id: s._id.toString(),
    title: s.title,
    audience: s.audience,
  });
  res.json({ survey: s.toPublic() });
}

async function close(req, res) {
  const s = await findSurvey(req.params.id);
  s.status = 'closed';
  s.closedAt = new Date();
  await s.save();
  res.json({ survey: s.toPublic() });
}

async function remove(req, res) {
  const s = await findSurvey(req.params.id);
  await SurveyResponse.deleteMany({ surveyId: s._id });
  await s.deleteOne();
  res.json({ ok: true });
}

/** Per-question results: counts / percentages, rating average + distribution, text answers. */
function aggregate(survey, responses) {
  const total = responses.length;
  return survey.questions.map((q) => {
    const values = responses
      .map((r) => (r.answers.find((a) => a.qid === q.qid) || {}).value)
      .filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
    const base = {
      qid: q.qid,
      text: q.text,
      type: q.type,
      answered: values.length,
      skipped: total - values.length,
    };
    if (q.type === 'text') {
      return { ...base, answers: values.map(String).slice(0, 500) };
    }
    if (q.type === 'rating') {
      const nums = values.map(Number).filter((n) => n >= 1 && n <= 5);
      const dist = [1, 2, 3, 4, 5].map((n) => {
        const count = nums.filter((v) => Math.round(v) === n).length;
        return {
          option: `${n} star${n > 1 ? 's' : ''}`,
          count,
          pct: nums.length ? count / nums.length : 0,
        };
      });
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      return { ...base, average: avg === null ? null : Math.round(avg * 100) / 100, counts: dist };
    }
    const flat = q.type === 'multiple' ? values.flat().map(String) : values.map(String);
    const counts = q.options.map((o) => {
      const count = flat.filter((v) => v === o).length;
      // multiple choice: share of respondents who picked it; otherwise share of answers
      return { option: o, count, pct: values.length ? count / values.length : 0 };
    });
    return { ...base, counts };
  });
}

async function results(req, res) {
  const s = await findSurvey(req.params.id);
  const responses = await SurveyResponse.find({ surveyId: s._id }).sort({ createdAt: 1 }).lean();
  const byDay = {};
  for (const r of responses) {
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  res.json({
    survey: s.toPublic({ responses: responses.length }),
    total: responses.length,
    perDay: Object.entries(byDay).map(([day, count]) => ({ day, count })),
    questions: aggregate(s, responses),
  });
}

function cellValue(q, value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (q.type === 'rating') return Number(value);
  return String(value);
}

/** Excel: a Summary sheet (counts, %, averages) and a Responses sheet (one row per person). */
async function exportXlsx(req, res) {
  const ExcelJS = require('exceljs');
  const s = await findSurvey(req.params.id);
  const responses = await SurveyResponse.find({ surveyId: s._id }).sort({ createdAt: 1 }).lean();
  const users = new Map(
    (
      await User.find({ _id: { $in: responses.map((r) => r.userId) } })
        .select('name email')
        .lean()
    ).map((u) => [u._id.toString(), u]),
  );
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Guardian Drive';
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 60 }, { width: 34 }, { width: 12 }, { width: 12 }];
  sum.addRow([s.title]).font = { bold: true, size: 14 };
  sum.addRow([
    `${responses.length} responses`,
    `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  ]);
  sum.addRow([]);
  for (const q of aggregate(s, responses)) {
    sum.addRow([
      q.text,
      q.type === 'rating' && q.average !== null ? `Average ${q.average} / 5` : '',
      'Count',
      '%',
    ]).font = {
      bold: true,
    };
    if (q.counts) {
      for (const c of q.counts) {
        const row = sum.addRow(['', c.option, c.count, c.pct]);
        row.getCell(4).numFmt = '0%';
      }
    } else {
      sum.addRow(['', `${q.answered} written answers (see Responses)`]);
    }
    sum.addRow([]);
  }
  const ws = wb.addWorksheet('Responses');
  ws.addRow(['Submitted', 'Name', 'E-mail', 'Platform', ...s.questions.map((q) => q.text)]).font = {
    bold: true,
  };
  for (const r of responses) {
    const u = users.get(r.userId.toString()) || {};
    ws.addRow([
      new Date(r.createdAt),
      u.name || '',
      u.email || '',
      r.platform,
      ...s.questions.map((q) => cellValue(q, (r.answers.find((a) => a.qid === q.qid) || {}).value)),
    ]);
  }
  ws.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm';
  ws.columns.forEach((c, i) => {
    c.width = i < 4 ? 20 : 30;
  });
  const buf = await wb.xlsx.writeBuffer();
  const safe =
    s.title
      .replace(/[^a-z0-9 _-]/gi, '')
      .trim()
      .replace(/\s+/g, '_') || 'survey';
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${safe}_results.xlsx"`);
  res.send(Buffer.from(buf));
}

// -------------------------------------------------------------------------------------- users
function visibleTo(user) {
  return user.role === 'admin' ? {} : { audience: { $in: ['everyone', 'parents'] } };
}

async function openForUser(req, res) {
  const surveys = await Survey.find({ status: 'open', ...visibleTo(req.user) })
    .sort({ publishedAt: -1 })
    .limit(50);
  const mine = await SurveyResponse.find({
    userId: req.user.parentId,
    surveyId: { $in: surveys.map((s) => s._id) },
  })
    .select('surveyId createdAt')
    .lean();
  const done = new Map(mine.map((m) => [m.surveyId.toString(), m.createdAt]));
  res.json({
    surveys: surveys.map((s) =>
      s.toPublic({
        answered: done.has(s._id.toString()),
        answeredAt: done.get(s._id.toString()) || null,
      }),
    ),
  });
}

function checkAnswer(q, value) {
  const missing =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length);
  if (missing) {
    if (q.required) throw new HttpError(400, `Please answer: ${q.text}`);
    return undefined;
  }
  switch (q.type) {
    case 'single':
    case 'yesno':
      if (typeof value !== 'string' || !q.options.includes(value))
        throw new HttpError(400, `Invalid answer: ${q.text}`);
      return value;
    case 'multiple':
      if (!Array.isArray(value) || value.some((v) => !q.options.includes(v))) {
        throw new HttpError(400, `Invalid answer: ${q.text}`);
      }
      return [...new Set(value)];
    case 'rating': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5)
        throw new HttpError(400, `Rate 1 to 5: ${q.text}`);
      return n;
    }
    default:
      return String(value).trim().slice(0, 2000) || undefined;
  }
}

async function respond(req, res) {
  const s = await findSurvey(req.params.id);
  if (s.status !== 'open') throw new HttpError(409, 'This survey is closed');
  const given = new Map(req.body.answers.map((a) => [a.qid, a.value]));
  const answers = [];
  for (const q of s.questions) {
    const v = checkAnswer(q, given.get(q.qid));
    if (v !== undefined) answers.push({ qid: q.qid, value: v });
  }
  try {
    await SurveyResponse.create({
      surveyId: s._id,
      userId: req.user.parentId,
      answers,
      platform: req.body.platform,
    });
  } catch (err) {
    if (err && err.code === 11000)
      throw new HttpError(409, 'You have already answered this survey');
    throw err;
  }
  alertDispatcher.emitToAdmins('survey:response', { id: s._id.toString() });
  res.status(201).json({ ok: true });
}

module.exports = {
  adminList,
  adminGet,
  create,
  importFile,
  update,
  publish,
  close,
  remove,
  results,
  exportXlsx,
  openForUser,
  respond,
  surveySchema,
  updateSchema,
  importSchema,
  answerSchema,
  aggregate,
};
