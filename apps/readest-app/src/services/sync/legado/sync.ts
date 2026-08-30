import type { Book, BookConfig } from '@/types/book';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import {
  FileSyncError,
  type FileEntry,
  type FileSyncProvider,
} from '@/services/sync/file/provider';
import { ancestorsOf } from '@/services/sync/file/layout';
import { EXTS } from '@/libs/document';
import {
  buildLegadoBookFileName,
  buildLegadoBooksPath,
  buildLegadoProgressDirPath,
  buildLegadoProgressPath,
  compareLegadoProgress,
  parseLegadoProgress,
  type LegadoBookProgress,
} from './compat';

export type LegadoSyncFormat = 'readest' | 'legado' | 'both';
export type LegadoSyncMode = 'send' | 'receive' | 'silent';

export interface LegadoSyncResult {
  progressPulled: boolean;
  progressPushed: boolean;
  bookUploaded: boolean;
}

export interface LegadoLibrarySyncResult {
  booksImported: number;
  booksUploaded: number;
  progressPulled: number;
  progressPushed: number;
}

const toLegadoProgress = (book: Book, config: BookConfig): LegadoBookProgress | null =>
  config.legadoProgress
    ? { ...config.legadoProgress, name: book.title, author: book.author }
    : null;

/**
 * FileSyncProvider.ensureDir accepts an ordered list of directories. Passing
 * the ancestors of a marker file makes this work when a user chooses a new
 * nested Legado root (e.g. `/library/legado`) as well as when the root already
 * exists. The marker is never uploaded.
 */
const isNotFound = (error: unknown): boolean => {
  if (error instanceof FileSyncError) return error.code === 'NOT_FOUND' || error.status === 404;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  if (candidate.code === 'NOT_FOUND' || candidate.status === 404) return true;
  return typeof candidate.message === 'string' && /(?:not[ _-]?found|\b404\b)/i.test(candidate.message);
};

/**
 * Exchange only a book file and its reading progress with Legado's native
 * WebDAV layout. Readest annotations/settings stay in the Readest layout.
 */
export const syncLegadoBook = async (
  provider: FileSyncProvider,
  rootPath: string,
  book: Book,
  config: BookConfig,
  format: LegadoSyncFormat = 'both',
  bookBytes?: ArrayBuffer,
  mode: LegadoSyncMode = 'silent',
  syncProgress = true,
): Promise<{ config: BookConfig; result: LegadoSyncResult }> => {
  if (format === 'readest') {
    return {
      config,
      result: { progressPulled: false, progressPushed: false, bookUploaded: false },
    };
  }
  const canPull = mode !== 'send';
  const canPush = mode !== 'receive';
  const progressPath = syncProgress
    ? buildLegadoProgressPath(rootPath, book.title, book.author)
    : null;
  // A receive-only or progress-disabled pass must not create the Legado
  // directories. Reading a missing progress file is deliberately represented
  // by null by every FileSyncProvider, so no probe is needed when disabled.
  let remoteRaw: string | null = null;
  if (canPull && progressPath) {
    try {
      remoteRaw = await provider.readText(progressPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  let remote: LegadoBookProgress | null = null;
  if (remoteRaw) {
    try {
      remote = parseLegadoProgress(JSON.parse(remoteRaw));
    } catch {
      remote = null;
    }
  }
  let nextConfig = config;
  let progressPulled = false;
  let progressPushed = false;
  const remoteIsNewer =
    !!remote &&
    (!config.legadoProgress || compareLegadoProgress(remote, config.legadoProgress) > 0);
  if (remote && remoteIsNewer) {
    nextConfig = { ...config, legadoProgress: remote, updatedAt: Date.now() };
    progressPulled = true;
  }
  const localProgress = toLegadoProgress(book, nextConfig);
  const shouldWriteProgress =
    canPush &&
    syncProgress &&
    progressPath !== null &&
    localProgress &&
    (!remote || compareLegadoProgress(localProgress, remote) > 0);
  const shouldWriteBook =
    canPush && bookBytes && (format === 'both' || format === 'legado');
  const bookPath = shouldWriteBook
    ? `${buildLegadoBooksPath(rootPath)}/${buildLegadoBookFileName(book.title, EXTS[book.format] || 'bin')}`
    : null;

  // Build the complete directory list before issuing any MKCOLs. This keeps a
  // two-way pass to one idempotent ensureDir call while still avoiding every
  // `bookProgress` touch when progress sync is disabled.
  if (shouldWriteProgress || shouldWriteBook) {
    const directories = new Set<string>();
    if (shouldWriteProgress) {
      for (const directory of ancestorsOf(
        `${buildLegadoProgressDirPath(rootPath)}/.placeholder`,
      )) {
        directories.add(directory);
      }
    }
    if (shouldWriteBook && bookPath) {
      for (const directory of ancestorsOf(`${buildLegadoBooksPath(rootPath)}/.placeholder`)) {
        directories.add(directory);
      }
    }
    await provider.ensureDir([...directories]);
  }

  if (shouldWriteProgress && progressPath && localProgress) {
    await provider.writeText(progressPath, JSON.stringify(localProgress), 'application/json');
    progressPushed = true;
  }
  let bookUploaded = false;
  if (shouldWriteBook && bookPath && bookBytes) {
    await provider.writeBinary(bookPath, bookBytes, 'application/octet-stream');
    bookUploaded = true;
  }
  return { config: nextConfig, result: { progressPulled, progressPushed, bookUploaded } };
};

const supportedBookExtension = (name: string): boolean =>
  /\.(epub|pdf|mobi|azw|azw3|cbz|fb2|fbz|txt|md)$/i.test(name);

const withoutExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

const sameLegadoName = (book: Book, remoteName: string): boolean => {
  const remote = withoutExtension(remoteName).trim().toLocaleLowerCase();
  const candidates = [book.title, book.sourceTitle, book.hash].filter(
    (value): value is string => Boolean(value),
  );
  return candidates.some((value) => withoutExtension(value).trim().toLocaleLowerCase() === remote);
};

const makeFile = (bytes: ArrayBuffer, name: string): File => {
  if (typeof File !== 'undefined') return new File([bytes], name);
  const blob = new Blob([bytes]);
  return Object.assign(blob, { name, lastModified: Date.now() }) as File;
};

const emptyResult = (): LegadoLibrarySyncResult => ({
  booksImported: 0,
  booksUploaded: 0,
  progressPulled: 0,
  progressPushed: 0,
});

/**
 * Synchronize the book-only portion of a Legado WebDAV tree. This deliberately
 * does not touch Legado's sources, settings, bookmarks, or application backup.
 */
export const syncLegadoLibrary = async ({
  provider,
  legadoRootPath,
  rootPath,
  books,
  appService,
  settings,
  uploadBooks,
  importBooks = uploadBooks,
  mode = 'silent',
  format = 'both',
  syncProgress = true,
}: {
  provider: FileSyncProvider;
  /** Legado subtree, normally `/legado`. */
  legadoRootPath?: string;
  /** @deprecated Use legadoRootPath. Kept for callers written before the
   * Legado-specific setting was introduced. */
  rootPath?: string;
  books: Book[];
  appService: AppService;
  settings: SystemSettings;
  uploadBooks: boolean;
  importBooks?: boolean;
  mode?: LegadoSyncMode;
  format?: LegadoSyncFormat;
  syncProgress?: boolean;
}): Promise<LegadoLibrarySyncResult> => {
  const result = emptyResult();
  // Prefer the explicit Legado setting. The alias prevents older integrations
  // from silently targeting the Readest subtree while they are migrated.
  const syncRootPath = legadoRootPath ?? rootPath ?? '/legado';

  // `readest` means the ordinary FileSyncEngine owns this pass. In particular,
  // do not create/list the Legado directories as a side effect of a no-op.
  if (format === 'readest') return result;

  // Listing is only needed for book discovery or to compare an upload. A
  // progress-only pass should not issue a WebDAV PROPFIND for `books/`.
  const canPull = mode !== 'send';
  const canPush = mode !== 'receive';
  const shouldListBooks = (canPull && importBooks) || (canPush && uploadBooks);
  let remoteEntries: FileEntry[] = [];
  if (shouldListBooks) {
    try {
      remoteEntries = await provider.list(buildLegadoBooksPath(syncRootPath));
    } catch (error) {
      // A fresh WebDAV account has no `books/` collection yet. Treat that as
      // an empty listing in every mode; a subsequent upload lazily creates it.
      if (!isNotFound(error)) throw error;
    }
  }
  remoteEntries = remoteEntries.filter(
    (entry) => !entry.isDirectory && supportedBookExtension(entry.name),
  );

  // Import remote-only books. Matching by the friendly filename is intentional:
  // Legado has no Readest hash/index to identify a file before it is opened.
  for (const entry of canPull && importBooks ? remoteEntries : []) {
    if (books.some((book) => sameLegadoName(book, entry.name))) continue;
    try {
      const bytes = await provider.readBinary(entry.path);
      if (!bytes) continue;
      const imported = await appService.importBook(makeFile(bytes, entry.name), books);
      if (imported) result.booksImported += 1;
    } catch (error) {
      // One stale/corrupt remote file must not prevent other books and
      // progress records from syncing.
      console.warn('Legado book import failed', entry.path, error);
    }
  }

  // No local operation remains when both binary and progress sync are off.
  if (!uploadBooks && !syncProgress) return result;

  for (const book of [...books]) {
    let config: BookConfig = { updatedAt: Date.now() };
    if (syncProgress) {
      const loadedConfig = await appService.loadBookConfig(book, settings).catch(() => null);
      if (!loadedConfig) continue;
      config = loadedConfig;
    }
    const remoteEntry = remoteEntries.find((entry) => sameLegadoName(book, entry.name));
    let bytes: ArrayBuffer | undefined;
    const shouldUploadBook = uploadBooks && canPush;
    const localSize = shouldUploadBook ? await appService.getBookFileSize(book) : null;
    if (shouldUploadBook && (!remoteEntry || localSize === null || remoteEntry.size !== localSize)) {
      const content = await appService
        .loadBookContent(book)
        .then((value) => value.file)
        .catch(() => null);
      if (content) {
        const candidate = await content.arrayBuffer();
        if (!remoteEntry || remoteEntry.size !== candidate.byteLength) bytes = candidate;
      }
    }
    const synced = await syncLegadoBook(
      provider,
      syncRootPath,
      book,
      config,
      format,
      bytes,
      mode,
      syncProgress,
    );
    if (synced.result.progressPulled) {
      await appService.saveBookConfig(book, synced.config, settings);
      result.progressPulled += 1;
    }
    if (synced.result.progressPushed) result.progressPushed += 1;
    if (synced.result.bookUploaded) result.booksUploaded += 1;
  }
  return result;
};
