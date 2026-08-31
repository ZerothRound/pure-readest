'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';
import type { User } from '@/utils/access';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Official Readest account authentication is removed in this fork
 * (pure-readest): there is no Readest account, no Supabase session, and no
 * token/user is ever persisted or sent to official servers.
 *
 * The context keeps its original shape so every consumer compiles unchanged,
 * but `token`/`user` are always null and `login`/`logout`/`refresh` are
 * no-ops. Features that gate themselves on a signed-in user simply stay off.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo<AuthContextType>(
    () => ({
      token: null,
      user: null,
      login: () => {
        /* no-op: official account removed in this fork */
      },
      logout: async () => {
        /* no-op: official account removed in this fork */
      },
      refresh: async () => {
        /* no-op: official account removed in this fork */
      },
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
