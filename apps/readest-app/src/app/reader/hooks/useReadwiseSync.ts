import { useCallback, useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getPublicCoverUrl } from '@/utils/cover';
import { ReadwiseClient } from '@/services/readwise';

export const useReadwiseSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();

  // Read settings from store at call time to avoid stale closures
  const updateLastSyncedAt = useCallback(
    async (timestamp: number) => {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const newSettings = {
        ...settings,
        readwise: { ...settings.readwise, lastSyncedAt: timestamp },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig],
  );

  // Manual "Push All": sends every annotation/excerpt regardless of sync timestamp
  const pushAllHighlights = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    if (!settings.readwise?.enabled || !settings.readwise?.accessToken) return;
    const client = new ReadwiseClient(settings.readwise);
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    if (!book || !config?.booknotes) return;

    const coverImageUrl =
      (settings.readwise.includeCoverImage ?? true)
        ? await getPublicCoverUrl(book, appService)
        : undefined;
    const result = await client.pushHighlights(config.booknotes, book, coverImageUrl);
    if (result.success) {
      await updateLastSyncedAt(Date.now());
      eventDispatcher.dispatch('toast', {
        message: _('Highlights synced to Readwise'),
        type: 'success',
      });
    } else {
      const message = result.isNetworkError
        ? _('Readwise sync failed: no internet connection')
        : _('Readwise sync failed: {{error}}', { error: result.message });
      eventDispatcher.dispatch('toast', { message, type: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, getBookData, getConfig, updateLastSyncedAt, appService]);

  // Listen for manual push-all events dispatched from BookMenu / BooknoteView
  useEffect(() => {
    const handlePushAll = async (e: CustomEvent) => {
      if (e.detail.bookKey !== bookKey) return;
      await pushAllHighlights();
    };
    eventDispatcher.on('readwise-push-all', handlePushAll);
    return () => {
      eventDispatcher.off('readwise-push-all', handlePushAll);
    };
  }, [bookKey, pushAllHighlights]);

  return { pushAllHighlights };
};
