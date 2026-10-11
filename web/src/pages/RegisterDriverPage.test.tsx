import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { vi } from 'vitest';
import * as driversApi from '../api/drivers';
import { renderWithProviders } from '../test/utils';
import { RegisterDriverPage } from './RegisterDriverPage';

// jsdom has no canvas: stand-ins for decoding/encoding the chosen file.
vi.mock('../lib/imageQuality', async (orig) => ({
  ...(await orig<typeof import('../lib/imageQuality')>()),
  loadImage: vi.fn(async () => ({ naturalWidth: 640, naturalHeight: 480 })),
  toJpegDataUrl: vi.fn(() => `data:image/jpeg;base64,${'A'.repeat(200)}`),
  analyzeSource: vi.fn(() => null),
}));

const spies: Array<{ mockRestore: () => void }> = [];
function spy<K extends keyof typeof driversApi>(name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = vi.spyOn(driversApi, name as any);
  spies.push(s);
  return s;
}
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

const jpg = () => new File(['x'], 'face.jpg', { type: 'image/jpeg' });

function faceMatchError(matches: { driverId: string; name: string; confidence: number }[]) {
  return new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'This face matches Alex', details: { code: 'FACE_MATCHES_DRIVER', matches } },
  });
}

describe('RegisterDriverPage photo validation', () => {
  test('a photo the server rejects is not accepted', async () => {
    spy('listDrivers').mockResolvedValue([]);
    const check = spy('checkPhoto').mockResolvedValue({
      ok: false,
      problem: 'no_face',
      message: 'No face found. Center the face in the oval with good light.',
      matches: [],
    });
    renderWithProviders(<RegisterDriverPage />, { route: '/drivers/new' });

    await userEvent.upload(screen.getByLabelText('Upload front photo'), jpg());
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(await screen.findByText(/No face found/)).toBeInTheDocument();
    expect(screen.queryByAltText('front photo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register with 0\/3 photos/ })).toBeDisabled();
  });

  test('side photos are checked against the front photo', async () => {
    spy('listDrivers').mockResolvedValue([]);
    const check = spy('checkPhoto')
      .mockResolvedValueOnce({ ok: true, problem: null, message: null, matches: [] })
      .mockResolvedValueOnce({
        ok: false,
        problem: 'different_person',
        message: "This doesn't look like the same person as the front photo.",
        matches: [],
      });
    renderWithProviders(<RegisterDriverPage />, { route: '/drivers/new' });

    await userEvent.upload(screen.getByLabelText('Upload front photo'), jpg());
    expect(await screen.findByAltText('front photo')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Upload left photo'), jpg());
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(check.mock.calls[1]![1]).toMatch(/^data:image\/jpeg/); // compared with the front photo
    expect(await screen.findByText(/same person as the front photo/)).toBeInTheDocument();
    expect(screen.queryByAltText('left photo')).not.toBeInTheDocument();
  });

  test('a face that matches a registered driver needs the twins confirmation', async () => {
    spy('listDrivers').mockResolvedValue([]);
    const alex = { driverId: 'd1', name: 'Alex', confidence: 0.93 };
    spy('checkPhoto').mockResolvedValue({ ok: true, problem: null, message: null, matches: [alex] });
    const create = spy('createDriver')
      .mockRejectedValueOnce(faceMatchError([alex]))
      .mockResolvedValueOnce({
        driverId: 'd2',
        driver: { id: 'd2', name: 'Alexa' } as never,
        quality: 0.8,
        photos: [{ index: 0, quality: 0.8, issues: [] }],
        similarFaces: [alex],
      });
    renderWithProviders(<RegisterDriverPage />, { route: '/drivers/new' });

    await userEvent.type(screen.getByLabelText('Driver name'), 'Alexa');
    await userEvent.upload(screen.getByLabelText('Upload front photo'), jpg());
    // Early warning as soon as the front photo is accepted
    expect(await screen.findByTestId('front-matches')).toHaveTextContent('Alex (93%)');

    await userEvent.click(screen.getByRole('button', { name: /Register with 1\/3 photos/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This face is already registered');
    expect(dialog).toHaveTextContent('Alex (93% match)');
    expect(create.mock.calls[0]![0]).not.toHaveProperty('confirmLookalike', true);

    await userEvent.click(within(dialog).getByRole('button', { name: /They are twins: register/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]![0]).toMatchObject({ name: 'Alexa', confirmLookalike: true });
  });
});
