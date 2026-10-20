const request = require('supertest');
const ExcelJS = require('exceljs');
const User = require('../src/models/User');
const { parseText, guessType } = require('../src/services/surveyImport');
const { startStack, registerParent } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function admin() {
  const a = await registerParent(stack.app);
  await User.updateOne({ _id: a.user.id }, { role: 'admin' });
  return a;
}

describe('Rate the app', () => {
  test('optional, one per account, editable and removable; the summary is visible to everyone', async () => {
    const ana = await registerParent(stack.app, { name: 'Ana Cruz' });
    const ben = await registerParent(stack.app, { name: 'Ben Reyes' });

    const empty = await request(stack.app).get('/api/ratings/summary').expect(200);
    expect(empty.body).toMatchObject({ count: 0, average: null });
    expect(
      (await request(stack.app).get('/api/ratings/mine').set(auth(ana.token)).expect(200)).body
        .rating,
    ).toBeNull();

    await request(stack.app)
      .put('/api/ratings/mine')
      .set(auth(ana.token))
      .send({ stars: 5, comment: 'Very helpful!' })
      .expect(200);
    await request(stack.app)
      .put('/api/ratings/mine')
      .set(auth(ben.token))
      .send({ stars: 3 })
      .expect(200);
    // changing it replaces the old rating
    const changed = await request(stack.app)
      .put('/api/ratings/mine')
      .set(auth(ben.token))
      .send({ stars: 4, comment: 'Good' })
      .expect(200);
    expect(changed.body.summary).toMatchObject({
      count: 2,
      average: 4.5,
      distribution: { 4: 1, 5: 1 },
    });

    const pub = await request(stack.app).get('/api/ratings/summary').expect(200);
    expect(pub.body.recent.map((r) => r.author).sort()).toEqual(['Ana C.', 'Ben R.']); // short names only
    expect(JSON.stringify(pub.body)).not.toMatch(/@/); // no e-mails in the public summary

    await request(stack.app)
      .put('/api/ratings/mine')
      .set(auth(ana.token))
      .send({ stars: 6 })
      .expect(400);
    await request(stack.app).delete('/api/ratings/mine').set(auth(ana.token)).expect(200);
    expect((await request(stack.app).get('/api/ratings/summary')).body).toMatchObject({
      count: 1,
      average: 4,
    });

    const boss = await admin();
    const list = await request(stack.app)
      .get('/api/admin/ratings')
      .set(auth(boss.token))
      .expect(200);
    expect(list.body.ratings[0]).toMatchObject({ stars: 4, userName: 'Ben Reyes' });
    await request(stack.app).get('/api/admin/ratings').set(auth(ben.token)).expect(403);
  });
});

describe('Survey import (Word / PDF text and Excel)', () => {
  test('numbered questions with choices, multiple choice, rating, yes/no, text and required', () => {
    const { title, questions } = parseText(`Guardian Drive user survey
1. How often do you open the app? *
   a) Every day
   b) Every week
   c) Rarely
2. Which features do you use? (select all that apply)
   - Live map
   - Alerts
   - Feedback
3. Rate the alert accuracy from 1 to 5
4. Would you recommend Guardian Drive? Yes / No
5. Any suggestions for us?`);
    expect(title).toBe('Guardian Drive user survey');
    expect(questions.map((q) => [q.type, q.required])).toEqual([
      ['single', true],
      ['multiple', false],
      ['rating', false],
      ['yesno', false],
      ['text', false],
    ]);
    expect(questions[0]).toMatchObject({
      qid: 'q1',
      text: 'How often do you open the app?',
      options: ['Every day', 'Every week', 'Rarely'],
    });
    expect(questions[3]).toMatchObject({
      text: 'Would you recommend Guardian Drive?',
      options: ['Yes', 'No'],
    });
    expect(guessType('How satisfied are you?', [])).toBe('rating');
  });

  test('Excel with a header row, and a file with no questions is rejected clearly', async () => {
    const boss = await admin();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Driver safety survey');
    ws.addRow(['Question', 'Type', 'Options', 'Required']);
    ws.addRow(['Which device do you use?', 'single', 'Android; Windows; Web', 'yes']);
    ws.addRow(['How easy is setup?', 'rating', '', '']);
    ws.addRow(['Comments', '', '', '']);
    const data = `data:application/octet-stream;base64,${Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')}`;
    const r = await request(stack.app)
      .post('/api/admin/surveys/import')
      .set(auth(boss.token))
      .send({ name: 'safety.xlsx', data })
      .expect(200);
    expect(r.body.draft.title).toBe('Driver safety survey');
    expect(r.body.draft.questions.map((q) => q.type)).toEqual(['single', 'rating', 'text']);
    expect(r.body.draft.questions[0]).toMatchObject({
      options: ['Android', 'Windows', 'Web'],
      required: true,
    });

    const bad = await request(stack.app)
      .post('/api/admin/surveys/import')
      .set(auth(boss.token))
      .send({ name: 'notes.txt', data: 'data:text/plain;base64,aGVsbG8=' })
      .expect(422);
    expect(bad.body.error).toMatch(/Word|PDF|Excel/);
  });
});

describe('Survey lifecycle and results', () => {
  test('create, publish, answer once, results with counts / averages, Excel export, close', async () => {
    const boss = await admin();
    const ana = await registerParent(stack.app);
    const ben = await registerParent(stack.app);
    const created = await request(stack.app)
      .post('/api/admin/surveys')
      .set(auth(boss.token))
      .send({
        title: 'App feedback',
        questions: [
          { text: 'Device?', type: 'single', options: ['Android', 'Web'], required: true },
          { text: 'Features?', type: 'multiple', options: ['Map', 'Alerts', 'Calls'] },
          { text: 'Rate it', type: 'rating' },
          { text: 'Recommend?', type: 'yesno' },
          { text: 'Ideas', type: 'text' },
        ],
      })
      .expect(201);
    const id = created.body.survey.id;

    // drafts are not shown to users
    expect(
      (await request(stack.app).get('/api/surveys').set(auth(ana.token))).body.surveys,
    ).toHaveLength(0);
    await request(stack.app)
      .post(`/api/admin/surveys/${id}/publish`)
      .set(auth(boss.token))
      .expect(200);
    const open = await request(stack.app).get('/api/surveys').set(auth(ana.token)).expect(200);
    expect(open.body.surveys[0]).toMatchObject({ id, answered: false });

    const answer = (token, answers) =>
      request(stack.app).post(`/api/surveys/${id}/responses`).set(auth(token)).send({ answers });
    await answer(ana.token, [{ qid: 'q2', value: ['Map'] }]).expect(400); // required q1 missing
    await answer(ana.token, [{ qid: 'q1', value: 'iPhone' }]).expect(400); // not an option
    await answer(ana.token, [
      { qid: 'q1', value: 'Android' },
      { qid: 'q2', value: ['Map', 'Alerts'] },
      { qid: 'q3', value: 5 },
      { qid: 'q4', value: 'Yes' },
      { qid: 'q5', value: 'Add calls' },
    ]).expect(201);
    await answer(ana.token, [{ qid: 'q1', value: 'Web' }]).expect(409); // only once
    await answer(ben.token, [
      { qid: 'q1', value: 'Web' },
      { qid: 'q2', value: ['Alerts'] },
      { qid: 'q3', value: 4 },
    ]).expect(201);
    expect(
      (await request(stack.app).get('/api/surveys').set(auth(ana.token))).body.surveys[0].answered,
    ).toBe(true);

    // questions are locked once there are responses
    await request(stack.app)
      .patch(`/api/admin/surveys/${id}`)
      .set(auth(boss.token))
      .send({ questions: [{ text: 'New?', type: 'text' }] })
      .expect(409);

    const res = await request(stack.app)
      .get(`/api/admin/surveys/${id}/results`)
      .set(auth(boss.token))
      .expect(200);
    expect(res.body.total).toBe(2);
    const [q1, q2, q3, q4, q5] = res.body.questions;
    expect(q1.counts).toEqual([
      { option: 'Android', count: 1, pct: 0.5 },
      { option: 'Web', count: 1, pct: 0.5 },
    ]);
    expect(q2.counts.find((c) => c.option === 'Alerts')).toMatchObject({ count: 2, pct: 1 }); // share of respondents
    expect(q3).toMatchObject({ average: 4.5, answered: 2 });
    expect(q4).toMatchObject({ answered: 1, skipped: 1 });
    expect(q5.answers).toEqual(['Add calls']);

    const xlsx = await request(stack.app)
      .get(`/api/admin/surveys/${id}/export.xlsx`)
      .set(auth(boss.token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Responses']);
    expect(wb.getWorksheet('Responses').rowCount).toBe(3); // header + 2 people

    await request(stack.app)
      .post(`/api/admin/surveys/${id}/close`)
      .set(auth(boss.token))
      .expect(200);
    await answer((await registerParent(stack.app)).token, [{ qid: 'q1', value: 'Web' }]).expect(
      409,
    );
    // non-admins can't see results
    await request(stack.app)
      .get(`/api/admin/surveys/${id}/results`)
      .set(auth(ana.token))
      .expect(403);
  });
});
