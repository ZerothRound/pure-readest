import { normalizeRoot } from '@/services/sync/file/layout';

export interface LegadoBookProgress {
  name: string;
  author: string;
  durChapterIndex: number;
  durChapterPos: number;
  durChapterTime: number;
  durChapterTitle: string | null;
}

const join = (...parts: string[]): string => {
  const cleaned = parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${cleaned.join('/')}`;
};

const normalizeLegadoFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/g, '_');

const encodeLegadoReservedCharacters = (value: string): string =>
  value.replace(/[% "#&()+,/:;<=>?@\\|]/g, (character) => {
    const code = character.codePointAt(0);
    return code === undefined ? character : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  });

export const buildLegadoBooksPath = (rootPath: string): string =>
  join(normalizeRoot(rootPath), 'books');

export const buildLegadoProgressDirPath = (rootPath: string): string =>
  join(normalizeRoot(rootPath), 'bookProgress');

export const buildLegadoProgressFileName = (name: string, author: string): string => {
  const normalized = normalizeLegadoFileName(`${name}_${author}`);
  return `${encodeLegadoReservedCharacters(normalized)}.json`;
};

export const buildLegadoProgressPath = (
  rootPath: string,
  name: string,
  author: string,
): string => join(normalizeRoot(rootPath), 'bookProgress', buildLegadoProgressFileName(name, author));

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const parseLegadoProgress = (value: unknown): LegadoBookProgress | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['name'] !== 'string' ||
    typeof candidate['author'] !== 'string' ||
    !isNonNegativeInteger(candidate['durChapterIndex']) ||
    !isNonNegativeInteger(candidate['durChapterPos']) ||
    !isNonNegativeInteger(candidate['durChapterTime']) ||
    (candidate['durChapterTitle'] !== null &&
      candidate['durChapterTitle'] !== undefined &&
      typeof candidate['durChapterTitle'] !== 'string')
  ) {
    return null;
  }
  return {
    name: candidate['name'],
    author: candidate['author'],
    durChapterIndex: candidate['durChapterIndex'],
    durChapterPos: candidate['durChapterPos'],
    durChapterTime: candidate['durChapterTime'],
    durChapterTitle: candidate['durChapterTitle'] ?? null,
  };
};

export const compareLegadoProgress = (
  left: LegadoBookProgress,
  right: LegadoBookProgress,
): number =>
  left.durChapterIndex - right.durChapterIndex || left.durChapterPos - right.durChapterPos;

export const buildLegadoBookFileName = (title: string, extension: string): string => {
  const base = normalizeLegadoFileName(title).trim() || 'book';
  return `${base}.${extension.replace(/^\./, '').toLowerCase()}`;
};
