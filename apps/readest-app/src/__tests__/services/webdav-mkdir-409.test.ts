import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, WebDAVRequestError, type WebDAVConfig } from '@/services/sync/providers/webdav/client';

/**
 * MKCOL idempotency on servers that answer 409 for "already exists"
 * (e.g. Jianguoyun/坚果云) instead of the standard 405. `mkdir` must probe
 * with PROPFIND after a 409 and treat an existing target as success, while
 * keeping the "parent directory missing" error when the target really is
 * absent or the probe is inconclusive.
 */

const ORIGINAL_FETCH = globalThis.fetch;

const config: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('mkdir 409 handling', () => {
  test('treats 409 + PROPFIND 207 as success (target already exists)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 207 }));

    await expect(mkdir(config, '/Readest')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, mkcolInit] = fetchMock.mock.calls[0]!;
    const [, propfindInit] = fetchMock.mock.calls[1]!;
    expect(mkcolInit?.method).toBe('MKCOL');
    expect(propfindInit?.method).toBe('PROPFIND');
    expect(propfindInit?.headers).toMatchObject({ Depth: '0' });
  });

  test('treats 409 + PROPFIND 200 as success (target already exists)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(mkdir(config, '/Readest')).resolves.toBeUndefined();
  });

  test('keeps the 409 parent-missing error when PROPFIND returns 404', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(mkdir(config, '/Readest/books')).rejects.toMatchObject({
      status: 409,
      message: 'Parent directory missing',
    });
  });

  test('keeps the 409 parent-missing error when the PROPFIND probe is inconclusive', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(mkdir(config, '/Readest')).rejects.toMatchObject({
      status: 409,
      message: 'Parent directory missing',
    });
  });

  test('keeps the 409 parent-missing error when the PROPFIND probe fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(mkdir(config, '/Readest')).rejects.toMatchObject({
      status: 409,
      message: 'Parent directory missing',
    });
  });

  test('still succeeds on the standard idempotent statuses 201 and 405', async () => {
    for (const status of [201, 405]) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    }

    await expect(mkdir(config, '/Readest')).resolves.toBeUndefined();
    await expect(mkdir(config, '/Readest/books')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('surfaces non-conflict MKCOL failures with their status', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(mkdir(config, '/Readest')).rejects.toBeInstanceOf(WebDAVRequestError);
    await expect(mkdir(config, '/Readest')).rejects.toMatchObject({ status: 403 });
  });
});
