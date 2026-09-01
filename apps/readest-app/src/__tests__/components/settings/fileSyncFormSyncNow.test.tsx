import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearSyncDiagnostics,
  recordSyncDiagnostic,
} from '@/services/sync/diagnostics';
import { FileSyncError } from '@/services/sync/file/provider';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import { eventDispatcher } from '@/utils/event';

/**
 * The manual "Sync now" must keep the provider health surfaces honest: the
 * Cloud Sync chooser row and the SettingsMenu sync row read
 * `lastErrorByKind`, so a completed manual run has to clear a stale error
 * (server restarted, sync works again → "Sync failed" must not stick) and a
 * failed one has to record it.
 */

const syncLibrary = vi.fn();

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ loadLibraryBooks: async () => [] }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/sync/file/providerRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/file/providerRegistry')>();
  return { ...actual, createFileSyncProvider: vi.fn(async () => ({}) as never) };
});

vi.mock('@/services/sync/file/appLocalStore', () => ({
  createAppLocalStore: vi.fn(() => ({}) as never),
}));

vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: vi.fn(function (this: Record<string, unknown>) {
    this['syncLibrary'] = syncLibrary;
  }),
}));

import FileSyncForm from '@/components/settings/integrations/FileSyncForm';

const stored = {
  enabled: true,
  deviceId: 'd1',
  strategy: 'silent' as const,
  syncBooks: false,
};

const renderForm = () =>
  render(<FileSyncForm kind='webdav' stored={stored} persist={vi.fn(async () => {})} />);

beforeEach(() => {
  vi.clearAllMocks();
  clearSyncDiagnostics();
  syncLibrary.mockResolvedValue({ booksSynced: 1, failures: 0, totalBooks: 1, failedBooks: [] });
  useSettingsStore.setState({
    settings: { webdav: stored } as unknown as SystemSettings,
  } as never);
  useLibraryStore.setState({ library: [], libraryLoaded: true } as never);
  useFileSyncStore.setState({ byKind: {}, activeKind: null, lastErrorByKind: {} });
});

afterEach(() => {
  cleanup();
  clearSyncDiagnostics();
});

describe('FileSyncForm — Sync now health reporting', () => {
  test('a completed run clears a stale lastError', async () => {
    useFileSyncStore.getState().setLastError('webdav', 'server unreachable');
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBeNull();
    });
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    // Mutex released.
    expect(useFileSyncStore.getState().byKind.webdav?.isSyncing ?? false).toBe(false);
  });

  test('a failed run records lastError for the health surfaces', async () => {
    syncLibrary.mockRejectedValueOnce(new Error('boom'));
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBe('boom');
    });
    expect(useFileSyncStore.getState().byKind.webdav?.isSyncing ?? false).toBe(false);
  });

  test('a failed run surfaces the raw error detail in the toast', async () => {
    syncLibrary.mockRejectedValueOnce(
      new FileSyncError('Parent directory missing', 'CONFLICT', 409),
    );
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({
          type: 'error',
          message: 'Sync failed (status 409): Parent directory missing',
        }),
      );
    });
  });

  test('renders the diagnostics pane once sync requests were recorded', async () => {
    recordSyncDiagnostic({
      ts: Date.now(),
      backend: 'webdav',
      op: 'MKCOL',
      method: 'MKCOL',
      path: '/Readest/books',
      status: 409,
    });
    renderForm();

    expect(screen.getByText('Sync Diagnostics')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeTruthy();
    expect(screen.getByText('Show details')).toBeTruthy();
  });
});
