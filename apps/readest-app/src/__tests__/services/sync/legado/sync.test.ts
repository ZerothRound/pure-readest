import { describe, expect, test, vi } from 'vitest';
import type { Book, BookConfig } from '@/types/book';
import {
  FileSyncError,
  type FileEntry,
  type FileSyncProvider,
} from '@/services/sync/file/provider';
import {
  buildLegadoProgressPath,
} from '@/services/sync/legado/compat';
import { syncLegadoBook, syncLegadoLibrary } from '@/services/sync/legado/sync';

const makeProvider = (files: Record<string, string | ArrayBuffer> = {}): FileSyncProvider => {
  const entries: FileEntry[] = [];
  return {
    rootPath: '/',
    ensureDir: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(entries),
    readText: vi.fn(async (path: string) => {
      const value = files[path];
      return typeof value === 'string' ? value : null;
    }),
    readBinary: vi.fn(async (path: string) => {
      const value = files[path];
      return value instanceof ArrayBuffer ? value : null;
    }),
    head: vi.fn().mockResolvedValue(null),
    writeText: vi.fn(async (path: string, body: string) => {
      files[path] = body;
    }),
    writeBinary: vi.fn(async (path: string, body: ArrayBuffer) => {
      files[path] = body;
    }),
    deleteDir: vi.fn().mockResolvedValue(undefined),
  };
};

const book = {
  hash: 'hash1',
  format: 'EPUB',
  title: 'Book',
  author: 'Author',
  sourceTitle: 'Book.epub',
  createdAt: 1,
  updatedAt: 1,
} as Book;

const progress = (chapter: number, position: number, time: number) => ({
  name: 'Book',
  author: 'Author',
  durChapterIndex: chapter,
  durChapterPos: position,
  durChapterTime: time,
  durChapterTitle: `Chapter ${chapter + 1}`,
});

describe('Legado WebDAV book sync', () => {
  test('readest format is a complete no-op for the Legado library pass', async () => {
    const provider = makeProvider();
    const appService = {} as import('@/types/system').AppService;

    await expect(
      syncLegadoLibrary({
        provider,
        legadoRootPath: '/legado',
        books: [book],
        appService,
        settings: {} as import('@/types/settings').SystemSettings,
        uploadBooks: true,
        importBooks: true,
        format: 'readest',
      }),
    ).resolves.toEqual({
      booksImported: 0,
      booksUploaded: 0,
      progressPulled: 0,
      progressPushed: 0,
    });
    expect(provider.ensureDir).not.toHaveBeenCalled();
    expect(provider.list).not.toHaveBeenCalled();
    expect(provider.readText).not.toHaveBeenCalled();
    expect(provider.writeText).not.toHaveBeenCalled();
    expect(provider.writeBinary).not.toHaveBeenCalled();
  });

  test('does not touch bookProgress when progress syncing is disabled', async () => {
    const provider = makeProvider();
    const bytes = new Uint8Array([7, 8]).buffer;

    const result = await syncLegadoBook(
      provider,
      '/legado',
      book,
      { updatedAt: 10, legadoProgress: progress(1, 2, 3) },
      'legado',
      bytes,
      'silent',
      false,
    );

    expect(result.result.bookUploaded).toBe(true);
    expect(provider.readText).not.toHaveBeenCalled();
    expect(provider.writeText).not.toHaveBeenCalled();
    expect(provider.ensureDir).toHaveBeenCalledWith(['/legado', '/legado/books']);
    expect(provider.ensureDir).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('bookProgress')]),
    );
  });

  test('receive mode tolerates a missing books directory without creating it', async () => {
    const provider = makeProvider();
    vi.mocked(provider.list).mockRejectedValue(new FileSyncError('missing', 'NOT_FOUND', 404));

    const result = await syncLegadoLibrary({
      provider,
      rootPath: '/legacy',
      books: [],
      appService: {} as import('@/types/system').AppService,
      settings: {} as import('@/types/settings').SystemSettings,
      uploadBooks: true,
      importBooks: true,
      mode: 'receive',
      format: 'legado',
      syncProgress: false,
    });

    expect(result.booksImported).toBe(0);
    expect(provider.list).toHaveBeenCalledWith('/legacy/books');
    expect(provider.ensureDir).not.toHaveBeenCalled();
  });

  test('uses legadoRootPath in preference to the legacy rootPath alias', async () => {
    const provider = makeProvider();

    await syncLegadoLibrary({
      provider,
      legadoRootPath: '/new-legado',
      rootPath: '/old-readest',
      books: [],
      appService: {} as import('@/types/system').AppService,
      settings: {} as import('@/types/settings').SystemSettings,
      uploadBooks: false,
      importBooks: true,
      mode: 'receive',
      format: 'legado',
      syncProgress: false,
    });

    expect(provider.list).toHaveBeenCalledWith('/new-legado/books');
  });

  test('skips the books listing for a progress-only pass', async () => {
    const provider = makeProvider();
    const appService = {
      loadBookConfig: vi.fn().mockResolvedValue({ updatedAt: 1 }),
      saveBookConfig: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('@/types/system').AppService;

    await syncLegadoLibrary({
      provider,
      legadoRootPath: '/legado',
      books: [book],
      appService,
      settings: {} as import('@/types/settings').SystemSettings,
      uploadBooks: false,
      importBooks: false,
      mode: 'receive',
      format: 'legado',
      syncProgress: true,
    });

    expect(provider.list).not.toHaveBeenCalled();
    expect(provider.readText).toHaveBeenCalledWith('/legado/bookProgress/Book_Author.json');
  });

  test('pulls the furthest progress and writes a local book file to Legado books', async () => {
    const files: Record<string, string | ArrayBuffer> = {
      [buildLegadoProgressPath('/', 'Book', 'Author')]: JSON.stringify(progress(4, 12, 20)),
    };
    const provider = makeProvider(files);
    const config: BookConfig = {
      updatedAt: 10,
      legadoProgress: progress(3, 99, 10),
    };
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    const result = await syncLegadoBook(provider, '/', book, config, 'both', bytes);

    expect(result.result.progressPulled).toBe(true);
    expect(result.result.bookUploaded).toBe(true);
    expect(result.config.legadoProgress?.durChapterIndex).toBe(4);
    expect(provider.writeBinary).toHaveBeenCalledWith(
      '/books/Book.epub',
      bytes,
      'application/octet-stream',
    );
  });

  test('does not push a receive-only local position over the remote file', async () => {
    const provider = makeProvider();
    const config: BookConfig = { updatedAt: 10, legadoProgress: progress(2, 3, 10) };
    await syncLegadoBook(provider, '/', book, config, 'both', undefined, 'receive');
    expect(provider.writeText).not.toHaveBeenCalled();
  });

  test('imports a remote-only book from the Legado books directory', async () => {
    const bytes = new Uint8Array([4, 5]).buffer;
    const provider = makeProvider();
    vi.mocked(provider.list).mockResolvedValue([
      { name: 'Remote.epub', path: '/books/Remote.epub', isDirectory: false, size: 2 },
    ]);
    vi.mocked(provider.readBinary).mockResolvedValue(bytes);
    const importedBook = { ...book, title: 'Remote', sourceTitle: 'Remote.epub' } as Book;
    const library: Book[] = [];
    const appService = {
      importBook: vi.fn(async (_file: File, books: Book[]) => {
        books.push(importedBook);
        return importedBook;
      }),
      loadBookConfig: vi.fn().mockResolvedValue({ updatedAt: 1 }),
      saveBookConfig: vi.fn().mockResolvedValue(undefined),
      getBookFileSize: vi.fn().mockResolvedValue(null),
      openFile: vi.fn(),
    } as unknown as import('@/types/system').AppService;

    const result = await syncLegadoLibrary({
      provider,
      rootPath: '/',
      books: library,
      appService,
      settings: {} as import('@/types/settings').SystemSettings,
      uploadBooks: false,
      importBooks: true,
    });

    expect(result.booksImported).toBe(1);
    expect(library).toHaveLength(1);
    expect(appService.importBook).toHaveBeenCalled();
  });
});
