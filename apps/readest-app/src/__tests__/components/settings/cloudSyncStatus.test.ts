import { describe, expect, test } from 'vitest';
import {
  canToggleCloudProvider,
  getReadestCloudRowStatus,
  getThirdPartyRowStatus,
} from '@/components/settings/integrations/cloudSyncStatus';

const _ = (key: string) => key;

describe('getReadestCloudRowStatus', () => {
  test('signed out wins over everything', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: false, planLoading: true, enabled: true })).toBe(
      'Not signed in',
    );
  });

  test('loading while the plan resolves', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: true, planLoading: true, enabled: true })).toBe(
      '…',
    );
  });

  test('reports off when the user unchecked it', () => {
    expect(
      getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, enabled: false }),
    ).toBe('Off');
  });

  test('reports active when checked', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, enabled: true })).toBe(
      'Active',
    );
  });
});

describe('getThirdPartyRowStatus', () => {
  const base = {
    enabled: true,
    configured: true,
    syncing: false,
    paused: false,
    lastError: null,
    syncBooks: true,
    booksBackedUpElsewhere: false,
  };

  test('not connected / configured when inactive', () => {
    expect(getThirdPartyRowStatus(_, { ...base, enabled: false, configured: false })).toBe(
      'Not connected',
    );
    expect(getThirdPartyRowStatus(_, { ...base, enabled: false })).toBe('Configured');
  });

  test('paused status outranks syncing, errors, and warnings', () => {
    expect(
      getThirdPartyRowStatus(_, { ...base, paused: true, syncing: true, lastError: 'x' }),
    ).toBe('Paused');
  });

  test('syncing while a run is in flight', () => {
    expect(getThirdPartyRowStatus(_, { ...base, syncing: true })).toBe('Syncing…');
  });

  test('needs reauth when the web token is gone (outranks syncing/active, not paused)', () => {
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true })).toBe('Reconnect required');
    // A gone token must never read as active or as an in-flight sync.
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true, syncing: true })).toBe(
      'Reconnect required',
    );
    // But a plan-level pause still outranks it.
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true, paused: true })).toBe(
      'Paused',
    );
  });

  test('sync failed after a terminal error', () => {
    expect(getThirdPartyRowStatus(_, { ...base, lastError: 'AUTH_FAILED' })).toBe('Sync failed');
  });

  test('warns when book file uploads are off (books back up nowhere)', () => {
    expect(getThirdPartyRowStatus(_, { ...base, syncBooks: false })).toBe(
      'Active · Book file uploads off',
    );
  });

  test('healthy active state', () => {
    expect(getThirdPartyRowStatus(_, base)).toBe('Active');
  });
});

describe('getThirdPartyRowStatus: book file coverage', () => {
  const base = {
    enabled: true,
    configured: true,
    syncing: false,
    paused: false,
    lastError: null,
    syncBooks: false,
  };

  test('warns only when nothing else backs up the book files', () => {
    expect(getThirdPartyRowStatus(_, { ...base, booksBackedUpElsewhere: false })).toBe(
      'Active · Book file uploads off',
    );
  });

  test('stays plain Active when another provider holds the book files', () => {
    expect(getThirdPartyRowStatus(_, { ...base, booksBackedUpElsewhere: true })).toBe('Active');
  });
});

describe('canToggleCloudProvider', () => {
  test('configured providers can be toggled', () => {
    expect(canToggleCloudProvider({ isConfigured: true, isEnabled: false })).toBe(true);
  });

  test('unconfigured providers cannot be enabled', () => {
    expect(canToggleCloudProvider({ isConfigured: false, isEnabled: false })).toBe(false);
  });

  test('an enabled provider can always be switched off', () => {
    expect(canToggleCloudProvider({ isConfigured: false, isEnabled: true })).toBe(true);
  });

  test('not configured and not enabled cannot be toggled', () => {
    expect(canToggleCloudProvider({ isConfigured: false, isEnabled: false })).toBe(false);
  });

  test('cleared config on an enabled provider remains recoverable', () => {
    expect(canToggleCloudProvider({ isConfigured: false, isEnabled: true })).toBe(true);
  });
});
