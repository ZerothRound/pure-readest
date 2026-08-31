import { describe, test, expect } from 'vitest';
import type { SystemSettings } from '@/types/settings';

import {
  applySyncBooksAutoEnable,
  cloudProviderDisplayName,
  cloudProvidersDisplayName,
  getActiveFileSyncBackends,
  getCloudSyncProviders,
  getEnabledFileSyncBackends,
  isReadestCloudEnabled,
  isReadestCloudStorageActive,
  resolveCloudSyncGate,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...overrides,
  }) as SystemSettings;

const s = (partial: Partial<SystemSettings>): SystemSettings => partial as SystemSettings;

describe('resolveCloudSyncGate', () => {
  test('Readest Cloud is removed in this fork, so only file backends are ever reported', () => {
    expect(resolveCloudSyncGate(makeSettings())).toEqual({
      readest: false,
      backends: [],
      paused: false,
    });
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings)).toEqual({
      readest: false,
      backends: ['webdav'],
      paused: false,
    });
  });

  test('every configured third-party provider is active', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings)).toEqual({
      readest: false,
      backends: ['gdrive'],
      paused: false,
    });
    expect(getActiveFileSyncBackends(settings)).toEqual(['gdrive']);
  });
});

describe('applySyncBooksAutoEnable (upgrade migration for already-enabled providers)', () => {
  test('flips syncBooks on for an enabled webdav provider, mutating the given settings', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
  });

  test('flips syncBooks on for an enabled gdrive provider', () => {
    const settings = makeSettings({
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });

  test('no-op when readest is the provider', () => {
    const settings = makeSettings();
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
    expect(settings.webdav?.syncBooks).toBeUndefined();
  });

  test('no-op when syncBooks is already on', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: true },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
  });

  test('flips syncBooks on for every enabled provider when multiple are enabled', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });
});

describe('isReadestCloudStorageActive', () => {
  test('always false because Readest Cloud (official account) is removed', () => {
    expect(isReadestCloudStorageActive(makeSettings())).toBe(false);
  });

  test('false when a third-party provider is selected', () => {
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings)).toBe(false);
  });

  test('third-party providers do not silently enable Readest Cloud', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings)).toBe(false);
  });
});

describe('settingsKeyForBackend', () => {
  test('maps each backend kind to its settings slice', () => {
    expect(settingsKeyForBackend('webdav')).toBe('webdav');
    expect(settingsKeyForBackend('gdrive')).toBe('googleDrive');
    expect(settingsKeyForBackend('s3')).toBe('s3');
    expect(settingsKeyForBackend('onedrive')).toBe('onedrive');
  });
});

describe('cloudProviderDisplayName', () => {
  test('names every provider kind', () => {
    expect(cloudProviderDisplayName('webdav')).toBe('WebDAV');
    expect(cloudProviderDisplayName('gdrive')).toBe('Google Drive');
    expect(cloudProviderDisplayName('s3')).toBe('S3');
    expect(cloudProviderDisplayName('onedrive')).toBe('OneDrive');
    expect(cloudProviderDisplayName('readest')).toBe('Readest Cloud');
  });
});

// Moved from src/__tests__/services/sync/file/providerRegistry.test.ts: the
// function itself moved from providerRegistry.ts into this module.
describe('getEnabledFileSyncBackends', () => {
  test('lists only switched-on backends in a stable order', () => {
    expect(getEnabledFileSyncBackends(s({}))).toEqual([]);
    expect(getEnabledFileSyncBackends(s({ webdav: { enabled: true } } as never))).toEqual([
      'webdav',
    ]);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'gdrive']);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: false }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['gdrive']);
  });

  test("getEnabledFileSyncBackends includes 'onedrive' when enabled", () => {
    expect(getEnabledFileSyncBackends(s({ onedrive: { enabled: true } } as never))).toContain(
      'onedrive',
    );
  });
});

describe('isReadestCloudEnabled (removed in this fork)', () => {
  test('always false, regardless of settings, because Readest Cloud is removed', () => {
    expect(isReadestCloudEnabled(s({}))).toBe(false);
  });

  test('absent field with a third-party enabled means Readest Cloud is off (legacy exclusive)', () => {
    expect(isReadestCloudEnabled(s({ googleDrive: { enabled: true } as never }))).toBe(false);
  });

  test('an explicit readestCloud.enabled=true is still ignored', () => {
    const settings = s({
      googleDrive: { enabled: true } as never,
      readestCloud: { enabled: true },
    });
    expect(isReadestCloudEnabled(settings)).toBe(false);
  });

  test('explicit false wins when nothing else is enabled', () => {
    expect(isReadestCloudEnabled(s({ readestCloud: { enabled: false } }))).toBe(false);
  });
});

describe('getCloudSyncProviders', () => {
  test('returns no providers by default (Readest Cloud removed)', () => {
    expect(getCloudSyncProviders(s({}))).toEqual([]);
  });

  test('returns every enabled backend in fixed order', () => {
    const settings = s({
      readestCloud: { enabled: true },
      onedrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    expect(getCloudSyncProviders(settings)).toEqual(['webdav', 'onedrive']);
  });

  test('returns an empty list when everything is off', () => {
    expect(getCloudSyncProviders(s({ readestCloud: { enabled: false } }))).toEqual([]);
  });
});

describe('resolveCloudSyncGate (readest + backends together)', () => {
  test('reports backends only (readest never enabled)', () => {
    const settings = s({
      readestCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings);
    expect(gate).toEqual({ readest: false, backends: ['gdrive'], paused: false });
  });

  test('keeps every enabled backend active', () => {
    const settings = s({
      readestCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings);
    expect(gate.readest).toBe(false);
    expect(gate.backends).toEqual(['webdav', 'gdrive']);
    expect(getActiveFileSyncBackends(settings)).toEqual(['webdav', 'gdrive']);
  });
});

describe('isReadestCloudStorageActive (removed in this fork)', () => {
  test('never reports Readest Cloud storage, even when settings enable it', () => {
    const both = s({ readestCloud: { enabled: true }, webdav: { enabled: true } as never });
    expect(isReadestCloudStorageActive(both)).toBe(false);
    const off = s({ readestCloud: { enabled: false }, webdav: { enabled: true } as never });
    expect(isReadestCloudStorageActive(off)).toBe(false);
  });
});

describe('cloudProvidersDisplayName', () => {
  test('joins provider names for the "synced via" copy', () => {
    expect(cloudProvidersDisplayName(['readest', 'gdrive'])).toBe('Readest Cloud, Google Drive');
  });
});

describe('icloud backend kind', () => {
  test('getEnabledFileSyncBackends appends icloud last', () => {
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, icloud: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'icloud']);
  });

  test('settingsKeyForBackend maps icloud to its own slice', () => {
    expect(settingsKeyForBackend('icloud')).toBe('icloud');
  });

  test('cloudProviderDisplayName names iCloud', () => {
    expect(cloudProviderDisplayName('icloud')).toBe('iCloud');
  });

  test('applySyncBooksAutoEnable flips syncBooks on for an enabled icloud', () => {
    const settings = s({ icloud: { enabled: true, syncBooks: false } } as never);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.icloud?.syncBooks).toBe(true);
  });
});
