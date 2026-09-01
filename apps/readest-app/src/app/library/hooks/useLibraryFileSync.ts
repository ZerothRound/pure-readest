/**
 * Library-scoped auto-sync for third-party backends is intentionally
 * DISABLED in this build: sync must only ever run from an explicit user
 * action ("Sync now", the library SettingsMenu sync row, pull-to-refresh).
 * Those surfaces call {@link runFileLibrarySyncPass} directly, so this hook
 * is a no-op placeholder that documents the decision at the call site.
 */
export const useLibraryFileSync = (): void => {
  // No-op: automatic library sync is disabled.
};
