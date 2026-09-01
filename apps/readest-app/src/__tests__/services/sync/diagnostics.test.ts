import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSyncDiagnostics,
  formatSyncDiagnostics,
  formatWebDAVRequestPath,
  getSyncDiagnostics,
  recordSyncDiagnostic,
} from '@/services/sync/diagnostics';

describe('sync diagnostics', () => {
  beforeEach(() => {
    clearSyncDiagnostics();
  });

  afterEach(() => {
    clearSyncDiagnostics();
  });

  it('records entries in order and exposes them', () => {
    recordSyncDiagnostic({
      ts: 1,
      backend: 'webdav',
      op: 'MKCOL',
      method: 'MKCOL',
      path: '/Readest/books',
      status: 409,
      durationMs: 12,
    });
    recordSyncDiagnostic({
      ts: 2,
      backend: 'webdav',
      op: 'mkdir-409',
      method: 'MKCOL',
      path: '/Readest/books',
      status: 409,
      detail: 'inconclusive',
    });

    expect(getSyncDiagnostics().map((e) => e.op)).toEqual(['MKCOL', 'mkdir-409']);
  });

  it('caps the ring buffer at 500 entries', () => {
    for (let i = 0; i < 520; i++) {
      recordSyncDiagnostic({ ts: i, backend: 'webdav', op: `op-${i}` });
    }

    const entries = getSyncDiagnostics();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.op).toBe('op-20');
    expect(entries[499]?.op).toBe('op-519');
  });

  it('formats entries into copyable plain text without empty fields', () => {
    recordSyncDiagnostic({
      ts: 1700000000000,
      backend: 'webdav',
      op: 'PUT',
      method: 'PUT',
      path: '/Readest/library.json',
      status: 409,
      durationMs: 42,
      detail: 'exists',
    });

    const text = formatSyncDiagnostics(getSyncDiagnostics(), { backend: 'webdav' });
    expect(text).toContain('pure-readest sync diagnostics');
    expect(text).toContain('backend: webdav');
    expect(text).toContain('PUT /Readest/library.json -> 409 (42ms) exists');
    expect(text).not.toContain('undefined');
  });

  it('redacts credentials, query strings, and fragments from WebDAV paths', () => {
    expect(
      formatWebDAVRequestPath('https://user:secret@dav.example.com/root/?a=1#frag', '/Readest/books'),
    ).toBe('https://dav.example.com/root/Readest/books');
  });
});
