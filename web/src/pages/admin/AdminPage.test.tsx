import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import * as adminApi from '../../api/admin';
import { navItemsFor } from '../../components/layout/nav';
import { renderWithProviders } from '../../test/utils';
import { AdminPage } from './AdminPage';
import { DatasetsTab } from './DatasetsTab';
import { ModelsTab } from './ModelsTab';

const spies: Array<{ mockRestore: () => void }> = [];
function spy<K extends keyof typeof adminApi>(name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = vi.spyOn(adminApi, name as any);
  spies.push(s);
  return s;
}
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  localStorage.clear();
});

function signInAs(role: 'admin' | 'parent') {
  localStorage.setItem('gd:token', 't');
  localStorage.setItem('gd:user', JSON.stringify({ id: 'u1', name: 'Ada', email: 'a@x.co', role, createdAt: '' }));
}

const DATASETS: adminApi.DatasetsResponse = {
  catalog: [
    { id: 'yawn-eye', title: 'Yawn & Eye', source: 'kaggle', slug: 'serenaraju/yawn-eye-dataset-new', sizeMb: 176, task: 'eye_state', description: 'eyes', local: { ready: true, images: 1452, open: 726, closed: 726 } },
    { id: 'mrl-eyes', title: 'MRL Eye', source: 'kaggle', slug: 'prasadvpatil/mrl-dataset', sizeMb: 23, task: 'eye_state', description: 'IR eyes', local: { ready: false } },
    { id: 'yawn', title: 'Yawn Dataset', source: 'kaggle', slug: 'davidvazquezcic/yawn-dataset', sizeMb: 18, task: 'yawn_calibration', description: 'yawns', local: { ready: true, lastCalibrated: null } },
    { id: 'uta-rldd', title: 'UTA-RLDD', source: 'manual', url: 'https://example.org', task: 'video', preset: 'rldd', description: 'videos', local: { ready: false, videos: 0, folder: '/data/videos/uta-rldd', processed: false } },
  ],
  synthetic: { main: { rows: 1 }, shift: null },
  recordings: [],
  uploads: 0,
  feedback: { labelled: 12, falseAlarms: 4, realAlarms: 8, withWindow: 10 },
  videosDir: '/data/videos',
};

describe('admin navigation', () => {
  test('only admins see the Admin item', () => {
    expect(navItemsFor('parent').map((i) => i.label)).not.toContain('Admin');
    expect(navItemsFor(undefined).map((i) => i.label)).not.toContain('Admin');
    expect(navItemsFor('admin').map((i) => i.label)).toContain('Admin');
  });

  test('the admin page is not rendered for parents', () => {
    signInAs('parent');
    renderWithProviders(<AdminPage />, { route: '/admin' });
    expect(screen.queryByText(/Admin · model training/)).not.toBeInTheDocument();
  });
});

describe('Datasets tab', () => {
  test('shows feedback counts and starts a download / calibration / processing job', async () => {
    signInAs('admin');
    spy('getDatasets').mockResolvedValue(DATASETS);
    const start = spy('startJob').mockResolvedValue({ id: 'j1' } as adminApi.TrainingJob);
    renderWithProviders(<DatasetsTab />, { route: '/admin?tab=datasets' });

    await waitFor(() => expect(screen.getByTestId('admin-datasets')).toBeInTheDocument());
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('dataset-yawn-eye')).getByText(/Downloaded · 726 open/)).toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId('dataset-mrl-eyes')).getByRole('button', { name: /download/i }));
    expect(start).toHaveBeenCalledWith('fetch_dataset', { datasetId: 'mrl-eyes' });

    await userEvent.click(within(screen.getByTestId('dataset-yawn')).getByRole('button', { name: /calibrate/i }));
    expect(start).toHaveBeenCalledWith('calibrate_yawn', { datasetId: 'yawn' });

    // No videos placed yet → processing is disabled and the folder is shown
    const rldd = within(screen.getByTestId('dataset-uta-rldd'));
    expect(rldd.getByRole('button', { name: /process/i })).toBeDisabled();
    expect(rldd.getByText('/data/videos/uta-rldd')).toBeInTheDocument();
  });
});

describe('Models tab', () => {
  test('compares candidates with the live model and promotes one', async () => {
    signInAs('admin');
    spy('listModels').mockResolvedValue([
      {
        id: 'r2',
        kind: 'fp_verifier',
        status: 'candidate',
        jobId: 'j2',
        createdAt: new Date().toISOString(),
        promotedAt: null,
        summary: { falseAlertsPerHour: 0.08, baselineFalseAlertsPerHour: 3.4, episodeRecall: 1, data: ['data/synthetic_v1'], feedback: true },
      },
    ]);
    const promote = spy('promoteModel').mockResolvedValue({ id: 'r2', kind: 'fp_verifier' } as adminApi.ModelRelease);
    renderWithProviders(<ModelsTab />, { route: '/admin?tab=models' });

    const row = await screen.findByTestId('release-r2');
    expect(row).toHaveTextContent('0.08 (fusion only 3.40)');
    expect(row).toHaveTextContent('100%');
    expect(row).toHaveTextContent('data/synthetic_v1 + feedback');
    await userEvent.click(within(row).getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(promote).toHaveBeenCalledWith('r2', expect.anything()));
  });
});
