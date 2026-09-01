import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AppService } from '@/types/system';
import type { ABSServer } from '@/types/audiobookshelf';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const appService = {} as AppService;
const envConfig = { getAppService: async () => appService } as EnvConfigType;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig }),
}));
// absServerStore publishes replica upserts/deletes from its mutators; those
// aren't exercised here (state is seeded directly via setState), but the
// module still imports replicaPublish at load time.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));
vi.mock('@/services/audiobookshelf/librarySync', () => ({
  syncAllAbsServers: vi.fn(),
  backfillAbsCovers: vi.fn(),
}));

import { backfillAbsCovers, syncAllAbsServers } from '@/services/audiobookshelf/librarySync';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { useABSSync } from '@/hooks/useABSSync';

const mockedSync = vi.mocked(syncAllAbsServers);
const mockedBackfill = vi.mocked(backfillAbsCovers);

// contentId/addedAt already set so loadABSServers' backfill is a no-op and
// doesn't fire an unrelated saveSettings call.
const server: ABSServer = {
  id: 's1',
  contentId: 's1',
  addedAt: 1,
  name: 'Home',
  url: 'http://abs.local',
};

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    absServers: [],
    ...overrides,
  }) as unknown as SystemSettings;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  useABSServerStore.setState({ servers: [] });
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useABSServerStore.setState({ servers: [] });
});

describe('useABSSync', () => {
  test('does not sync on mount even when servers are already hydrated', async () => {
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();

    expect(mockedSync).not.toHaveBeenCalled();
  });

  test('does not sync or backfill covers on mount', async () => {
    useABSServerStore.setState({ servers: [server] });
    const order: string[] = [];
    mockedBackfill.mockImplementation(async () => {
      order.push('backfill');
    });
    mockedSync.mockImplementation(async () => {
      order.push('sync');
    });

    renderHook(() => useABSSync());
    await settle();

    expect(order).toEqual([]);
    expect(mockedBackfill).not.toHaveBeenCalled();
    expect(mockedSync).not.toHaveBeenCalled();
  });

  test('does not sync when neither the store nor settings have servers', async () => {
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();

    expect(mockedSync).not.toHaveBeenCalled();
  });

  // Manual sync must still hydrate before the empty-store no-op check runs.
  test('re-hydrates before a manual sync-abs-servers event runs', async () => {
    useSettingsStore.setState({ settings: {} as SystemSettings });
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();
    expect(mockedSync).not.toHaveBeenCalled();

    // Settings land before the user clicks Sync Now.
    useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
    await act(async () => {
      await eventDispatcher.dispatch('sync-abs-servers');
    });

    expect(useABSServerStore.getState().getAvailableServers()).toEqual([server]);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  test('the sync-abs-servers event triggers a run', async () => {
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();
    expect(mockedSync).not.toHaveBeenCalled();

    useABSServerStore.setState({ servers: [server] });
    await act(async () => {
      await eventDispatcher.dispatch('sync-abs-servers');
    });

    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  test('no periodic timer exists — advancing time after mount never syncs', async () => {
    vi.useFakeTimers();
    try {
      useABSServerStore.setState({ servers: [server] });
      useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
      mockedSync.mockResolvedValue();

      const { unmount } = renderHook(() => useABSSync());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockedSync).not.toHaveBeenCalled();

      unmount();
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      expect(mockedSync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
