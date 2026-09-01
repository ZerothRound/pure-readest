import { useSyncExternalStore } from 'react';

/**
 * Process-local sync diagnostics.
 *
 * Every file-sync request worth debugging (currently WebDAV, the backend the
 * 409 reports came from) records one entry here: method, redacted path,
 * status, duration, error text, and on 409 a probe verdict. The settings UI
 * surfaces the last entries and can copy them as plain text, so a failing
 * sync can be diagnosed from the release build without DevTools.
 *
 * Redaction rule: never record credentials, tokens, query strings, or
 * response bodies except a short snippet of non-2xx responses.
 */
export interface SyncDiagnosticEntry {
  /** Wall-clock millis when the entry was recorded. */
  ts: number;
  /** Backend or subsystem, e.g. `webdav` or `file-sync`. */
  backend: string;
  /** Operation label, e.g. `MKCOL`, `mkdir-409`, `write-409-retry`. */
  op: string;
  /** HTTP method when the entry describes a request. */
  method?: string;
  /** Redacted remote path. */
  path?: string;
  /** HTTP status, when a response was received. */
  status?: number;
  /** Request duration in milliseconds, when measured. */
  durationMs?: number;
  /** Error message, when the request failed. */
  error?: string;
  /** Short snippet of a non-2xx response body. */
  responseSnippet?: string;
  /** Structured detail (e.g. the PROPFIND probe verdict after a MKCOL 409). */
  detail?: string;
}

const MAX_DIAGNOSTIC_ENTRIES = 500;

const entries: SyncDiagnosticEntry[] = [];
// Stable snapshot for useSyncExternalStore: the array is replaced on every
// mutation so React can detect changes by reference.
let snapshot: readonly SyncDiagnosticEntry[] = [];
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const recordSyncDiagnostic = (entry: SyncDiagnosticEntry): void => {
  entries.push(entry);
  if (entries.length > MAX_DIAGNOSTIC_ENTRIES) {
    entries.splice(0, entries.length - MAX_DIAGNOSTIC_ENTRIES);
  }
  snapshot = [...entries];
  emit();
};

export const getSyncDiagnostics = (): readonly SyncDiagnosticEntry[] => snapshot;

export const subscribeSyncDiagnostics = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const clearSyncDiagnostics = (): void => {
  entries.length = 0;
  snapshot = [];
  emit();
};

/** React hook over the ring buffer, for the settings diagnostics pane. */
export const useSyncDiagnostics = (): readonly SyncDiagnosticEntry[] =>
  useSyncExternalStore(subscribeSyncDiagnostics, getSyncDiagnostics, getSyncDiagnostics);

/**
 * Build a loggable request path from a WebDAV server URL + remote path.
 * Strips userinfo (credentials), query strings, and fragments.
 */
export const formatWebDAVRequestPath = (serverUrl: string, path: string): string => {
  try {
    const base = new URL(serverUrl);
    base.username = '';
    base.password = '';
    base.search = '';
    base.hash = '';
    return `${base.toString().replace(/\/$/, '')}${path}`;
  } catch {
    return path;
  }
};

/** Render the ring buffer (last 100 entries) as copyable plain text. */
export const formatSyncDiagnostics = (
  source: readonly SyncDiagnosticEntry[],
  meta?: { backend?: string },
): string => {
  const lines: string[] = ['pure-readest sync diagnostics'];
  if (meta?.backend) lines.push(`backend: ${meta.backend}`);
  for (const e of source.slice(-100)) {
    const time = new Date(e.ts).toISOString();
    const status = e.status !== undefined ? ` -> ${e.status}` : '';
    const duration = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : '';
    const parts = [
      `[${time}]`,
      e.backend,
      e.op,
      e.method,
      e.path,
      status,
      duration,
      e.detail,
      e.error,
      e.responseSnippet,
    ];
    lines.push(parts.filter((part): part is string => Boolean(part)).join(' '));
  }
  return lines.join('\n');
};
