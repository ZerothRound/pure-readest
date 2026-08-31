import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The cloud sync provider kind for library data (book files, book rows,
 * progress, notes). 'readest' is the native Readest Cloud; the others are
 * the third-party file-sync backends.
 *
 * Providers are INDEPENDENT (#5062): any subset may sync the library at once,
 * including none. Readest Cloud's flag has a derived default so an absent value
 * reproduces the old exclusive behaviour; every third-party backend is a plain
 * per-device `enabled` flag. Account-level data (settings replicas, reading
 * stats, dictionaries/fonts, translations) always syncs via Readest Cloud while
 * signed in, regardless of this selection.
 */
export type CloudSyncProviderKind = 'readest' | FileSyncBackendKind;

/** Settings slice key for a third-party backend kind. */
export const settingsKeyForBackend = (
  kind: FileSyncBackendKind,
): 'webdav' | 'googleDrive' | 's3' | 'onedrive' | 'icloud' =>
  kind === 'gdrive' ? 'googleDrive' : kind;

/** Human-readable provider name (product names — deliberately untranslated). */
export const cloudProviderDisplayName = (kind: CloudSyncProviderKind): string =>
  kind === 'gdrive'
    ? 'Google Drive'
    : kind === 'webdav'
      ? 'WebDAV'
      : kind === 's3'
        ? 'S3'
        : kind === 'onedrive'
          ? 'OneDrive'
          : kind === 'icloud'
            ? 'iCloud'
            : 'Readest Cloud';

/**
 * The third-party backends the user has switched on, in a STABLE order that
 * every loop, list, and sync pass in the app relies on.
 */
export const getEnabledFileSyncBackends = (
  settings: SystemSettings | null | undefined,
): FileSyncBackendKind[] => {
  const enabled: FileSyncBackendKind[] = [];
  if (settings?.webdav?.enabled) enabled.push('webdav');
  if (settings?.googleDrive?.enabled) enabled.push('gdrive');
  if (settings?.s3?.enabled) enabled.push('s3');
  if (settings?.onedrive?.enabled) enabled.push('onedrive');
  if (settings?.icloud?.enabled) enabled.push('icloud');
  return enabled;
};

/** Any third-party file-sync backend switched on. */
export const hasAnyThirdPartyEnabled = (settings: SystemSettings | null | undefined): boolean =>
  getEnabledFileSyncBackends(settings).length > 0;

/**
 * Whether Readest Cloud syncs the library channels on this device.
 *
 * Readest Cloud is the official account-backed sync and is removed in this
 * fork (pure-readest): there is no Readest account, so it is NEVER enabled,
 * regardless of what a settings backup from upstream may contain. Third-party
 * backends (WebDAV, Drive, S3, OneDrive, iCloud) are the only cloud sync
 * providers and need no account.
 */
export const isReadestCloudEnabled = (_settings: SystemSettings | null | undefined): boolean =>
  false;

/** Every provider syncing the library on this device, Readest Cloud first. */
export const getCloudSyncProviders = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind[] => [
  ...(isReadestCloudEnabled(settings) ? (['readest'] as const) : []),
  ...getEnabledFileSyncBackends(settings),
];

/** Comma-joined product names, for the "Synced via {{provider}}" copy. */
export const cloudProvidersDisplayName = (kinds: CloudSyncProviderKind[]): string =>
  kinds.map(cloudProviderDisplayName).join(', ');

export interface CloudSyncGate {
  /** Readest Cloud syncs the library channels (rows, progress, notes, files). */
  readest: boolean;
  /** Third-party backends the user switched on, in stable provider order. */
  backends: FileSyncBackendKind[];
  paused: false;
}

export const resolveCloudSyncGate = (
  settings: SystemSettings | null | undefined,
): CloudSyncGate => {
  const backends = getEnabledFileSyncBackends(settings);
  return {
    readest: isReadestCloudEnabled(settings),
    backends,
    paused: false,
  };
};

/** Every enabled third-party backend may run without an account or plan. */
export const getActiveFileSyncBackends = (
  settings: SystemSettings | null | undefined,
): FileSyncBackendKind[] => resolveCloudSyncGate(settings).backends;

/**
 * One-time provider migration helper (appService migrate20260706): users
 * who already had WebDAV/Drive enabled before provider selection shipped
 * become "third-party selected" on migration. With syncBooks at its old
 * `false` default their
 * books would back up nowhere. Flip syncBooks on for every enabled backend.
 * Mutates `settings` in place (the migration runner saves the same
 * snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  let changed = false;
  for (const kind of getEnabledFileSyncBackends(settings)) {
    // A switch (rather than a generically-keyed write) keeps each branch's
    // settings slice type intact; `settings[key] = { ...slice, syncBooks }`
    // does not typecheck when `key` is a union of literal keys.
    switch (kind) {
      case 'webdav':
        if (settings.webdav && !settings.webdav.syncBooks) {
          settings.webdav = { ...settings.webdav, syncBooks: true };
          changed = true;
        }
        break;
      case 'gdrive':
        if (settings.googleDrive && !settings.googleDrive.syncBooks) {
          settings.googleDrive = { ...settings.googleDrive, syncBooks: true };
          changed = true;
        }
        break;
      case 's3':
        if (settings.s3 && !settings.s3.syncBooks) {
          settings.s3 = { ...settings.s3, syncBooks: true };
          changed = true;
        }
        break;
      case 'onedrive':
        if (settings.onedrive && !settings.onedrive.syncBooks) {
          settings.onedrive = { ...settings.onedrive, syncBooks: true };
          changed = true;
        }
        break;
      case 'icloud':
        if (settings.icloud && !settings.icloud.syncBooks) {
          settings.icloud = { ...settings.icloud, syncBooks: true };
          changed = true;
        }
        break;
    }
  }
  return changed;
};

/**
 * Whether Readest Cloud storage may be written to (book file uploads and the
 * native book/progress/note rows). Now simply "is Readest Cloud switched on" —
 * it no longer means "and nothing else is". A user can mirror to Drive AND keep
 * Readest Cloud; whether book *files* also go to Readest is still governed
 * separately by the Manage Sync "book" toggle and the transfer queue.
 */
export const isReadestCloudStorageActive = (
  settings: SystemSettings | null | undefined,
): boolean => isReadestCloudEnabled(settings);
