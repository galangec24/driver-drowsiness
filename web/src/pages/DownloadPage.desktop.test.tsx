import { screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { DownloadPage } from './DownloadPage';
import { renderWithProviders } from '../test/utils';
import { detectDesktopOs } from '../lib/platform';

// The installer link normally comes from VITE_WINDOWS_URL (production build only).
vi.mock('../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../lib/platform')>()),
  WINDOWS_URL: 'https://example.com/GuardianDrive-Setup.exe',
}));

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});
function setup(ua: string) {
  spies.push(vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua));
  // The APK is published (HEAD /app.apk answers with the file).
  spies.push(
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-length': '61564739' },
        }),
    ),
  );
  renderWithProviders(<DownloadPage />, { route: '/download' });
}

test('detectDesktopOs', () => {
  expect(detectDesktopOs(WINDOWS_UA)).toBe('windows');
  expect(detectDesktopOs(MAC_UA)).toBe('mac');
  expect(detectDesktopOs('Mozilla/5.0 (X11; Linux x86_64) Chrome/126')).toBe('linux');
});

test('a Windows PC is offered the installer first, not the APK', async () => {
  setup(WINDOWS_UA);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('your computer');
  const cards = screen.getAllByTestId(/^option-/);
  expect(cards[0]).toBe(screen.getByTestId('option-windows'));
  expect(cards[0]).toHaveTextContent('Recommended for this device');
  expect(within(cards[0]!).getByRole('link', { name: /download for windows/i })).toHaveAttribute(
    'href',
    'https://example.com/GuardianDrive-Setup.exe',
  );
  expect(screen.getByTestId('steps-windows')).toHaveTextContent('Run anyway');

  // The Android card points to the phone instead of a big "Download APK" button.
  const android = screen.getByTestId('option-android');
  await waitFor(() => expect(within(android).getByTestId('apk-on-computer')).toBeInTheDocument());
  expect(within(android).queryByRole('button', { name: /download apk/i })).not.toBeInTheDocument();
  expect(android).not.toHaveTextContent('Recommended');
});

test('a Mac gets the browser install first; the Windows installer is still listed', () => {
  setup(MAC_UA);
  const cards = screen.getAllByTestId(/^option-/);
  expect(cards[0]).toBe(screen.getByTestId('option-web'));
  expect(cards[0]).toHaveTextContent('Recommended for this device');
  expect(screen.getByTestId('option-windows')).not.toHaveTextContent('Recommended');
});

test('an Android phone still gets the APK button and no Windows installer', async () => {
  setup(ANDROID_UA);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('your phone');
  expect(screen.queryByTestId('option-windows')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('link', { name: /download apk/i })).toBeInTheDocument());
});
