import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/transferManager', () => ({
  transferManager: { queueUpload: vi.fn() },
}));

// Readest Cloud is removed in this fork, so `isReadestCloudStorageActive` is
// always false in production. Pin it open here (except where a test switches
// it off) so the upload-queue logic (category gate, dedupe, delay) stays
// testable.
const cloudGate = vi.hoisted(() => ({
  isReadestCloudStorageActive: vi.fn(() => true),
}));

vi.mock('@/services/sync/cloudSyncProvider', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/sync/cloudSyncProvider')>();
  return {
    ...mod,
    isReadestCloudStorageActive: cloudGate.isReadestCloudStorageActive,
  };
});

// The native book channel is gated off in production (Readest Cloud removed);
// pin the category gate open here so the upload-queue logic stays testable.
const categoryGate = vi.hoisted(() => ({
  isSyncCategoryEnabled: vi.fn(() => true),
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: categoryGate.isSyncCategoryEnabled,
}));

import { transferManager } from '@/services/transferManager';
import { useSettingsStore } from '@/store/settingsStore';
import { queueOPDSBookUploads } from '@/services/opds/cloudUpload';

const mockedQueueUpload = vi.mocked(transferManager.queueUpload);

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    uploadedAt: null,
    downloadedAt: 1000,
    deletedAt: null,
    ...overrides,
  }) as Book;

const setSettings = (settings: Partial<SystemSettings>) => {
  useSettingsStore.setState({ settings: settings as SystemSettings });
};

beforeEach(() => {
  vi.useFakeTimers();
  // Readest Cloud is active by default (no third-party provider enabled).
  cloudGate.isReadestCloudStorageActive.mockReturnValue(true);
  categoryGate.isSyncCategoryEnabled.mockReturnValue(true);
  setSettings({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('queueOPDSBookUploads', () => {
  test('queues an upload for a new book after the init delay', () => {
    const book = makeBook('b1');
    queueOPDSBookUploads(true, useSettingsStore.getState().settings, [book]);

    expect(mockedQueueUpload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(mockedQueueUpload).toHaveBeenCalledWith(book);
  });

  test('does NOT queue when the Manage Sync "Books" category is off', () => {
    categoryGate.isSyncCategoryEnabled.mockReturnValue(false);
    setSettings({ syncCategories: { book: false } });
    queueOPDSBookUploads(true, useSettingsStore.getState().settings, [makeBook('b1')]);

    vi.advanceTimersByTime(3000);
    expect(mockedQueueUpload).not.toHaveBeenCalled();
  });

  test('does NOT queue when logged out', () => {
    queueOPDSBookUploads(false, useSettingsStore.getState().settings, [makeBook('b1')]);

    vi.advanceTimersByTime(3000);
    expect(mockedQueueUpload).not.toHaveBeenCalled();
  });

  test('does NOT queue when Readest Cloud is switched off', () => {
    cloudGate.isReadestCloudStorageActive.mockReturnValue(false);
    setSettings({ readestCloud: { enabled: false } } as Partial<SystemSettings>);
    queueOPDSBookUploads(true, useSettingsStore.getState().settings, [makeBook('b1')]);

    vi.advanceTimersByTime(3000);
    expect(mockedQueueUpload).not.toHaveBeenCalled();
  });

  test('skips books that already have a cloud copy and dedupes by hash', () => {
    const fresh = makeBook('fresh');
    const uploaded = makeBook('uploaded', { uploadedAt: 123 });
    queueOPDSBookUploads(true, useSettingsStore.getState().settings, [fresh, fresh, uploaded]);

    vi.advanceTimersByTime(3000);
    expect(mockedQueueUpload).toHaveBeenCalledTimes(1);
    expect(mockedQueueUpload).toHaveBeenCalledWith(fresh);
  });
});
