const { targetUrl, schedule } = require('./keepAlive');

describe('keepAlive', () => {
  test('uses KEEP_ALIVE_URL, else the address Render gives the service', () => {
    expect(targetUrl({ RENDER_EXTERNAL_URL: 'https://api.onrender.com/' })).toBe(
      'https://api.onrender.com/api/health',
    );
    expect(
      targetUrl({ KEEP_ALIVE_URL: 'https://x.example', RENDER_EXTERNAL_URL: 'https://y.example' }),
    ).toBe('https://x.example/api/health');
  });

  test('off locally, in tests and with KEEP_ALIVE=off', () => {
    expect(targetUrl({})).toBe('');
    expect(targetUrl({ NODE_ENV: 'test', RENDER_EXTERNAL_URL: 'https://a' })).toBe('');
    expect(targetUrl({ KEEP_ALIVE: 'off', RENDER_EXTERNAL_URL: 'https://a' })).toBe('');
  });

  test('pings the health address on a timer', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const task = schedule({ env: { RENDER_EXTERNAL_URL: 'https://a.example' }, everyMs: 1000, fetchFn });
    jest.advanceTimersByTime(2500);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe('https://a.example/api/health');
    task.stop();
    jest.useRealTimers();
  });
});
