import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { User } from '@/utils/access';

import { AuthProvider, useAuth } from '@/context/AuthContext';

describe('AuthContext (official account removed)', () => {
  afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  test('token and user are always null', () => {
    let value: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      value = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(value?.token).toBeNull();
    expect(value?.user).toBeNull();
  });

  test('login/logout/refresh are no-ops that never change state or persist anything', () => {
    let value: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      value = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    const before = value!;
    const fakeToken = 'fake-token';
    const fakeUser = { id: 'fake-user' } as unknown as User;

    act(() => {
      before.login(fakeToken, fakeUser);
    });
    act(() => {
      void before.refresh();
    });
    act(() => {
      void before.logout();
    });

    expect(value!.token).toBeNull();
    expect(value!.user).toBeNull();
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('refresh_token')).toBeNull();
    expect(window.localStorage.getItem('user')).toBeNull();
  });

  test('context value and callbacks are stable across parent re-renders', () => {
    const captured: ReturnType<typeof useAuth>[] = [];

    function Probe() {
      captured.push(useAuth());
      return null;
    }

    function Wrapper({ tick }: { tick: number }) {
      return (
        <AuthProvider>
          <span data-tick={tick} />
          <Probe />
        </AuthProvider>
      );
    }

    const { rerender } = render(<Wrapper tick={0} />);
    act(() => {
      rerender(<Wrapper tick={1} />);
    });
    act(() => {
      rerender(<Wrapper tick={2} />);
    });

    expect(captured.length).toBeGreaterThanOrEqual(3);
    expect(captured[captured.length - 1]).toBe(captured[captured.length - 2]);
    expect(captured[captured.length - 1]!.login).toBe(captured[captured.length - 2]!.login);
    expect(captured[captured.length - 1]!.logout).toBe(captured[captured.length - 2]!.logout);
    expect(captured[captured.length - 1]!.refresh).toBe(captured[captured.length - 2]!.refresh);
  });
});
