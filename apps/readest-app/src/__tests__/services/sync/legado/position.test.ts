import { describe, expect, test } from 'vitest';
import {
  cfiFromLegadoProgress,
  legadoProgressFromRange,
  rangeAtTextOffset,
  textOffsetAtRangeStart,
} from '@/services/sync/legado/position';

describe('Legado position conversion', () => {
  test('round-trips a character offset through a section document', () => {
    const doc = document.implementation.createHTMLDocument('book');
    doc.body.innerHTML = '<p>alpha <b>bravo</b> charlie</p>';
    const range = rangeAtTextOffset(doc, 8);
    expect(textOffsetAtRangeStart(range)).toBe(8);
    expect(legadoProgressFromRange({ title: 'Book', author: 'Author' }, 2, range, 'Chapter')).toEqual({
      name: 'Book',
      author: 'Author',
      durChapterIndex: 2,
      durChapterPos: 8,
      durChapterTime: expect.any(Number),
      durChapterTitle: 'Chapter',
    });
  });

  test('maps a Legado position back to a Readest CFI', async () => {
    const doc = document.implementation.createHTMLDocument('book');
    doc.body.innerHTML = '<p>abcdef</p>';
    const view = {
      book: { sections: [{ createDocument: async () => doc }] },
      getCFI: (index: number, range?: Range) =>
        `section-${index}-${range ? textOffsetAtRangeStart(range) : 0}`,
    } as unknown as import('@/types/view').FoliateView;
    await expect(
      cfiFromLegadoProgress(view, {
        name: 'Book',
        author: 'Author',
        durChapterIndex: 0,
        durChapterPos: 3,
        durChapterTime: 1,
        durChapterTitle: null,
      }),
    ).resolves.toBe('section-0-3');
  });
});
