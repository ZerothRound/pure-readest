import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Auto library sync is intentionally disabled in this build: sync only runs
 * from explicit user actions (SettingsMenu sync row, pull-to-refresh, the
 * integration "Sync now" buttons), which call `runFileLibrarySyncPass`
 * directly. The hook is a documented no-op, so it must never fire a pass —
 * not on mount, not on library changes, not after any debounce window.
 */

const routing = vi.hoisted(() => ({
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileLibrarySyncPass = vi.hoisted(() =>
  vi.fn(async (): Promise<{ booksSynced: number } | null> => null),
);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free' }),
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileLibrarySyncPass,
}));

const { useLibraryFileSync } = await import('@/app/library/hooks/useLibraryFileSync');
const { useLibraryStore } = await import('@/store/libraryStore');

const book = (hash: string): Book =>
  ({
    hash,
    title: hash,
  }) as Book;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  routing.backends = [];
  useLibraryStore.setState({ library: [], libraryLoaded: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLibraryFileSync (auto-sync disabled)', () => {
  it('never fires a sync pass on mount, library changes, or after the debounce window', async () => {
    routing.backends = ['webdav'];

    const { rerender } = renderHook(() => useLibraryFileSync());

    act(() => {
      useLibraryStore.setState({ library: [book('a')], libraryLoaded: true });
    });
    rerender();
    act(() => {
      vi.advanceTimersByTime(1_000);
      useLibraryStore.setState({ library: [book('a'), book('b')], libraryLoaded: true });
    });
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
  });

  it('stays a no-op even when backends are active and the library is loaded', async () => {
    routing.backends = ['webdav', 'gdrive'];
    useLibraryStore.setState({ library: [book('a')], libraryLoaded: true });

    renderHook(() => useLibraryFileSync());

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
  });
});
