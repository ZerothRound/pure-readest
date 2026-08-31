import { UserPlan } from '@/types/quota';
import { getDailyUsage } from '@/services/translators/utils';

/**
 * Minimal account shape kept for API compatibility after official Readest
 * login was removed (no Supabase session exists in this fork).
 */
export interface User {
  id: string;
  email?: string | null;
}

/**
 * Official Readest account login is removed in this fork (pure-readest):
 * there are no JWT claims to decode and no Supabase session, so every plan
 * helper reports the top tier and quotas are effectively unlimited.
 */
export const getSubscriptionPlan = (_token: string): UserPlan => {
  return 'pro';
};

export const getUserProfilePlan = (_token: string): UserPlan => {
  return 'pro';
};

export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024; // 10 MB grace

export const getStoragePlanData = (_token: string) => {
  // Unlimited in this fork — storage is user-owned (WebDAV/Drive/S3/OneDrive)
  // and Readest Cloud storage is disabled.
  return {
    plan: 'pro',
    usage: 0,
    quota: Number.MAX_SAFE_INTEGER,
  };
};

export const getTranslationQuota = (_plan: UserPlan): number => {
  // No daily translation cap in this fork.
  return Number.MAX_SAFE_INTEGER;
};

export const getTranslationPlanData = (_token: string) => {
  const usage = getDailyUsage() || 0;
  const quota = getTranslationQuota('pro');

  return {
    plan: 'pro',
    usage,
    quota,
  };
};

export const getDailyTranslationPlanData = (_token: string) => {
  const quota = getTranslationQuota('pro');

  return {
    plan: 'pro',
    quota,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  // No official account in this fork, so there is never a bearer token.
  return null;
};

export const getUserID = async (): Promise<string | null> => {
  return null;
};

export const validateUserAndToken = async (
  _authHeader: string | null | undefined,
): Promise<{ user: User | null; token: string | null }> => {
  // No Supabase in this fork: nothing can be validated, so callers treat the
  // request as anonymous (routes that must run locally no longer gate on this).
  return { user: null, token: null };
};
