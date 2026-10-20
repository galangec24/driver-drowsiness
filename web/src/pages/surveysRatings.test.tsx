import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { RateAppCard } from '../components/settings/RateAppCard';
import { SurveysPage } from './SurveysPage';
import { SurveysTab } from './admin/SurveysTab';
import * as ratingsApi from '../api/ratings';
import * as surveysApi from '../api/surveys';
import type { Survey } from '../api/surveys';

vi.mock('../api/ratings', async (orig) => ({
  ...(await orig<typeof import('../api/ratings')>()),
  getRatingSummary: vi.fn(),
  getMyRating: vi.fn(),
  rateApp: vi.fn(),
  removeMyRating: vi.fn(),
}));
vi.mock('../api/surveys', async (orig) => ({
  ...(await orig<typeof import('../api/surveys')>()),
  openSurveys: vi.fn(),
  answerSurvey: vi.fn(),
  adminSurveys: vi.fn(),
  importSurveyFile: vi.fn(),
  createSurvey: vi.fn(),
  surveyResults: vi.fn(),
}));

const SUMMARY = {
  count: 3,
  average: 4.3,
  distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 },
  recent: [
    {
      id: 'r1',
      stars: 5,
      comment: 'Love the voice guidance',
      platform: 'web',
      author: 'Ana C.',
      updatedAt: new Date().toISOString(),
    },
  ],
};

const SURVEY: Survey = {
  id: 's1',
  title: 'App feedback',
  description: '',
  status: 'open',
  audience: 'everyone',
  source: null,
  publishedAt: null,
  closedAt: null,
  createdAt: new Date().toISOString(),
  answered: false,
  questions: [
    { qid: 'q1', text: 'Device?', type: 'single', options: ['Android', 'Web'], required: true },
    { qid: 'q2', text: 'Rate it', type: 'rating', options: [], required: false },
    { qid: 'q3', text: 'Ideas', type: 'text', options: [], required: false },
  ],
};

describe('Rate the app', () => {
  test('shows the average and reviews, and submits an optional rating', async () => {
    vi.mocked(ratingsApi.getRatingSummary).mockResolvedValue(SUMMARY);
    vi.mocked(ratingsApi.getMyRating).mockResolvedValue(null);
    vi.mocked(ratingsApi.rateApp).mockResolvedValue({
      rating: { stars: 4, comment: 'Nice', updatedAt: new Date().toISOString() },
      summary: { ...SUMMARY, count: 4 },
    });
    renderWithProviders(<RateAppCard />);
    const summary = await screen.findByTestId('rating-summary');
    expect(summary).toHaveTextContent('4.3');
    expect(summary).toHaveTextContent('3 ratings');
    expect(summary).toHaveTextContent('Love the voice guidance');
    expect(within(summary).getByTestId('bar-chart')).toHaveTextContent('5 stars2 (67%)');

    const submit = screen.getByRole('button', { name: 'Submit rating' });
    expect(submit).toBeDisabled(); // optional: nothing is sent until a star is picked
    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    await userEvent.type(screen.getByLabelText('Comment'), 'Nice');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(vi.mocked(ratingsApi.rateApp).mock.calls[0]?.[0]).toEqual({ stars: 4, comment: 'Nice' }),
    );
  });
});

describe('Answering a survey', () => {
  test('required questions must be answered; answers are sent once', async () => {
    vi.mocked(surveysApi.openSurveys).mockResolvedValue([SURVEY]);
    vi.mocked(surveysApi.answerSurvey).mockResolvedValue();
    renderWithProviders(<SurveysPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer' }));
    const send = screen.getByRole('button', { name: 'Send answers' });
    expect(send).toBeDisabled();
    expect(screen.getByText(/1 required question left/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Web'));
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    await userEvent.type(screen.getByLabelText('Ideas'), 'Calls');
    await userEvent.click(send);
    await waitFor(() =>
      expect(vi.mocked(surveysApi.answerSurvey).mock.calls[0]).toEqual([
        's1',
        [
          { qid: 'q1', value: 'Web' },
          { qid: 'q2', value: 5 },
          { qid: 'q3', value: 'Calls' },
        ],
      ]),
    );
  });
});

describe('Admin surveys', () => {
  test('import a file into the builder, then save it', async () => {
    vi.mocked(surveysApi.adminSurveys).mockResolvedValue([]);
    vi.mocked(surveysApi.importSurveyFile).mockResolvedValue({
      title: 'Imported survey',
      questions: [{ text: 'Device?', type: 'single', options: ['Android', 'Web'], required: true }],
      source: { fileName: 'survey.docx', format: 'docx' },
    });
    vi.mocked(surveysApi.createSurvey).mockResolvedValue({ ...SURVEY, status: 'draft' });
    renderWithProviders(<SurveysTab />);
    const file = new File(['x'], 'survey.docx');
    await userEvent.upload(await screen.findByTestId('survey-file'), file);
    const builder = await screen.findByTestId('survey-builder');
    expect(builder).toHaveTextContent('Imported from survey.docx');
    expect(screen.getByDisplayValue('Imported survey')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Device?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save survey' }));
    await waitFor(() =>
      expect(vi.mocked(surveysApi.createSurvey).mock.calls[0]?.[0]).toMatchObject({
        title: 'Imported survey',
        questions: [{ text: 'Device?', type: 'single', options: ['Android', 'Web'], required: true }],
      }),
    );
  });

  test('results show charts with counts and the rating average', async () => {
    vi.mocked(surveysApi.adminSurveys).mockResolvedValue([{ ...SURVEY, responses: 2 }]);
    vi.mocked(surveysApi.surveyResults).mockResolvedValue({
      survey: SURVEY,
      total: 2,
      perDay: [{ day: '2026-10-20', count: 2 }],
      questions: [
        {
          qid: 'q1',
          text: 'Device?',
          type: 'single',
          answered: 2,
          skipped: 0,
          counts: [
            { option: 'Android', count: 1, pct: 0.5 },
            { option: 'Web', count: 1, pct: 0.5 },
          ],
        },
        {
          qid: 'q2',
          text: 'Rate it',
          type: 'rating',
          answered: 2,
          skipped: 0,
          average: 4.5,
          counts: [1, 2, 3, 4, 5].map((n) => ({ option: `${n} stars`, count: n >= 4 ? 1 : 0, pct: n >= 4 ? 0.5 : 0 })),
        },
        { qid: 'q3', text: 'Ideas', type: 'text', answered: 1, skipped: 1, answers: ['Add calls'] },
      ],
    });
    renderWithProviders(<SurveysTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Results' }));
    const results = await screen.findByTestId('survey-results');
    await waitFor(() => expect(results).toHaveTextContent('2 responses'));
    const [device, rating, ideas] = await screen.findAllByTestId('question-result');
    expect(device).toHaveTextContent('Android1 (50%)');
    expect(rating).toHaveTextContent('Average 4.50 / 5');
    expect(ideas).toHaveTextContent('Add calls');
    expect(screen.getByTestId('column-chart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excel' })).toBeInTheDocument();
  });
});
