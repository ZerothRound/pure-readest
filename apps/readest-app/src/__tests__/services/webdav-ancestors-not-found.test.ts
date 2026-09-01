import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  exists,
  getFile,
  getFileBinary,
  headFile,
  listDirectory,
  type WebDAVConfig,
} from '@/services/sync/providers/webdav/client';

/**
 * Jianguoyun (坚果云) answers 409 with an `AncestorsNotFound` body when the
 * target's parent directory does not exist yet, where standard WebDAV
 * servers answer 404. Read/HEAD operations must treat that as "remote
 * resource absent" so a first sync creates the tree instead of failing.
 */

const JIANGUOYUN_409_BODY = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>AncestorsNotFound</s:exception><s:message>The ancestors of this location does not found</s:message></d:error>`;

const config: WebDAVConfig = {
  serverUrl: 'https://dav.jianguoyun.com/dav',
  username: 'alice',
  password: 'secret',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebDAV 409 AncestorsNotFound handling', () => {
  test('getFile returns null when ancestors are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JIANGUOYUN_409_BODY, { status: 409 }));

    await expect(getFile(config, '/Readest/library.json')).resolves.toBeNull();
  });

  test('getFileBinary returns null when ancestors are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JIANGUOYUN_409_BODY, { status: 409 }));

    await expect(getFileBinary(config, '/Readest/books/hash/book.epub')).resolves.toBeNull();
  });

  test('headFile returns null when ancestors are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JIANGUOYUN_409_BODY, { status: 409 }));

    await expect(headFile(config, '/Readest/library.json')).resolves.toBeNull();
  });

  test('exists returns false when ancestors are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JIANGUOYUN_409_BODY, { status: 409 }));

    await expect(exists(config, '/Readest/library.json')).resolves.toBe(false);
  });

  test('listDirectory throws NOT_FOUND when ancestors are missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JIANGUOYUN_409_BODY, { status: 409 }));

    await expect(listDirectory(config, '/Readest')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  test('a 409 without the AncestorsNotFound body still throws with status 409', async () => {
    fetchMock.mockResolvedValueOnce(new Response('conflict', { status: 409 }));

    await expect(getFile(config, '/Readest/library.json')).rejects.toMatchObject({
      status: 409,
    });
  });
});
