import type { TranslationFunc } from '@/hooks/useTranslation';

export interface ThirdPartyRowInputs {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  /** Enabled but temporarily unavailable due to transport/platform state. */
  paused: boolean;
  /** Last terminal sync error, from fileSyncStore. */
  lastError: string | null | undefined;
  /** This provider's Upload Book Files toggle. */
  syncBooks: boolean;
  /**
   * Some OTHER enabled provider takes the book files (another backend with
   * syncBooks on, or Readest Cloud). Providers are no longer exclusive (#5062),
   * so "this one does not upload book files" is only alarming when nothing else
   * does.
   */
  booksBackedUpElsewhere: boolean;
  /**
   * Enabled, but its short-lived web OAuth token is gone/expired, so it cannot
   * actually sync until the user reconnects (web Google Drive; the token lives
   * in sessionStorage and is dropped when the tab closes). Without this the row
   * would show "Active" while silently syncing nothing.
   */
  needsReauth?: boolean;
}

export interface CanToggleCloudProviderInputs {
  isConfigured: boolean;
  isEnabled: boolean;
}

/**
 * Whether a third-party provider's checkbox can be toggled inline. Turning a
 * A provider can be enabled when configured; an already-enabled provider can
 * always be switched off so a stale configuration never traps the user.
 */
export const canToggleCloudProvider = (s: CanToggleCloudProviderInputs): boolean =>
  s.isConfigured || s.isEnabled;

export const getThirdPartyRowStatus = (_: TranslationFunc, s: ThirdPartyRowInputs): string => {
  if (!s.enabled) return s.configured ? _('Configured') : _('Not connected');
  if (s.paused) return _('Paused');
  // Enabled but the web token is gone — it silently syncs nothing until the user
  // reconnects, so the row must not claim it is active.
  if (s.needsReauth) return _('Reconnect required');
  if (s.syncing) return _('Syncing…');
  if (s.lastError) return _('Sync failed');
  if (!s.syncBooks && !s.booksBackedUpElsewhere) {
    // Books back up NOWHERE in this state — the row must say so.
    return _('Active · Book file uploads off');
  }
  return _('Active');
};
