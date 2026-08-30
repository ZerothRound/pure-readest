import type { Book } from '@/types/book';
import type { FoliateView } from '@/types/view';
import type { LegadoBookProgress } from './compat';

const SHOW_TEXT = 4;

const textNodes = (root: Node): Text[] => {
  const doc = root.ownerDocument;
  if (!doc) return [];
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  const result: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    result.push(node as Text);
    node = walker.nextNode();
  }
  return result;
};

/** Character offset in a section's plain text for a DOM range start. */
export const textOffsetAtRangeStart = (range: Range): number => {
  const doc = range.startContainer.ownerDocument;
  const root = doc?.body ?? range.startContainer;
  if (!doc) return 0;
  try {
    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
  } catch {
    let offset = 0;
    for (const node of textNodes(root)) {
      if (node === range.startContainer) return offset + range.startOffset;
      if (node.contains(range.startContainer)) {
        const nested = doc.createRange();
        nested.selectNodeContents(node);
        nested.setEnd(range.startContainer, range.startOffset);
        return offset + nested.toString().length;
      }
      offset += node.textContent?.length ?? 0;
    }
    return offset;
  }
};

/** Build a DOM range at a plain-text character offset, clamped to the section. */
export const rangeAtTextOffset = (doc: Document, requestedOffset: number): Range => {
  const root = doc.body ?? doc.documentElement;
  const range = doc.createRange();
  const nodes = textNodes(root);
  const target = Math.max(0, requestedOffset);
  let offset = 0;
  for (const node of nodes) {
    const length = node.textContent?.length ?? 0;
    if (target <= offset + length) {
      range.setStart(node, Math.max(0, target - offset));
      range.collapse(true);
      return range;
    }
    offset += length;
  }
  if (nodes.length > 0) {
    const last = nodes[nodes.length - 1]!;
    range.setStart(last, last.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(root);
    range.collapse(true);
  }
  return range;
};

export const legadoProgressFromRange = (
  book: Pick<Book, 'title' | 'author'>,
  sectionIndex: number,
  range: Range,
  chapterTitle?: string | null,
  now = Date.now(),
): LegadoBookProgress => ({
  name: book.title,
  author: book.author,
  durChapterIndex: Math.max(0, sectionIndex),
  durChapterPos: textOffsetAtRangeStart(range),
  durChapterTime: now,
  durChapterTitle: chapterTitle ?? null,
});

/** Resolve a Legado chapter/character position into Readest's CFI space. */
export const cfiFromLegadoProgress = async (
  view: Pick<FoliateView, 'book' | 'getCFI'>,
  progress: LegadoBookProgress,
): Promise<string | null> => {
  const section = view.book.sections[progress.durChapterIndex];
  if (!section?.createDocument) return null;
  try {
    const doc = await section.createDocument();
    return view.getCFI(
      progress.durChapterIndex,
      rangeAtTextOffset(doc, progress.durChapterPos),
    );
  } catch {
    return null;
  }
};
