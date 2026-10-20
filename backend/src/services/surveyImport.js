/**
 * Turn a Word (.docx), PDF or Excel (.xlsx) file into survey questions the admin can review.
 *
 * Excel: one question per row. Header row (any order, case-insensitive):
 *   Question | Type | Options | Required
 *   Type: single, multiple, rating, yes/no, text (blank = guessed). Options separated by ";" or "|".
 *   Without a header row: column A = question, column B = options.
 *
 * Word / PDF: a numbered list of questions, choices on the lines below each one:
 *   1. How often do you check the dashboard? *        <- "*" or "(required)" = required
 *      a) Every day
 *      b) Every week
 *   2. Which features do you use? (select all that apply)   <- multiple choice
 *      - Live map
 *      - Alerts
 *   3. Rate the app from 1 to 5                       <- rating (1-5 stars)
 *   4. Would you recommend it?  Yes / No              <- yes / no
 *   5. Any suggestions?                               <- free text
 * A first line that isn't a question becomes the survey title.
 */

const QUESTION_RE = /^\s*(?:Q\s*)?(\d{1,3})\s*[.):-]\s+(.+)$/i;
const OPTION_RE = /^\s*(?:[a-hA-H][.)]|[-•*○●◯□☐▢◻]|\(\s?\)|\[\s?\]|o\s)\s*(.+)$/;
const MULTI_RE = /\b(select all|check all|choose all|all that apply|tick all|multiple answers?)\b/i;
const RATING_RE =
  /\b(rate|rating|scale of 1|on a scale|1\s*(?:-|–|to)\s*5|how satisfied|stars?)\b/i;
const REQUIRED_RE = /\s*(\*|\(required\)|\[required\])\s*$/i;
const YES_NO_INLINE_RE = /\s*[([]?\s*yes\s*\/\s*no\s*[)\]]?\s*[?.]?\s*$/i;

const TYPE_ALIASES = {
  single: 'single',
  'single choice': 'single',
  choice: 'single',
  radio: 'single',
  multiple: 'multiple',
  'multiple choice': 'multiple',
  checkbox: 'multiple',
  checkboxes: 'multiple',
  rating: 'rating',
  stars: 'rating',
  scale: 'rating',
  yesno: 'yesno',
  'yes/no': 'yesno',
  'yes / no': 'yesno',
  boolean: 'yesno',
  text: 'text',
  open: 'text',
  'open-ended': 'text',
  paragraph: 'text',
};

function isYesNo(options) {
  const set = options.map((o) => o.trim().toLowerCase());
  return set.length === 2 && set.includes('yes') && set.includes('no');
}

/** Type from the question text and its options (when the file doesn't say). */
function guessType(text, options) {
  if (options.length >= 2) {
    if (isYesNo(options)) return 'yesno';
    return MULTI_RE.test(text) ? 'multiple' : 'single';
  }
  if (YES_NO_INLINE_RE.test(text)) return 'yesno';
  if (RATING_RE.test(text)) return 'rating';
  return 'text';
}

function finish(q, index) {
  let text = q.text.trim();
  let required = Boolean(q.required);
  if (REQUIRED_RE.test(text)) {
    required = true;
    text = text.replace(REQUIRED_RE, '').trim();
  }
  let options = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
  let type = q.type && TYPE_ALIASES[String(q.type).trim().toLowerCase()];
  type = type || guessType(text, options);
  if (type === 'yesno') {
    text = text.replace(YES_NO_INLINE_RE, '').trim() || text;
    options = ['Yes', 'No'];
  }
  if (type === 'rating' || type === 'text') options = [];
  if ((type === 'single' || type === 'multiple') && options.length < 2) type = 'text';
  return {
    qid: `q${index + 1}`,
    text: text.slice(0, 500),
    type,
    options: options.slice(0, 20).map((o) => o.slice(0, 200)),
    required,
  };
}

/** Plain text (from Word or PDF) -> { title, questions }. */
function parseText(text) {
  const lines = String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trimEnd())
    .filter((l) => l.trim());
  const questions = [];
  let title = '';
  let current = null;
  for (const line of lines) {
    const qm = line.match(QUESTION_RE);
    if (qm) {
      if (current) questions.push(current);
      current = { text: qm[2], options: [] };
      continue;
    }
    const om = line.match(OPTION_RE);
    if (current && om) {
      current.options.push(om[1]);
      continue;
    }
    if (!current && !questions.length) {
      if (!title) title = line.trim();
      continue;
    }
    // A wrapped question line (no option marker) continues the question text.
    if (current && !current.options.length) current.text += ` ${line.trim()}`;
  }
  if (current) questions.push(current);
  return { title: title.slice(0, 200), questions: questions.map(finish) };
}

async function parseXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { title: '', questions: [] };
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    rows.push(
      (row.values || []).slice(1).map((v) => {
        if (v && typeof v === 'object')
          return String(v.text || v.result || (v.richText || []).map((r) => r.text).join(''));
        return v === null || v === undefined ? '' : String(v);
      }),
    );
  });
  if (!rows.length) return { title: '', questions: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name || h.startsWith(name));
  const hasHeader = col('question') >= 0;
  const qi = hasHeader ? col('question') : 0;
  const ti = hasHeader ? col('type') : -1;
  const oi = hasHeader ? col('option') : 1;
  const ri = hasHeader ? col('required') : -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const questions = body
    .filter((r) => (r[qi] || '').trim())
    .map((r, i) =>
      finish(
        {
          text: r[qi],
          type: ti >= 0 ? r[ti] : '',
          options: oi >= 0 && r[oi] ? r[oi].split(/[;|\n]/) : [],
          required: ri >= 0 && /^(y|yes|true|1|required|x)$/i.test((r[ri] || '').trim()),
        },
        i,
      ),
    );
  return {
    title: (ws.name && !/^sheet\d*$/i.test(ws.name) ? ws.name : '').slice(0, 200),
    questions,
  };
}

/** { name, buffer } -> { title, questions, format }. Throws an Error with a user-facing message. */
async function importSurvey(name, buffer) {
  const lower = String(name || '').toLowerCase();
  let format;
  if (lower.endsWith('.xlsx') || buffer.subarray(0, 2).toString() === 'PK') {
    format = lower.endsWith('.docx') ? 'docx' : 'xlsx';
  }
  if (lower.endsWith('.docx')) format = 'docx';
  if (lower.endsWith('.pdf') || buffer.subarray(0, 5).toString() === '%PDF-') format = 'pdf';
  if (!format) throw new Error('Use a Word (.docx), PDF or Excel (.xlsx) file.');

  let result;
  if (format === 'xlsx') {
    result = await parseXlsx(buffer);
  } else if (format === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    result = parseText(value);
  } else {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    const { text } = await pdf(buffer);
    result = parseText(text);
  }
  if (!result.questions.length) {
    throw new Error(
      'No questions found. Number each question (1. 2. 3.) and put choices on the lines below it (a) b) or -).',
    );
  }
  if (!result.title)
    result.title =
      lower
        .replace(/\.[a-z]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Survey';
  return { ...result, format };
}

module.exports = { importSurvey, parseText, parseXlsx, guessType };
