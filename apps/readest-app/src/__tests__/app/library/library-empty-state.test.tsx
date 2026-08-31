import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryEmptyState from '@/app/library/components/LibraryEmptyState';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

afterEach(() => {
  cleanup();
  useEnvMock.mockReset();
});

describe('LibraryEmptyState', () => {
  it('renders title, desktop description, and the Import Books CTA (no login prompt)', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: false } });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Start your library' })).toBeTruthy();
    expect(screen.getByText(/drop a book anywhere on this window/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import Books' })).toBeTruthy();
    // Official Readest account login is removed in this fork: no sign-in CTA.
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('renders mobile description (no drag-drop language) when appService.isMobile', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: true } });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByText(/pick a book from your device/i)).toBeTruthy();
    expect(screen.queryByText(/drop a book anywhere on this window/i)).toBeNull();
  });

  it('calls onImport when the Import Books button is clicked', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: false } });
    const handleImport = vi.fn();
    render(<LibraryEmptyState onImport={handleImport} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import Books' }));

    expect(handleImport).toHaveBeenCalledTimes(1);
  });
});
