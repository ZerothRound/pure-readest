import { describe, expect, test } from 'vitest';
import {
  buildLegadoBooksPath,
  buildLegadoProgressFileName,
  buildLegadoProgressPath,
  compareLegadoProgress,
  parseLegadoProgress,
} from '@/services/sync/legado/compat';

describe('Legado WebDAV compatibility', () => {
  test('uses the directories Legado creates under the configured WebDAV root', () => {
    expect(buildLegadoBooksPath('/reader')).toBe('/reader/books');
    expect(buildLegadoProgressPath('/reader', '三体', '刘慈欣')).toBe(
      '/reader/bookProgress/三体_刘慈欣.json',
    );
  });

  test('matches Legado filename normalization and reserved-character encoding', () => {
    expect(buildLegadoProgressFileName('A/B: C', 'D|E')).toBe('A_B_%20C_D_E.json');
    expect(buildLegadoProgressFileName('100%', 'A&B')).toBe('100%25_A%26B.json');
  });

  test('validates the six-field BookProgress wire object', () => {
    expect(
      parseLegadoProgress({
        name: 'Book',
        author: 'Author',
        durChapterIndex: 4,
        durChapterPos: 25,
        durChapterTime: 1234,
        durChapterTitle: 'Chapter 5',
      }),
    ).toEqual({
      name: 'Book',
      author: 'Author',
      durChapterIndex: 4,
      durChapterPos: 25,
      durChapterTime: 1234,
      durChapterTitle: 'Chapter 5',
    });
    expect(parseLegadoProgress({ name: 'Book', durChapterIndex: -1 })).toBeNull();
  });

  test('orders progress by chapter and then chapter character offset', () => {
    const at = (chapter: number, pos: number) => ({
      name: 'Book',
      author: 'Author',
      durChapterIndex: chapter,
      durChapterPos: pos,
      durChapterTime: 1,
      durChapterTitle: null,
    });
    expect(compareLegadoProgress(at(3, 0), at(2, 999))).toBeGreaterThan(0);
    expect(compareLegadoProgress(at(3, 20), at(3, 10))).toBeGreaterThan(0);
    expect(compareLegadoProgress(at(3, 20), at(3, 20))).toBe(0);
  });
});
