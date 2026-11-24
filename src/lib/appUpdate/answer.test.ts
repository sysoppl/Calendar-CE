import { describe, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, MAX_ANSWER_CHARS, fetchVersionAnswer, readVersionAnswer } from './answer';

describe("the site's answer", () => {
  it('is the version of version.json', () => {
    expect(readVersionAnswer('{"version":"1.16.0"}\n')).toEqual({ version: '1.16.0' });
    // Keys a later build may add are left alone.
    expect(readVersionAnswer('{"version":"1.17.0","channel":"latest","notes":"<img src=x onerror=alert(1)>","url":"https://evil.example"}')).toEqual({
      version: '1.17.0',
    });
  });

  it('is nothing when it is anything else', () => {
    for (const text of [
      '<!doctype html><title>Log in to the Wi-Fi</title>',
      '',
      'null',
      '[]',
      '["1.16.0"]',
      '"1.16.0"',
      '1.16',
      '{}',
      '{"version":1.16}',
      '{"version":"99999999999999999999.0.0"}',
      '{"version":"v1.16.0"}',
      '{"version":null}',
      '{"version":"1.16.0"',
      `{"version":"1.16.0","pad":"${'x'.repeat(MAX_ANSWER_CHARS)}"}`,
    ]) {
      expect(readVersionAnswer(text), text.slice(0, 60)).toBeNull();
    }
    expect(readVersionAnswer(undefined)).toBeNull();
    expect(readVersionAnswer({ version: '1.16.0' })).toBeNull();
  });

  it('is asked for without credentials, cache, referrer or redirects', async () => {
    const get = vi.fn(async () => new Response('{"version":"1.16.1"}', { headers: { 'content-type': 'application/json' } }));
    expect(await fetchVersionAnswer('/version.json', { fetch: get })).toEqual({ version: '1.16.1' });
    const [url, init] = get.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/version.json');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    // Nothing that would make the browser ask first (a simple request) or say who asks.
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['accept']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is nothing on a failure of any kind, and never rejects', async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => new Response('{"version":"9.0.0"}', { status: 404 }),
      async () => new Response('{"version":"9.0.0"}', { status: 500 }),
      async () => new Response('{"version":"9.0.0"}', { status: 203 }),
      async () => Object.defineProperty(new Response('{"version":"9.0.0"}'), 'redirected', { value: true }),
      async () => new Response('<html>portal</html>', { headers: { 'content-type': 'text/html' } }),
      async () => new Response('{"version":"9.0.0"}', { headers: { 'content-length': String(MAX_ANSWER_CHARS + 1) } }),
      async () => {
        const res = new Response('x');
        Object.defineProperty(res, 'text', { value: async () => Promise.reject(new Error('cut off')) });
        return res;
      },
    ];
    for (const answer of answers) expect(await fetchVersionAnswer('/version.json', { fetch: vi.fn(answer) })).toBeNull();
  });

  it('gives up after a while', async () => {
    vi.useFakeTimers();
    try {
      const get = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const asked = fetchVersionAnswer('/version.json', { fetch: get as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      expect(await asked).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
