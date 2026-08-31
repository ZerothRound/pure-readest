import { describe, it, expect } from 'vitest';
import type { Book } from '@/types/book';
import { getPublicCoverUrl, isPublicImageUrl } from '@/utils/cover';

// Official Readest cover publishing is removed in this fork: only a cover
// image URL that is already public (e.g. imported from external metadata) is
// returned; local covers are never uploaded anywhere.

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash,
    coverHash: `md5of${hash}`,
    title: 'T',
    author: 'A',
    ...overrides,
  }) as Book;

describe('isPublicImageUrl', () => {
  it('accepts http(s) URLs and rejects local ones', () => {
    expect(isPublicImageUrl('https://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://localhost:3000/c.png')).toBe(false);
    expect(isPublicImageUrl('http://127.0.0.1/c.png')).toBe(false);
    expect(isPublicImageUrl('https://asset.localhost/c.png')).toBe(false);
    expect(isPublicImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isPublicImageUrl(undefined)).toBe(false);
    expect(isPublicImageUrl(null)).toBe(false);
  });
});

describe('getPublicCoverUrl', () => {
  it('reuses an already-public coverImageUrl', async () => {
    const book = makeBook('aaa1', { coverImageUrl: 'https://example.com/cover.jpg' });

    await expect(getPublicCoverUrl(book, null)).resolves.toBe('https://example.com/cover.jpg');
  });

  it('returns undefined for a local cover (never uploaded)', async () => {
    const book = makeBook('aaa1');

    await expect(getPublicCoverUrl(book, null)).resolves.toBeUndefined();
  });
});
