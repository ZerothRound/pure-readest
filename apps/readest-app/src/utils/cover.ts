import { Book } from '@/types/book';

/**
 * True when the URL is fetchable by external services (Readwise, markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

/**
 * Resolve a publicly accessible cover image URL for the book, or undefined
 * when none can be provided. Only a `coverImageUrl` that is already a public
 * HTTP(S) URL (e.g. imported from external metadata) is used — publishing
 * covers to the official Readest public bucket is removed in this fork.
 */
export const getPublicCoverUrl = async (
  book: Book,
  _appService: unknown,
): Promise<string | undefined> => {
  if (isPublicImageUrl(book.coverImageUrl)) return book.coverImageUrl;
  return undefined;
};
