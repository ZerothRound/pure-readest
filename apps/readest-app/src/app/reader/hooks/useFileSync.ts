import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError } from '@/services/sync/file/provider';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import { canBackendRun } from '@/services/sync/file/runLibrarySync';
import {
  getActiveFileSyncBackends,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { syncLegadoBook } from '@/services/sync/legado/sync';
import { cfiFromLegadoProgress } from '@/services/sync/legado/position';
import { legadoProgressFromRange } from '@/services/sync/legado/position';

const providerSupportsLegado = (provider: unknown): provider is {
  ensureDir: (paths: string[]) => Promise<void>;
  readText: (path: string) => Promise<string | null>;
  writeText: (path: string, body: string, contentType?: string) => Promise<void>;
  writeBinary: (path: string, body: ArrayBuffer, contentType?: string) => Promise<void>;
} => {
  if (!provider || typeof provider !== 'object') return false;
  const candidate = provider as Record<string, unknown>;
  return (
    typeof candidate['ensureDir'] === 'function' &&
    typeof candidate['readText'] === 'function' &&
    typeof candidate['writeText'] === 'function' &&
    typeof candidate['writeBinary'] === 'function'
  );
};

/**
 * Per-book file-sync hook — drives EVERY enabled third-party backend at once.
 *
 * Cloud sync providers are independently selectable (#5062): several
 * third-party backends (WebDAV, Google Drive, S3, OneDrive) can mirror a
 * book's progress and annotations in parallel, alongside (or instead of)
 * Readest Cloud, whose native progress sync is `useProgressSync`'s job, not
 * this hook's, and runs independently.
 *
 * The hook is called exactly once per book (React forbids a variable hook
 * count), so every scalar the single-backend version used to hold —
 * `activeKind`, `providerSettings`, `engineKey`, `isReady`, `allowPush` /
 * `allowPull`, and the per-book locks (`fileSyncedRef`, `coverSyncedRef`) —
 * is a per-backend collection here, and the four sync operations (push
 * config, pull config, push book file, push cover) loop over the enabled
 * backends instead of touching one.
 *
 * Failure isolation: one backend throwing must not stop the others from
 * pushing or pulling — redundancy is worthless if a dead mirror takes the
 * live one down with it. Every per-backend operation is wrapped in its own
 * try/catch.
 *
 * Merge chaining (the subtle part): `engine.pullBookConfig(book, config)`
 * merges `config` with that backend's remote and returns the merged result.
 * Pulling from several backends CHAINS — backend 2 must merge on top of the
 * config backend 1 already merged, so the final config reflects every
 * mirror. Pulling all of them against the ORIGINAL local config and keeping
 * one result would silently drop whichever mirror lost the race.
 *
 * Energy budget — these constants are deliberately tuned for mobile:
 *   - Push debounce: 5 s. Long enough to collapse a swipe burst into one PUT,
 *     short enough that an ordinary page-turn cadence (well over 5 s per page)
 *     still publishes each position instead of resetting the timer forever.
 *   - Pull cooldown: 60 s. Window focus shouldn't trigger a fresh fetch on every
 *     alt-tab; once a minute is plenty for cross-device drift.
 *   - Open-pull skip: 30 s. Quickly closing/reopening a book shouldn't re-fetch
 *     the same config that's already current in memory.
 *
 * Strategy semantics — same vocabulary as KOSync, evaluated per backend:
 *   - 'silent' (default): always push and always pull, latest writer wins
 *   - 'send':   push only, never pull (this device feeds others)
 *   - 'receive': pull only, never push (this device follows others)
 *   - 'prompt': not implemented — falls back to 'silent'
 */

/**
 * Debounce window for the manual push path. A click flushes immediately, so
 * the debounce only coalesces rapid successive manual triggers.
 */
const PUSH_DEBOUNCE_MS = 5_000;

/**
 * Whether a pull actually landed a remote reading position: the merged
 * location exists and differs from what this device already had. Drives the
 * same top-right "Reading Progress Synced" hint the native cloud sync shows,
 * so WebDAV / Google Drive give equal feedback.
 */
export const remoteProgressApplied = (
  localLocation: string | null | undefined,
  mergedLocation: string | null | undefined,
): boolean => !!mergedLocation && mergedLocation !== localLocation;

export const useFileSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const getViewsById = useReaderStore((s) => s.getViewsById);
  const getView = useReaderStore((s) => s.getView);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  // Every enabled third-party backend syncs this book in parallel (#5062);
  // Readest Cloud's native progress sync is useProgressSync's job, not this
  // hook's, and runs independently.
  const activeKinds = useMemo(
    () => getActiveFileSyncBackends(settings),
    [settings],
  );

  /** Flips true on the first local change after a push, false right before each push. */
  const dirtyRef = useRef(false);
  /** Backends whose book binary this instance already pushed. */
  const fileSyncedRef = useRef(new Set<FileSyncBackendKind>());
  /** Backends whose cover this instance already pushed. */
  const coverSyncedRef = useRef(new Set<FileSyncBackendKind>());
  /**
   * One-shot guard PER BACKEND so an expired session toasts once, not on
   * every page-turn — a `Set` rather than a single boolean, because one
   * backend can be healthy while a sibling's session is expired, and each
   * must be notified (and re-armed) independently.
   */
  const authNotifiedRef = useRef(new Set<FileSyncBackendKind>());

  // Switching the enabled backend SET mid-session resets the per-book locks so
  // newly-active backends do a fresh pull-on-open and re-check file/cover.
  const activeKindsKey = activeKinds.join(',');
  useEffect(() => {
    fileSyncedRef.current.clear();
    coverSyncedRef.current.clear();
    dirtyRef.current = false;
    authNotifiedRef.current.clear();
  }, [activeKindsKey]);

  // Per-backend settings slice + strategy helpers, replacing the old single
  // `providerSettings` / `allowPush` / `allowPull`.
  const sliceFor = useCallback(
    (kind: FileSyncBackendKind) => settings[settingsKeyForBackend(kind)],
    [settings],
  );
  const allowsPush = useCallback(
    (kind: FileSyncBackendKind) => (sliceFor(kind)?.strategy ?? 'silent') !== 'receive',
    [sliceFor],
  );
  const allowsPull = useCallback(
    (kind: FileSyncBackendKind) => (sliceFor(kind)?.strategy ?? 'silent') !== 'send',
    [sliceFor],
  );

  // Read latest settings from the store (not the closure) when patching a
  // backend's slice: pull → push can fire back-to-back when a book opens, and
  // a closure-based merge could clobber a sibling write.
  const ensureDeviceId = useCallback(
    (kind: FileSyncBackendKind): string => {
      const latest = useSettingsStore.getState().settings;
      const key = settingsKeyForBackend(kind);
      let id = latest[key]?.deviceId;
      if (!id) {
        id = uuidv4();
        const next = { ...latest, [key]: { ...latest[key], deviceId: id } };
        setSettings(next);
        saveSettings(envConfig, next);
      }
      return id;
    },
    [envConfig, setSettings, saveSettings],
  );

  /**
   * Stamp `lastSyncedAt` for every kind in `kinds` in ONE settings write —
   * looping backends through the single-kind version would persist the whole
   * settings file once per backend, and with 4 enabled backends that is 4
   * full writes per push cycle (every `PUSH_DEBOUNCE_MS` while reading) where
   * the single-backend original did 1. Reads the latest settings from the
   * store (not a closure) because pull and push can fire back-to-back on
   * book open, and a closure-based merge would clobber a sibling write.
   */
  const updateLastSyncedAt = useCallback(
    async (kinds: FileSyncBackendKind[], ts: number) => {
      if (kinds.length === 0) return;
      let next = useSettingsStore.getState().settings;
      for (const kind of kinds) {
        // A switch (rather than a generically-keyed write) keeps each
        // branch's settings slice type intact; `next[key] = { ...slice, ts }`
        // does not typecheck when `key` is a union of literal keys.
        switch (kind) {
          case 'webdav':
            next = { ...next, webdav: { ...next.webdav, lastSyncedAt: ts } };
            break;
          case 'gdrive':
            next = { ...next, googleDrive: { ...next.googleDrive, lastSyncedAt: ts } };
            break;
          case 's3':
            next = { ...next, s3: { ...next.s3, lastSyncedAt: ts } };
            break;
          case 'onedrive':
            next = { ...next, onedrive: { ...next.onedrive, lastSyncedAt: ts } };
            break;
          case 'icloud':
            next = { ...next, icloud: { ...next.icloud, lastSyncedAt: ts } };
            break;
        }
      }
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [envConfig, setSettings, saveSettings],
  );

  // The engine list is built asynchronously: Google Drive probes the OS
  // keychain to assemble its token store. Keyed on the connection-relevant
  // settings (not the whole settings object) so a `lastSyncedAt` write doesn't
  // rebuild it — which for Drive would re-probe the keychain on every push.
  const engineKey = useMemo(() => {
    const w = settings.webdav;
    const c = settings.s3;
    return [
      activeKindsKey,
      `webdav:${w?.serverUrl}:${w?.username}:${w?.password}:${w?.rootPath}`,
      `gdrive:${settings.googleDrive?.enabled}`,
      `s3:${c?.endpoint}:${c?.region}:${c?.bucket}:${c?.accessKeyId}:${c?.secretAccessKey}`,
      `onedrive:${settings.onedrive?.enabled}`,
    ].join('|');
  }, [activeKindsKey, settings.webdav, settings.googleDrive, settings.s3, settings.onedrive]);

  const [engines, setEngines] = useState<
    Array<{ kind: FileSyncBackendKind; engine: FileSyncEngine }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    setEngines([]);
    if (!appService || activeKinds.length === 0) return;
    (async () => {
      const current = useSettingsStore.getState().settings;
      const built: Array<{ kind: FileSyncBackendKind; engine: FileSyncEngine }> = [];
      for (const kind of activeKinds) {
        // Same transport gate the library pass uses — an expired web Drive token
        // would otherwise abort every push and pull with a terminal AUTH_FAILED.
        if (!canBackendRun(kind)) continue;
        const provider = await createFileSyncProvider(kind, current);
        if (!provider) continue;
        const store = createAppLocalStore({ appService, settings: current, envConfig });
        built.push({ kind, engine: new FileSyncEngine(provider, store) });
      }
      if (!cancelled) setEngines(built);
    })();
    return () => {
      cancelled = true;
    };
    // `engineKey` captures the connection-relevant settings; the rest is read
    // fresh inside the effect so unrelated settings writes don't rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineKey, appService, envConfig]);

  const isReady = engines.length > 0;

  /**
   * Notify (once) that a backend's session expired so the user knows to
   * reconnect — a single top-right reader `hint` (same affordance as the
   * native "Reading Progress Synced" hint), NOT a per-failure error toast.
   * Reset on a successful sync / backend-set change.
   */
  const notifyAuthExpiredOnce = useCallback(
    (kind: FileSyncBackendKind) => {
      if (authNotifiedRef.current.has(kind)) return;
      authNotifiedRef.current.add(kind);
      eventDispatcher.dispatch('hint', {
        bookKey,
        timeout: 5000,
        message:
          kind === 'gdrive' ? _('Google Drive session expired') : _('Cloud sync session expired'),
      });
    },
    [bookKey, _],
  );

  /** Map a sync error: surface an expired session once, log everything. */
  const handleSyncError = useCallback(
    (kind: FileSyncBackendKind, label: string, e: unknown) => {
      if (e instanceof FileSyncError && e.code === 'AUTH_FAILED') notifyAuthExpiredOnce(kind);
      console.warn(label, kind, e);
    },
    [notifyAuthExpiredOnce],
  );

  /**
   * Push the latest config (progress + booknotes) to every backend that
   * allows it. One backend failing must not stop the others.
   */
  const pushNow = useCallback(async () => {
    if (!isReady) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    const pushedKinds: FileSyncBackendKind[] = [];
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      const ps = sliceFor(kind);
      const wantProgress = ps?.syncProgress ?? true;
      const wantNotes = ps?.syncNotes ?? true;
      if (!wantProgress && !wantNotes) continue;
      try {
        const legadoOnly = kind === 'webdav' && settings.webdav?.syncFormat === 'legado';
        if (!legadoOnly) {
          await engine.pushBookConfig(book, config, ensureDeviceId(kind));
        }
        if (kind === 'webdav') {
          const ws = settings.webdav;
          const format = ws?.syncFormat ?? 'both';
          // Legado's wire format only carries reading progress. Respect the
          // per-provider progress toggle even when notes are enabled (notes
          // continue through the normal Readest payload in `both` mode).
          if (format !== 'readest' && wantProgress) {
            const provider = await createFileSyncProvider(kind, settings);
            if (providerSupportsLegado(provider) && ws) {
              // Book binaries are handled by pushBookFileNow; progress pushes
              // never re-read or re-upload the book.
              const mode = allowsPull(kind) ? 'silent' : 'send';
              const currentProgress = getBookProgress(bookKey);
              const legadoConfig =
                currentProgress?.range
                  ? {
                      ...config,
                      legadoProgress: legadoProgressFromRange(
                        book,
                        currentProgress.section.current,
                        currentProgress.range,
                        currentProgress.sectionLabel,
                      ),
                    }
                  : config;
              const legado = await syncLegadoBook(
                provider,
                ws.legadoRootPath ?? '/legado',
                book,
                legadoConfig,
                format,
                undefined,
                mode,
              );
              if (legado.config !== config)
                await saveConfig(envConfig, bookKey, legado.config, settings);
            }
          }
        }
        // This backend's session is proven live — clear its own expired-auth
        // notice without touching a sibling's (still-expired) one.
        authNotifiedRef.current.delete(kind);
        pushedKinds.push(kind);
      } catch (e) {
        handleSyncError(kind, 'file sync push failed', e);
      }
    }
    if (pushedKinds.length > 0) {
      dirtyRef.current = false;
      await updateLastSyncedAt(pushedKinds, Date.now());
    }
  }, [
    isReady,
    bookKey,
    engines,
    getConfig,
    getBookData,
    allowsPush,
    allowsPull,
    sliceFor,
    ensureDeviceId,
    appService,
    envConfig,
    settings,
    saveConfig,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Upload the book binary to every backend with syncBooks on. Cheap on the
   * steady state (a single HEAD per book per backend per session); re-runs
   * within the same instance no-op via `fileSyncedRef`.
   */
  const pushBookFileNow = useCallback(async () => {
    if (!isReady) return;
    const book = getBookData(bookKey)?.book;
    if (!book) return;
    const uploadedKinds: FileSyncBackendKind[] = [];
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      if (!(sliceFor(kind)?.syncBooks ?? false)) continue;
      if (fileSyncedRef.current.has(kind)) continue;
      fileSyncedRef.current.add(kind);
      try {
        const legadoOnly = kind === 'webdav' && settings.webdav?.syncFormat === 'legado';
        let uploaded = false;
        if (!legadoOnly) {
          const result = await engine.pushBookFile(book);
          uploaded = result.uploaded;
        }
        if (kind === 'webdav') {
          const ws = settings.webdav;
          const format = ws?.syncFormat ?? 'both';
          const provider =
            format !== 'readest' && appService && ws
              ? await createFileSyncProvider(kind, settings)
              : null;
          if (providerSupportsLegado(provider) && appService && ws) {
            const localStore = createAppLocalStore({ appService, settings, envConfig });
            const bytes = await localStore.loadBookFile(book);
            if (bytes) {
              const legado = await syncLegadoBook(
                provider,
                ws.legadoRootPath ?? '/legado',
                book,
                getConfig(bookKey) ?? { updatedAt: Date.now() },
                format,
                bytes.bytes,
                'send',
                false,
              );
              uploaded = uploaded || legado.result.bookUploaded;
            }
          }
        }
        if (uploaded) uploadedKinds.push(kind);
      } catch (e) {
        // Reset this backend's lock so a later trigger retries it.
        fileSyncedRef.current.delete(kind);
        handleSyncError(kind, 'file sync book push failed', e);
      }
    }
    if (uploadedKinds.length > 0) await updateLastSyncedAt(uploadedKinds, Date.now());
  }, [
    isReady,
    engines,
    bookKey,
    getBookData,
    getConfig,
    allowsPush,
    sliceFor,
    settings,
    appService,
    envConfig,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Push the local cover image to every backend, independent of `syncBooks` —
   * covers are part of the book's metadata and the receiving device can't
   * regenerate them without the book bytes. Best-effort: a missing local
   * cover silently no-ops.
   */
  const pushBookCoverNow = useCallback(async () => {
    if (!isReady) return;
    const book = getBookData(bookKey)?.book;
    if (!book) return;
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      // Legado has no Readest cover slot. Leave the lock untouched so that a
      // later switch to `both` can still upload the cover.
      if (kind === 'webdav' && settings.webdav?.syncFormat === 'legado') continue;
      if (coverSyncedRef.current.has(kind)) continue;
      coverSyncedRef.current.add(kind);
      try {
        await engine.pushBookCover(book);
      } catch (e) {
        coverSyncedRef.current.delete(kind);
        handleSyncError(kind, 'file sync cover push failed', e);
      }
    }
  }, [isReady, engines, bookKey, getBookData, allowsPush, settings, handleSyncError]);

  /**
   * Pull, merge, and persist from every backend that allows it, CHAINING the
   * merges: each backend merges on top of the config the previous backend
   * already merged, so the final config reflects every mirror. Pulling all of
   * them against the ORIGINAL local config and keeping one result would
   * silently drop whichever mirror lost the race. Returns `true` when at
   * least one backend had a payload to merge.
   *
   * Sub-toggle masking happens INSIDE the loop, per backend: `pullBookConfig`
   * merges a backend's WHOLE remote into `working` regardless of that
   * backend's own `syncProgress` / `syncNotes` toggles, so a backend that
   * opted out of a field must have that field reverted to its pre-merge value
   * right after its own merge — otherwise its remote data for an opted-out
   * field rides in on a sibling backend's opt-in (a union computed once at
   * the end would let exactly that happen).
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!isReady) return false;
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return false;

    let working = config;
    let applied = false;
    let mergedNotes: BookNote[] | undefined;
    const pulledKinds: FileSyncBackendKind[] = [];

    for (const { kind, engine } of engines) {
      if (!allowsPull(kind)) continue;
      const ps = sliceFor(kind);
      const wantProgress = ps?.syncProgress ?? true;
      const wantNotes = ps?.syncNotes ?? true;
      if (!wantProgress && !wantNotes) continue;
      const before = working;
      try {
        const legadoOnly = kind === 'webdav' && settings.webdav?.syncFormat === 'legado';
        const result = legadoOnly
          ? { applied: false as const }
          : await engine.pullBookConfig(book, working);
        // This backend's getAccessToken succeeded — clear its own
        // expired-session notice without touching a sibling's.
        authNotifiedRef.current.delete(kind);
        pulledKinds.push(kind);
        let merged = result.mergedConfig ?? working;
        applied = applied || result.applied;
        if (kind === 'webdav') {
          const ws = settings.webdav;
          const format = ws?.syncFormat ?? 'both';
          const provider = await createFileSyncProvider(kind, settings);
          if (format !== 'readest' && wantProgress && providerSupportsLegado(provider)) {
            const mode = allowsPush(kind) ? 'silent' : 'receive';
            const legado = await syncLegadoBook(
              provider,
              ws?.legadoRootPath ?? '/legado',
              book,
              merged,
              format,
              undefined,
              mode,
            );
            merged = legado.config;
            applied = applied || legado.result.progressPulled;
            if (merged.legadoProgress) {
              const view = getView(bookKey);
              if (view) {
                const cfi = await cfiFromLegadoProgress(view, merged.legadoProgress);
                if (cfi && cfi !== merged.location) {
                  merged = { ...merged, location: cfi };
                  applied = true;
                }
              }
            }
          }
        }
        // Revert the fields this backend opted out of back to their
        // pre-merge value, so its remote data for them never enters `working`.
        if (!wantProgress) {
          merged = {
            ...merged,
            progress: before.progress,
            location: before.location,
            xpointer: before.xpointer,
          };
        }
        if (!wantNotes) {
          merged = { ...merged, booknotes: before.booknotes };
        } else if (result.mergedNotes) {
          mergedNotes = result.mergedNotes;
        }
        working = merged;
      } catch (e) {
        handleSyncError(kind, 'file sync pull failed', e);
      }
    }

    if (pulledKinds.length > 0) await updateLastSyncedAt(pulledKinds, Date.now());
    if (!applied) return false;

    // Surface merged notes through the live view so highlights re-appear /
    // disappear without waiting for the next render pass. `mergedNotes` is
    // only ever set from a backend that wanted notes, so this already
    // reflects the notes that actually landed in `working`.
    if (mergedNotes) {
      const view = getView(bookKey);
      const previousById = new Map((config.booknotes ?? []).map((n) => [n.id, n]));
      for (const note of mergedNotes) {
        const prev = previousById.get(note.id);
        if (note.deletedAt && (!prev || !prev.deletedAt)) {
          getViewsById(bookKey.split('-')[0]!).forEach((v) => removeBookNoteOverlays(v, note));
        } else if (!note.deletedAt && note.cfi && view) {
          try {
            view.addAnnotation(note);
          } catch {
            // The annotation may not belong to the current spine index.
          }
        }
      }
    }

    setConfig(bookKey, working);
    // Parity with the native cloud sync (and KOSync): a merged remote position
    // has to move the LIVE view, not just the stored config. Writing the config
    // alone left the reader on the old page until the book was closed and
    // reopened, while the hint below already claimed the progress had been
    // applied (#5883). `working` is masked per backend, so this is skipped when
    // every pulling backend opted out of progress.
    if (remoteProgressApplied(config.location, working.location)) {
      const view = getView(bookKey);
      // Don't yank the view while previewing a deep-link target — the user came
      // here to look at a specific annotation. The merged config is already
      // stored, so the next open resolves to the synced position normally.
      const previewing = useReaderStore.getState().getViewState(bookKey)?.previewMode;
      if (view && !previewing) {
        // `view.goTo` swallows its own resolution failures, so an unresolvable
        // remote CFI leaves the reader where it is instead of throwing here.
        await view.goTo(working.location!);
        // Announce only once the position is actually on screen, so the hint
        // never lies about what the user is looking at.
        eventDispatcher.dispatch('hint', {
          bookKey,
          message: _('Reading Progress Synced'),
        });
      }
    }
    const latest = getConfig(bookKey);
    if (latest) await saveConfig(envConfig, bookKey, latest, settings);
    return true;
  }, [
    isReady,
    bookKey,
    engines,
    getConfig,
    getBookData,
    getView,
    getViewsById,
    setConfig,
    saveConfig,
    allowsPull,
    sliceFor,
    updateLastSyncedAt,
    envConfig,
    settings,
    handleSyncError,
    _,
  ]);

  // Stash the latest callbacks in a ref so the event-bridge effect doesn't
  // re-bind on every render (pattern from useKOSync).
  const syncRefs = useRef({ pushNow, pullNow, pushBookFileNow, pushBookCoverNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow, pushBookFileNow, pushBookCoverNow };
  }, [pushNow, pullNow, pushBookFileNow, pushBookCoverNow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedPush = useCallback(
    debounce(() => {
      if (!dirtyRef.current) return;
      syncRefs.current.pushNow();
    }, PUSH_DEBOUNCE_MS),
    [],
  );

  // Manual triggers only: the reader's Sync menu item, settings UI, and
  // explicit per-book sync actions. Nothing in this hook runs automatically.
  useEffect(() => {
    const handlePush = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      dirtyRef.current = true;
      fileSyncedRef.current.clear();
      coverSyncedRef.current.clear();
      debouncedPush.flush();
      syncRefs.current.pushBookFileNow();
      syncRefs.current.pushBookCoverNow();
    };
    const handlePull = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      syncRefs.current.pullNow();
    };
    // The reader's manual "Sync" button: push local changes first, then pull
    // so remote changes merge back on top (mirrors the native cloud flow).
    const handleManualSync = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      dirtyRef.current = true;
      fileSyncedRef.current.clear();
      coverSyncedRef.current.clear();
      debouncedPush.flush();
      syncRefs.current.pushBookFileNow();
      syncRefs.current.pushBookCoverNow();
      syncRefs.current.pullNow();
    };
    eventDispatcher.on('push-file-sync', handlePush);
    eventDispatcher.on('pull-file-sync', handlePull);
    eventDispatcher.on('flush-file-sync', handlePush);
    eventDispatcher.on('sync-book-progress', handleManualSync);
    return () => {
      eventDispatcher.off('push-file-sync', handlePush);
      eventDispatcher.off('pull-file-sync', handlePull);
      eventDispatcher.off('flush-file-sync', handlePush);
      eventDispatcher.off('sync-book-progress', handleManualSync);
    };
  }, [bookKey, debouncedPush]);

  return { pushNow, pullNow };
};

export default useFileSync;
