import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { DownloadPage } from './DownloadPage';
import { renderWithProviders } from '../test/utils';
import { detectPlatform, fetchApkInfo, formatBytes, isExternalUrl, shareableOrigin } from '../lib/platform';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';

// Restore only our own spies: restoreAllMocks would also wipe the shared matchMedia mock (test/setup.ts).
const spies: Array<{ mockRestore: () => void }> = [];
function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}
function restoreSpies() {
  while (spies.length) spies.pop()!.mockRestore();
}

function mockApk(response: { status: number; headers?: Record<string, string> } | 'network-error') {
  return track(vi.spyOn(globalThis, 'fetch')).mockImplementation(async () => {
    if (response === 'network-error') throw new TypeError('offline');
    return new Response(null, { status: response.status, headers: response.headers });
  });
}

afterEach(restoreSpies);

describe('platform helpers', () => {
  test('detects Android, iPhone, iPadOS (desktop UA + touch) and desktop', () => {
    expect(detectPlatform(ANDROID_UA, 5)).toBe('android');
    expect(detectPlatform(IPHONE_UA, 5)).toBe('ios');
    expect(detectPlatform(IPAD_UA, 5)).toBe('ios');
    expect(detectPlatform(IPAD_UA, 0)).toBe('desktop'); // a real Mac
    expect(detectPlatform(WINDOWS_UA, 0)).toBe('desktop');
  });

  test('the QR code never points a phone at localhost', () => {
    const local = { protocol: 'http:', hostname: 'localhost', port: '5173', origin: 'http://localhost:5173' };
    expect(shareableOrigin(local, '192.168.254.101')).toBe('http://192.168.254.101:5173');
    expect(shareableOrigin(local, '')).toBe('http://localhost:5173'); // no network: nothing better to offer
    const deployed = { protocol: 'https:', hostname: 'guardian.web.app', port: '', origin: 'https://guardian.web.app' };
    expect(shareableOrigin(deployed, '192.168.254.101')).toBe('https://guardian.web.app');
  });

  test('an APK hosted on another site (GitHub Release) is linked without a cross-origin HEAD', async () => {
    const url = 'https://github.com/galangec24/guardian-drive-download/releases/latest/download/GuardianDrive.apk';
    expect(isExternalUrl(url, 'https://guardian-drive-ph.web.app')).toBe(true);
    expect(isExternalUrl('/app.apk', 'https://guardian-drive-ph.web.app')).toBe(false);
    const fetchSpy = track(vi.spyOn(globalThis, 'fetch'));
    expect(await fetchApkInfo(url)).toEqual({ available: true, external: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('APK info from HEAD; the HTML app shell or an error means not published', async () => {
    mockApk({
      status: 200,
      headers: {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': '21714301',
        'last-modified': 'Fri, 09 Oct 2026 19:20:00 GMT',
      },
    });
    expect(await fetchApkInfo()).toEqual({
      available: true,
      sizeBytes: 21714301,
      updatedAt: '2026-10-09T19:20:00.000Z',
    });
    restoreSpies();
    mockApk({ status: 200, headers: { 'content-type': 'text/html' } });
    expect((await fetchApkInfo()).available).toBe(false);
    restoreSpies();
    mockApk({ status: 404 });
    expect((await fetchApkInfo()).available).toBe(false);
    restoreSpies();
    mockApk('network-error');
    expect((await fetchApkInfo()).available).toBe(false);
    expect(formatBytes(21714301)).toBe('20.7 MB');
  });
});

describe('DownloadPage', () => {
  function withUserAgent(ua: string) {
    track(vi.spyOn(window.navigator, 'userAgent', 'get')).mockReturnValue(ua);
  }

  test('Android visitors get the APK first, with size and install steps', async () => {
    withUserAgent(ANDROID_UA);
    mockApk({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '21714301' } });
    renderWithProviders(<DownloadPage />, { route: '/download' });

    const android = screen.getByTestId('option-android');
    expect(android).toHaveTextContent('Recommended for this device');
    await waitFor(() => expect(screen.getByTestId('apk-meta')).toHaveTextContent('20.7 MB'));
    expect(screen.getByRole('link', { name: /download apk/i })).toHaveAttribute('href', '/app.apk');
    expect(screen.getByTestId('steps-android')).toHaveTextContent('install unknown apps');
    expect(screen.getByTestId('steps-web')).toHaveTextContent('Add to Home screen');
    // Android card comes first
    const cards = screen.getAllByTestId(/^option-/);
    expect(cards[0]).toBe(android);
    await waitFor(() => expect(screen.getByTestId('qr-code')).toHaveAttribute('src', expect.stringContaining('svg')));
  });

  test('iPhone visitors get Add to Home Screen steps; a missing APK is explained', async () => {
    withUserAgent(IPHONE_UA);
    mockApk({ status: 404 });
    renderWithProviders(<DownloadPage />, { route: '/download' });

    expect(screen.getByTestId('option-web')).toHaveTextContent('Recommended for this device');
    expect(screen.getByTestId('option-web')).toHaveTextContent('iPhone & iPad');
    expect(screen.getByTestId('steps-web')).toHaveTextContent('Add to Home Screen');
    await waitFor(() => expect(screen.getByTestId('apk-missing')).toBeInTheDocument());
  });

  test('desktop visitors see the QR code for their phone and a sign-in link', async () => {
    withUserAgent(WINDOWS_UA);
    mockApk({ status: 404 });
    renderWithProviders(<DownloadPage />, { route: '/download' });
    expect(screen.getByTestId('qr-card')).toHaveTextContent('Scan with your phone');
    expect(screen.getByTestId('qr-card')).toHaveTextContent('/download');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    await waitFor(() => expect(screen.getByTestId('qr-code')).toBeInTheDocument());
  });
});
